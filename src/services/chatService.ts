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

  while (toolRound < MAX_TOOL_ROUNDS) {
    toolRound++;
    let insideThink = false;

    try {
      // Sliding window: trim conversation if approaching context limit
      const systemMessage: ChatMessage = { role: 'system', content: CHAT_SYSTEM_PROMPT };
      const budget = getInputBudget(context.sogniClient);
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

      const stream = await sogniClient.chat.completions.create({
        model: context.model || CHAT_MODEL,
        messages: allMessages,
        tools: toolRegistry.getDefinitions(),
        tool_choice: 'auto',
        stream: true,
        tokenType: context.tokenType,
        ...CHAT_DEFAULT_PARAMS,
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
): Promise<{ conversation: ChatMessage[]; fullContent: string }> {
  const userMessage: ChatMessage = {
    role: 'user',
    content: [
      { type: 'image_url', image_url: { url: imageBase64DataUri } },
      { type: 'text', text: 'Analyze this photo for restoration.' },
    ],
  };

  const messages: ChatMessage[] = [
    { role: 'system', content: VISION_ANALYSIS_SYSTEM_PROMPT },
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
