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
import { getAllPersonas } from '@/utils/userDataDB';

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
  onGallerySaved?: (galleryImageIds: string[], galleryVideoIds: string[], galleryAudioIds?: string[]) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TOOL_ROUNDS = 5;

/** Token overhead for a vision image (matches IMAGE_TOKENS_HIGH in tokenEstimation.ts) */
const VISION_IMAGE_TOKENS = 1_300;

// ---------------------------------------------------------------------------
// Persona & Memory context helpers
// ---------------------------------------------------------------------------

/** Build compact persona context for system message injection (capped at 8 names) */
async function buildPersonaContext(): Promise<string> {
  try {
    const personas = await getAllPersonas();
    if (personas.length === 0) return '';
    const MAX_PERSONAS = 8;
    const shown = personas.slice(0, MAX_PERSONAS);
    let result = shown.map(p => {
      const nicknames = p.tags?.length ? ` aka ${p.tags.join('/')}` : '';
      return `${p.name}${nicknames} (${p.relationship})`;
    }).join(', ');
    if (personas.length > MAX_PERSONAS) {
      result += ` and ${personas.length - MAX_PERSONAS} more`;
    }
    return result;
  } catch (err) {
    console.warn('[CHAT SERVICE] Failed to build persona context:', err);
    return '';
  }
}

/**
 * Prepare vision-ready data URIs from uploaded images.
 * These don't change between tool rounds so we cache them.
 */
