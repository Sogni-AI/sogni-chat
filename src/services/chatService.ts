/**
 * Chat service for LLM-powered creative assistant.
 * Manages conversations, streams responses, and handles the tool calling loop.
 *
 * Tool execution is delegated to the tool registry — individual tool handlers
 * live in src/tools/<tool-name>/handler.ts. This service is responsible only
 * for the LLM conversation loop, streaming, context trimming, and vision analysis.
 */
import { SogniClient } from '@sogni-ai/sogni-client';
import type { ChatMessage } from '@sogni-ai/sogni-client';
import {
  CHAT_SYSTEM_PROMPT,
  VISION_ANALYSIS_SYSTEM_PROMPT,
  CHAT_MODEL,
  CHAT_DEFAULT_PARAMS,
  detectRefusal,
  parseChatToolArgs,
} from '@/config/chat';
import { toolRegistry } from '@/tools';
import type { ToolName, ToolExecutionContext, ToolExecutionProgress, ToolCallbacks } from '@/tools/types';
import { stripThinkBlocks } from '@/tools/shared/llmHelpers';
import { isInsufficientCreditsError, getAlternateToken, hasBalance } from '@/tools/shared/creditCheck';
import { trimConversation, getInputBudget } from '@/services/contextWindow';
import { resizeImageForVision } from '@/utils/imageProcessing';
import type { TokenType } from '@/types/wallet';

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

/** Callbacks for streaming chat events */
export interface ChatStreamCallbacks {
  onToken: (content: string) => void;
  onToolCall: (toolName: ToolName, args: Record<string, unknown>) => void;
  onToolProgress: (progress: ToolExecutionProgress) => void;
  onToolComplete: (toolName: ToolName, resultUrls: string[], videoResultUrls?: string[]) => void;
  onComplete: (fullContent: string) => void;
  onError: (error: string) => void;
  onInsufficientCredits?: () => void;
  onContextTrimmed?: (count: number) => void;
  /** Called when the model's response is detected as a refusal (finishReason 'stop' + refusal patterns) */
  onModelRefusal?: (refusedContent: string) => void;
  /** Called after a gallery save completes, providing gallery IDs for persistent rendering */
  onGallerySaved?: (galleryImageIds: string[], galleryVideoIds: string[]) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TOOL_ROUNDS = 5;

/** Token overhead for a vision image (matches IMAGE_TOKENS_HIGH in tokenEstimation.ts) */
const VISION_IMAGE_TOKENS = 1_300;

/**
 * Prepare a vision-ready data URI from the most relevant image source.
 * Uses resizeImageForVision (1024px max, JPEG 0.85) for compact payloads.
 * Returns null if no image is available or preparation fails.
 */
async function prepareVisionDataUri(context: ToolExecutionContext): Promise<string | null> {
  try {
    // Priority: latest result > original upload > attached image
    if (context.resultUrls.length > 0) {
      return await resizeImageForVision(context.resultUrls[context.resultUrls.length - 1]);
    }
    if (context.imageData) {
      const buf = context.imageData.buffer.slice(
        context.imageData.byteOffset,
        context.imageData.byteOffset + context.imageData.byteLength,
      ) as ArrayBuffer;
      const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
      try {
        return await resizeImageForVision(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    }
    const imgFile = context.uploadedFiles.find(f => f.type === 'image');
    if (imgFile) {
      const buf = imgFile.data.buffer.slice(
        imgFile.data.byteOffset,
        imgFile.data.byteOffset + imgFile.data.byteLength,
      ) as ArrayBuffer;
      const blobUrl = URL.createObjectURL(new Blob([buf], { type: imgFile.mimeType }));
      try {
        return await resizeImageForVision(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    }
  } catch (err) {
    console.warn('[CHAT SERVICE] Vision image preparation failed:', err);
  }
  return null;
}

// ---------------------------------------------------------------------------
// sendChatMessage
// ---------------------------------------------------------------------------

/**
 * Send a message to the LLM and handle the full tool-calling loop.
 * Streams tokens back via callbacks, executes tools when called,
 * feeds results back to the LLM, and continues until a text response.
 */
export async function sendChatMessage(
  messages: ChatMessage[],
  context: ToolExecutionContext,
  callbacks: ChatStreamCallbacks,
): Promise<ChatMessage[]> {
  const { sogniClient } = context;
  const updatedMessages = [...messages];
  let toolRound = 0;

  // Verify the chat API is available on this client instance
  if (!sogniClient.chat?.completions) {
    console.error('[CHAT SERVICE] sogniClient.chat is not available. Client keys:', Object.keys(sogniClient));
    callbacks.onError('Chat API is not available. Please refresh the page and try again.');
    return updatedMessages;
  }

  // Build tool callbacks that bridge to ChatStreamCallbacks
  const toolCallbacks: ToolCallbacks = {
    onToolProgress: callbacks.onToolProgress,
    onToolComplete: callbacks.onToolComplete,
    onInsufficientCredits: callbacks.onInsufficientCredits,
    onGallerySaved: callbacks.onGallerySaved,
  };

  // Prepare vision context once before the loop: resize the current image
  // to a compact data URI so the VLM can "see" it on every round.
  // Re-prepared inside the loop only when new results are generated.
  let visionDataUri = await prepareVisionDataUri(context);
  let visionResultCount = context.resultUrls.length;

  while (toolRound < MAX_TOOL_ROUNDS) {
    toolRound++;
    let insideThink = false;

    try {
      // Sliding window: trim conversation if approaching context limit.
      // Reserve token budget for the vision image that will be attached.
      const systemMessage: ChatMessage = { role: 'system', content: CHAT_SYSTEM_PROMPT };
      const rawBudget = getInputBudget(context.sogniClient);
      const budget = visionDataUri ? rawBudget - VISION_IMAGE_TOKENS : rawBudget;
      const trimResult = trimConversation(updatedMessages, systemMessage, budget);
      if (trimResult.trimmedCount > 0) {
        console.log(`[CHAT SERVICE] Trimmed ${trimResult.trimmedCount} messages to fit context window`);
        // Replace conversation with trimmed version
        updatedMessages.splice(0, updatedMessages.length, ...trimResult.messages);
        callbacks.onContextTrimmed?.(trimResult.trimmedCount);
      }

      const allMessages: ChatMessage[] = [
        systemMessage,
        ...updatedMessages,
      ];

      // If a tool generated new results since last round, refresh the cached URI
      if (context.resultUrls.length > visionResultCount) {
        visionDataUri = await prepareVisionDataUri(context);
        visionResultCount = context.resultUrls.length;
      }

      // Attach cached vision context to the latest user message.
      // Only enhances the copy sent to the API; stored history stays text-only.
      if (visionDataUri) {
        let lastUserIdx = -1;
        for (let i = allMessages.length - 1; i >= 0; i--) {
          if (allMessages[i].role === 'user') {
            lastUserIdx = i;
            break;
          }
        }
        if (lastUserIdx >= 0 && typeof allMessages[lastUserIdx].content === 'string') {
          allMessages[lastUserIdx] = {
            ...allMessages[lastUserIdx],
            content: [
              { type: 'image_url', image_url: { url: visionDataUri } },
              { type: 'text', text: allMessages[lastUserIdx].content as string },
            ],
          };
        }
      }

      const stream = await sogniClient.chat.completions.create({
        model: context.model || CHAT_MODEL,
        messages: allMessages,
        tools: toolRegistry.getDefinitions(),
        tool_choice: 'auto',
        stream: true,
        tokenType: context.tokenType,
        ...CHAT_DEFAULT_PARAMS,
        // Override think param if explicitly specified by model variant
        ...(typeof context.think === 'boolean' ? { think: context.think } : {}),
      });

      // Stream tokens to UI (strip any leaked <think> blocks)
      for await (const chunk of stream) {
        if (chunk.content) {
          const { cleaned, insideThink: stillInThink } = stripThinkBlocks(chunk.content, insideThink);
          insideThink = stillInThink;
          if (cleaned) {
            callbacks.onToken(cleaned);
          }
        }
      }

      const result = stream.finalResult;

      if (!result) {
        callbacks.onError('No response from the AI assistant.');
        break;
      }

      // Check for tool calls
      if (result.finishReason === 'tool_calls' && result.tool_calls?.length) {
        // Safety: if the LLM's text ends with a confirmation question but also emits
        // tool calls, suppress the tool calls and treat as a text-only response.
        // This prevents the "Shall I proceed?" + immediate execution bug.
        // Only match question patterns near the END of the response (last 200 chars)
        // to avoid false positives from phrases like "this should improve quality".
        if (result.content) {
          const tail = result.content.slice(-200).toLowerCase();
          if (/\bshall i\b|\bshould i\b|\bdo you want\b|\bwould you like\b|\bwant me to\b|\bready to proceed\b/.test(tail) && /\?/.test(tail)) {
            console.log('[CHAT SERVICE] Suppressed tool calls — response ends with confirmation question');
            updatedMessages.push({ role: 'assistant', content: result.content });
            callbacks.onComplete(result.content);
            break;
          }
        }

        // Add assistant message with tool calls to conversation
        updatedMessages.push({
          role: 'assistant',
          content: result.content || null,
          tool_calls: result.tool_calls,
        });

        // Execute each tool call via the registry
        for (const toolCall of result.tool_calls) {
          const toolName = toolCall.function.name as ToolName;
          const args = parseChatToolArgs(toolCall);

          callbacks.onToolCall(toolName, args);

          try {
            const toolResult = await toolRegistry.execute(toolName, args, context, toolCallbacks);

            // Add tool result to conversation
            updatedMessages.push({
              role: 'tool',
              content: toolResult,
              tool_call_id: toolCall.id,
              name: toolName,
            });
          } catch (err: any) {
            const errorMsg = err.message || 'Tool execution failed';
            updatedMessages.push({
              role: 'tool',
              content: JSON.stringify({ error: errorMsg }),
              tool_call_id: toolCall.id,
              name: toolName,
            });
            callbacks.onToolProgress({
              type: 'error',
              toolName,
              error: errorMsg,
            });
          }
        }

        // Continue loop to get LLM's response to tool results
        continue;
      }

      // Normal text completion — add to conversation history and we're done
      const textContent = result.content || '';
      updatedMessages.push({
        role: 'assistant',
        content: textContent,
      });

      // Check for refusal when no tool calls were made
      if (textContent && detectRefusal(textContent)) {
        console.log('[CHAT SERVICE] Model refusal detected');
        callbacks.onModelRefusal?.(textContent);
      }

      callbacks.onComplete(textContent);
      break;
    } catch (err: any) {
      // Auto-switch token type if the chat API itself fails with insufficient credits
      if (isInsufficientCreditsError(err)) {
        const alternate = getAlternateToken(context.tokenType);
        if (hasBalance(context.balances, alternate)) {
          console.log(`[CHAT SERVICE] Chat API insufficient ${context.tokenType}, switching to ${alternate}`);
          context.tokenType = alternate;
          context.onTokenSwitch?.(alternate);
          toolRound--; // Don't count this failed attempt
          continue;    // Retry the loop with new tokenType
        }
        // Both exhausted
        context.onInsufficientCredits?.();
        callbacks.onError('You don\'t have enough credits. Please top up to continue.');
        break;
      }
      console.error('[CHAT SERVICE] Error:', err);
      callbacks.onError(err.message || 'Failed to get a response. Please try again.');
      break;
    }
  }

  if (toolRound >= MAX_TOOL_ROUNDS) {
    callbacks.onError('The assistant made too many tool calls. Please try a simpler request.');
  }

  return updatedMessages;
}

// ---------------------------------------------------------------------------
// sendVisionAnalysis
// ---------------------------------------------------------------------------

/**
 * Run a vision-model analysis on an uploaded image.
 * Returns the conversation history and full response text.
 * No tool calling is involved — this is a pure multimodal text completion.
 */
export async function sendVisionAnalysis(
  sogniClient: SogniClient,
  imageBase64DataUri: string,
  tokenType: TokenType,
  callbacks: Pick<ChatStreamCallbacks, 'onToken' | 'onComplete' | 'onError'>,
  options?: {
    systemPrompt?: string;
    userText?: string;
  },
): Promise<{ conversation: ChatMessage[]; fullContent: string }> {
  const userMessage: ChatMessage = {
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: imageBase64DataUri } },
      { type: 'text', text: options?.userText ?? 'Analyze this photo for restoration.' },
    ],
  };

  const messages: ChatMessage[] = [
    { role: 'system', content: options?.systemPrompt ?? VISION_ANALYSIS_SYSTEM_PROMPT },
    userMessage,
  ];

  let fullContent = '';
  let insideThink = false;

  try {
    const stream = await sogniClient.chat.completions.create({
      model: CHAT_MODEL,
      messages,
      stream: true,
      tokenType,
      ...CHAT_DEFAULT_PARAMS,
    });

    for await (const chunk of stream) {
      if (chunk.content) {
        const { cleaned, insideThink: stillInThink } = stripThinkBlocks(chunk.content, insideThink);
        insideThink = stillInThink;
        if (cleaned) {
          fullContent += cleaned;
          callbacks.onToken(cleaned);
        }
      }
    }

    const result = stream.finalResult;
    if (result?.content) {
      // finalResult may have content not yet streamed; use accumulated fullContent
      // which already has think blocks stripped
    }

    callbacks.onComplete(fullContent);

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: fullContent,
    };

    return {
      conversation: [userMessage, assistantMessage],
      fullContent,
    };
  } catch (err: any) {
    console.error('[CHAT SERVICE] Vision analysis error:', err);
    callbacks.onError(err.message || 'Failed to analyze the image.');
    return { conversation: [], fullContent: '' };
  }
}

// ---------------------------------------------------------------------------
// generateSessionTitle
// ---------------------------------------------------------------------------

/**
 * Generate a short session title from analysis text using the LLM.
 * Returns null on failure (non-critical operation).
 */
export async function generateSessionTitle(
  sogniClient: SogniClient,
  analysisText: string,
  tokenType: TokenType,
): Promise<string | null> {
  try {
    const stream = await sogniClient.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content: 'Write a short title (3-6 words) describing this photo. Return ONLY the title. No quotes, no punctuation, no explanation. Examples: Vintage Family Beach Portrait, Damaged Wedding Photo, Faded Military Group Shot',
        },
        { role: 'user', content: analysisText },
      ],
      stream: true,
      tokenType,
      temperature: 0.3,
      max_tokens: 30,
      think: false,
    });

    let title = '';
    let insideThink = false;
    for await (const chunk of stream) {
      if (chunk.content) {
        const { cleaned, insideThink: stillInThink } = stripThinkBlocks(chunk.content, insideThink);
        insideThink = stillInThink;
        title += cleaned;
      }
    }

    // Clean up: remove quotes, trailing punctuation, trim, take first line only
    title = title.split('\n')[0].replace(/^["']|["']$/g, '').replace(/[.!]$/, '').trim();

    if (title.length < 3 || title.length > 80) return null;
    return title;
  } catch (err) {
    console.error('[CHAT SERVICE] Failed to generate session title:', err);
    return null;
  }
}