async function prepareUploadedImageUris(context: ToolExecutionContext): Promise<string[]> {
  const uris: string[] = [];
  try {
    const imgFiles = context.uploadedFiles.filter(f => f.type === 'image');
    for (const imgFile of imgFiles) {
      const buf = imgFile.data.buffer.slice(
        imgFile.data.byteOffset,
        imgFile.data.byteOffset + imgFile.data.byteLength,
      ) as ArrayBuffer;
      const blobUrl = URL.createObjectURL(new Blob([buf], { type: imgFile.mimeType }));
      try {
        uris.push(await resizeImageForVision(blobUrl));
      } catch (err) {
        console.warn('[CHAT SERVICE] Vision image preparation failed for file:', imgFile.filename, err);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    }
    // Fallback: legacy imageData field when uploadedFiles is empty
    if (uris.length === 0 && context.imageData) {
      const buf = context.imageData.buffer.slice(
        context.imageData.byteOffset,
        context.imageData.byteOffset + context.imageData.byteLength,
      ) as ArrayBuffer;
      const blobUrl = URL.createObjectURL(new Blob([buf], { type: 'image/jpeg' }));
      try {
        uris.push(await resizeImageForVision(blobUrl));
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    }
  } catch (err) {
    console.warn('[CHAT SERVICE] Vision image preparation failed:', err);
  }
  return uris;
}

/**
 * Prepare the latest tool result as a vision data URI.
 * Returns null if the latest result is not an image (audio/video).
 */
async function prepareLatestResultUri(context: ToolExecutionContext): Promise<string | null> {
  if (context.resultUrls.length === 0) return null;
  try {
    return await resizeImageForVision(context.resultUrls[context.resultUrls.length - 1]);
  } catch {
    // Latest result is not an image (audio/video) — skip it
    return null;
  }
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
  let streamNullRetries = 0;

  // Build persona context once (not per tool round)
  const personaContext = await buildPersonaContext();
  const dynamicSystemPrompt = CHAT_SYSTEM_PROMPT
    + (personaContext
      ? `\nUser's people: ${personaContext}. When creating images of these people: call resolve_personas first, then use edit_image (never generate_image). When creating videos of these people: ALWAYS generate an image first (resolve_personas → edit_image), then use animate_photo on that image — never use generate_video directly for personas. Pronouns like "us", "we", "our" refer to these people — always call resolve_personas again for each new image generation, even in follow-up messages. If user mentions someone not listed, suggest adding them to My Personas.`
      : '');

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

  // Cache uploaded image URIs — refreshed if tools modify context.uploadedFiles
  // (e.g. resolve_personas injects persona photos).
  let uploadedImageUris = await prepareUploadedImageUris(context);
  let lastUploadedFilesRef = context.uploadedFiles;
  let latestResultUri = await prepareLatestResultUri(context);
  let visionResultCount = context.resultUrls.length;
  let visionDataUris = latestResultUri
    ? [latestResultUri, ...uploadedImageUris]
    : uploadedImageUris;

  while (toolRound < MAX_TOOL_ROUNDS) {
    toolRound++;
    let insideThink = false;
    let insideToolCall = false;

    try {
      // Sliding window: trim conversation if approaching context limit.
      // Reserve token budget for the vision image that will be attached.
      const systemMessage: ChatMessage = { role: 'system', content: dynamicSystemPrompt };
      const rawBudget = getInputBudget(context.sogniClient);
      const budget = visionDataUris.length > 0 ? rawBudget - VISION_IMAGE_TOKENS * visionDataUris.length : rawBudget;
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

      // If a tool generated new results since last round, only refresh the result URI
      if (context.resultUrls.length > visionResultCount) {
        latestResultUri = await prepareLatestResultUri(context);
        visionResultCount = context.resultUrls.length;
        visionDataUris = latestResultUri
          ? [latestResultUri, ...uploadedImageUris]
          : uploadedImageUris;
      }

      // Annotate the latest user message with non-image file info so the LLM
      // knows audio/video files are attached (they can't be sent as multimodal content).
      // Only enhances the API copy; stored history stays unchanged.
      const nonImageFiles = context.uploadedFiles.filter(f => f.type !== 'image');
      if (nonImageFiles.length > 0) {
        let lastUserIdx = -1;
        for (let i = allMessages.length - 1; i >= 0; i--) {
          if (allMessages[i].role === 'user') {
            lastUserIdx = i;
            break;
          }
        }
        if (lastUserIdx >= 0 && typeof allMessages[lastUserIdx].content === 'string') {
          const fileList = nonImageFiles.map(f => `${f.filename} (${f.type})`).join(', ');
          allMessages[lastUserIdx] = {
            ...allMessages[lastUserIdx],
            content: `[Attached files: ${fileList}]\n${allMessages[lastUserIdx].content}`,
          };
        }
      }

      // Attach cached vision context to the latest user message.
      // Only enhances the copy sent to the API; stored history stays text-only.
      if (visionDataUris.length > 0) {
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
              ...visionDataUris.map(uri => ({ type: 'image_url' as const, image_url: { url: uri } })),
              { type: 'text' as const, text: allMessages[lastUserIdx].content as string },
            ],
          };
        }
      }

      // On the final allowed round, omit tools so the LLM is forced to produce
      // a text summary instead of making another tool call that would exceed the limit.
      const isLastRound = toolRound >= MAX_TOOL_ROUNDS;
      const stream = await sogniClient.chat.completions.create({
        model: context.model || CHAT_MODEL,
        messages: allMessages,
        ...(!isLastRound && {
          tools: toolRegistry.getDefinitions(),
          tool_choice: 'auto',
        }),
        stream: true,
        tokenType: context.tokenType,
        ...CHAT_DEFAULT_PARAMS,
        // Override think param if explicitly specified by model variant
        ...(typeof context.think === 'boolean' ? { think: context.think } : {}),
      });

      // Stream tokens to UI (strip any leaked <think> blocks)
      for await (const chunk of stream) {
        if (context.signal?.aborted) {
          console.log('[CHAT SERVICE] Request aborted during streaming — breaking');
          break;
        }
        if (chunk.content) {
          const { cleaned, insideThink: stillInThink, insideToolCall: stillInToolCall } = stripThinkBlocks(chunk.content, insideThink, insideToolCall);
          insideThink = stillInThink;
          insideToolCall = stillInToolCall;
          if (cleaned) {
            callbacks.onToken(cleaned);
          }
        }
      }

      const result = stream.finalResult;

      if (!result) {
        if (streamNullRetries < 1) {
          streamNullRetries++;
          console.warn(`[CHAT SERVICE] Null stream result on round ${toolRound}, retrying (attempt ${streamNullRetries})...`);
          continue;
        }
        console.error(`[CHAT SERVICE] Null stream result after retry — round: ${toolRound}, msgs: ${updatedMessages.length}`);
        callbacks.onComplete(
          "I wasn't able to complete that response. Could you try rephrasing your request?"
        );
        break;
      }

      // Check for tool calls
      if (result.finishReason === 'tool_calls' && result.tool_calls?.length) {
        // Safety: if the LLM's text ends with a confirmation question but also emits
        // tool calls, suppress the tool calls and treat as a text-only response.
        // This prevents the "Shall I proceed?" + immediate execution bug.
        // Only match question patterns near the END of the response (last 500 chars)
        // to avoid false positives from phrases like "this should improve quality".
        if (result.content) {
          const tail = result.content.slice(-500).toLowerCase();
          // Don't match inside quoted speech (common in dialogue-heavy prompts)
          const unquotedTail = tail.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, '');
          const confirmPattern = /\b(shall i|should i|do you want|would you like|want me to|ready to proceed|like me to)\b/;
          if (confirmPattern.test(unquotedTail) && /\?\s*$/.test(unquotedTail)) {
            const match = unquotedTail.match(confirmPattern);
            console.log(`[CHAT SERVICE] Suppressed tool calls — matched: "${match?.[0]}" in last 500 chars`);
            updatedMessages.push({ role: 'assistant', content: result.content });
            callbacks.onComplete(result.content);
            break;
          }
        }

        // Guardrail: if the LLM chose generate_image but persona reference
        // photos are loaded in context, redirect to edit_image before recording
        // the tool call in conversation history.  generate_image cannot use
        // reference photos for identity preservation.
        const EDIT_IMAGE_MODELS = new Set(['qwen-lightning', 'qwen', 'flux2']);
        const hasPersonaPhotos = context.uploadedFiles?.some(f => f.filename?.startsWith('persona-'));
        for (const toolCall of result.tool_calls) {
          if (toolCall.function.name === 'generate_image' && hasPersonaPhotos) {
            console.log('[CHAT SERVICE] Redirecting generate_image → edit_image (persona photos in context)');
            toolCall.function.name = 'edit_image';
            // Sanitize args: drop generate_image-only params and validate model
            try {
              const parsed = JSON.parse(toolCall.function.arguments);
              delete parsed.negativePrompt;
              delete parsed.starting_image_strength;
              delete parsed.sourceImageIndex;
              delete parsed.seed;
              delete parsed.guidance;
              if (parsed.model && !EDIT_IMAGE_MODELS.has(parsed.model)) {
                console.log(`[CHAT SERVICE] Dropping incompatible model "${parsed.model}" for edit_image`);
                delete parsed.model;
              }
              toolCall.function.arguments = JSON.stringify(parsed);
            } catch {
              // args will be parsed again downstream; skip sanitization
            }
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

            // Parse result to detect errors from the registry (it catches handler
            // exceptions and returns error JSON strings rather than throwing).
            // NOTE: We intentionally do NOT fire onToolProgress({ type: 'error' })
            // here. The error result is already in the conversation history for the
            // LLM to see. On the next round, the LLM will either retry with a
            // different tool (making a UI error flash confusing) or explain the
            // failure in text (making an error box redundant). Showing the error
            // briefly before the LLM responds caused a distracting "flash" effect.
            let parsed: Record<string, unknown> | null = null;
            try {
              parsed = JSON.parse(toolResult);
            } catch {
              console.warn(`[CHAT SERVICE] Tool "${toolName}" returned non-JSON result — wrapping`);
              parsed = { success: true, raw: toolResult.slice(0, 500) };
            }

            if (parsed?.error) {
              console.warn(`[CHAT SERVICE] Tool "${toolName}" error: ${parsed.error}`);
            } else if (parsed && !('success' in parsed)) {
              console.warn(`[CHAT SERVICE] Tool "${toolName}" result missing success field`);
            }
          } catch (err: any) {
            const errorMsg = err.message || 'Tool execution failed';
            console.warn(`[CHAT SERVICE] Tool "${toolName}" threw: ${errorMsg}`);
            updatedMessages.push({
              role: 'tool',
              content: JSON.stringify({ error: errorMsg }),
              tool_call_id: toolCall.id,
              name: toolName,
            });
          }
        }

        // Refresh vision URIs if uploadedFiles was replaced (e.g. by resolve_personas)
        if (context.uploadedFiles !== lastUploadedFilesRef) {
          uploadedImageUris = await prepareUploadedImageUris(context);
          lastUploadedFilesRef = context.uploadedFiles;
          visionDataUris = latestResultUri
            ? [latestResultUri, ...uploadedImageUris]
            : uploadedImageUris;
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
  let insideToolCall = false;

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
        const { cleaned, insideThink: stillInThink, insideToolCall: stillInToolCall } = stripThinkBlocks(chunk.content, insideThink, insideToolCall);
        insideThink = stillInThink;
        insideToolCall = stillInToolCall;
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
    let insideToolCall = false;
    for await (const chunk of stream) {
      if (chunk.content) {
        const { cleaned, insideThink: stillInThink, insideToolCall: stillInToolCall } = stripThinkBlocks(chunk.content, insideThink, insideToolCall);
        insideThink = stillInThink;
        insideToolCall = stillInToolCall;
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
