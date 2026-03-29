/**
 * Sliding window context manager for chat conversations.
 *
 * Two-phase compression:
 *   Phase 1 — Observation Masking: compress old tool *outputs* to compact
 *     summaries while preserving assistant reasoning and user messages.
 *   Phase 2 — Enriched Trim: when groups must be dropped, build a result
 *     manifest so the LLM can reference old results by description.
 *
 * Research: JetBrains tested observation masking with Qwen3 — 52% cost
 * reduction, 2.6% accuracy improvement vs keeping full payloads.
 */
import type { ChatMessage } from '@sogni-ai/sogni-client';
import type { SogniClient } from '@sogni-ai/sogni-client';
import { estimateMessageTokens, estimateTotalTokens } from './tokenEstimation';
import { CHAT_MODEL, CONTEXT_WINDOW_CONFIG } from '@/config/chat';

const {
  DEFAULT_CONTEXT_LENGTH,
  MAX_OUTPUT_TOKENS,
  SAFETY_MARGIN,
  TOOL_SCHEMA_TOKENS,
  MIN_PROTECTED_GROUPS,
} = CONTEXT_WINDOW_CONFIG;

/**
 * Compute the available input token budget for a conversation.
 */
export function getInputBudget(sogniClient: SogniClient): number {
  let contextLength: number = DEFAULT_CONTEXT_LENGTH;
  try {
    const modelInfo = sogniClient.chat?.models?.[CHAT_MODEL];
    if (modelInfo?.maxContextLength && modelInfo.maxContextLength > 0) {
      contextLength = modelInfo.maxContextLength;
    }
  } catch {
    // Fall back to default
  }
  return contextLength - MAX_OUTPUT_TOKENS - SAFETY_MARGIN - TOOL_SCHEMA_TOKENS;
}

/** A group of messages that must be kept together (e.g. tool_call + tool response) */
interface MessageGroup {
  messages: ChatMessage[];
  tokens: number;
  hasImage: boolean;
}

/**
 * Group conversation messages into atomic units.
 * An assistant message with tool_calls is grouped with following tool responses.
 * All other messages are their own group.
 */
function groupMessages(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let i = 0;

  while (i < messages.length) {
    const msg = messages[i];

    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      // Group: assistant tool_call + all following tool responses
      const group: ChatMessage[] = [msg];
      let tokens = estimateMessageTokens(msg);
      const groupHasImage = contentHasImage(msg);
      i++;

      while (i < messages.length && messages[i].role === 'tool') {
        group.push(messages[i]);
        tokens += estimateMessageTokens(messages[i]);
        i++;
      }

      groups.push({ messages: group, tokens, hasImage: groupHasImage });
    } else {
      const tokens = estimateMessageTokens(msg);
      const hasImage = contentHasImage(msg);
      groups.push({ messages: [msg], tokens, hasImage });
      i++;
    }
  }

  return groups;
}

function contentHasImage(msg: ChatMessage): boolean {
  if (!Array.isArray(msg.content)) return false;
  return msg.content.some((p) => p.type === 'image_url');
}

// ---------------------------------------------------------------------------
// Phase 1: Observation Masking
// ---------------------------------------------------------------------------

/** Tools whose results contain LLM-useful analysis text — never mask these. */
const UNMASKABLE_TOOLS = new Set(['analyze_image']);

/**
 * Compress old tool result payloads to compact summaries.
 * Preserves assistant tool_calls and follow-up text — only compresses tool outputs.
 * Returns masked groups with updated token counts.
 */
function maskOldToolResults(
  groups: MessageGroup[],
  protectedCount: number,
): { groups: MessageGroup[]; tokensSaved: number } {
  const maskBoundary = groups.length - protectedCount;
  let tokensSaved = 0;

  const masked = groups.map((group, i) => {
    if (i >= maskBoundary) return group;

    let groupTokensSaved = 0;
    const maskedMessages = group.messages.map((msg) => {
      if (msg.role !== 'tool') return msg;
      if (msg.name && UNMASKABLE_TOOLS.has(msg.name)) return msg;

      const originalTokens = estimateMessageTokens(msg);
      try {
        const parsed = JSON.parse(typeof msg.content === 'string' ? msg.content : '');
        // Already masked from a previous pass
        if ('ok' in parsed && Object.keys(parsed).length <= 4) return msg;

        const compact: Record<string, unknown> = parsed.error
          ? { ok: false, error: parsed.error }
          : { ok: true, n: parsed.resultCount || 1 };
        // Preserve startIndex / videoStartIndex so the enriched summary can include index offsets
        if (parsed.startIndex !== undefined) compact.i = parsed.startIndex;
        if (parsed.videoStartIndex !== undefined) compact.vi = parsed.videoStartIndex;
        const maskedMsg: ChatMessage = { ...msg, content: JSON.stringify(compact) };
        const saved = originalTokens - estimateMessageTokens(maskedMsg);
        groupTokensSaved += saved;
        return maskedMsg;
      } catch {
        return msg;
      }
    });

    tokensSaved += groupTokensSaved;
    return {
      messages: maskedMessages,
      tokens: group.tokens - groupTokensSaved,
      hasImage: group.hasImage,
    };
  });

  return { groups: masked, tokensSaved };
}

// ---------------------------------------------------------------------------
// Phase 2: Enriched Trim Summary
// ---------------------------------------------------------------------------

const VIDEO_TOOLS = new Set(['animate_photo', 'generate_video', 'sound_to_video', 'video_to_video']);
const AUDIO_TOOLS = new Set(['generate_music']);

/**
 * Build a concise summary with a result manifest from trimmed groups.
 * Extracts tool names, prompt excerpts, and result counts so the LLM can
 * reference old results by description even after the full context is gone.
 */
function buildEnrichedSummary(trimmedGroups: MessageGroup[]): ChatMessage | null {
  const events: string[] = [];
  let hasUpload = false;
  const generatedItems: string[] = [];

  for (const group of trimmedGroups) {
    // Detect uploads and skip existing placeholders
    for (const msg of group.messages) {
      if (msg.role === 'user' && typeof msg.content === 'string' && msg.content.includes('[Earlier:')) continue;
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        if (msg.content.some((p: { type: string }) => p.type === 'image_url')) {
          hasUpload = true;
        }
      }
    }

    // Pair tool_calls with their results by tool_call_id (not positional index)
    const toolCallsMsg = group.messages.find(
      (m) => m.role === 'assistant' && m.tool_calls?.length,
    );
    const toolResultMap = new Map<string, ChatMessage>();
    for (const m of group.messages) {
      if (m.role === 'tool' && m.tool_call_id) toolResultMap.set(m.tool_call_id, m);
    }

    if (toolCallsMsg?.tool_calls) {
      for (const tc of toolCallsMsg.tool_calls) {
        const result = toolResultMap.get(tc.id);
        const name: string = tc.function.name;

        // Extract result count and startIndex/videoStartIndex (handles both full and masked formats)
        let count = 1;
        let startIndex: number | undefined;
        let videoStartIndex: number | undefined;
        if (result) {
          try {
            const parsed = JSON.parse(typeof result.content === 'string' ? result.content : '');
            if (parsed.error || parsed.ok === false) continue; // Skip failed tools
            count = parsed.n ?? parsed.resultCount ?? 1;
            startIndex = parsed.i ?? parsed.startIndex;
            videoStartIndex = parsed.vi ?? parsed.videoStartIndex;
          } catch { /* use default */ }
        }

        // Extract and truncate prompt, collapsing dynamic syntax
        let promptExcerpt = '';
        try {
          const args = JSON.parse(tc.function.arguments);
          if (args.prompt) {
            promptExcerpt = args.prompt
              .replace(/\{[^}]*\}/g, '(varied)')
              .slice(0, 50)
              .trim();
            if (args.prompt.length > 50) promptExcerpt += '…';
          }
        } catch { /* no excerpt */ }

        const mediaType = VIDEO_TOOLS.has(name)
          ? 'video' : AUDIO_TOOLS.has(name) ? 'audio' : 'image';
        // Include index range when available (e.g., "2 images #0-1")
        // For video tools, prefer videoStartIndex over startIndex
        const effectiveStartIndex = VIDEO_TOOLS.has(name) ? videoStartIndex : startIndex;
        const indexRange = effectiveStartIndex !== undefined
          ? (count > 1 ? ` #${effectiveStartIndex}-${effectiveStartIndex + count - 1}` : ` #${effectiveStartIndex}`)
          : '';
        const label = `${count} ${mediaType}${count > 1 ? 's' : ''}${indexRange}`;
        const entry = promptExcerpt
          ? `${label} (${name}, "${promptExcerpt}")`
          : `${label} (${name})`;
        generatedItems.push(entry);
      }
    }
  }

  if (hasUpload) events.push('User uploaded media');
  if (generatedItems.length > 0) events.push(`Generated: ${generatedItems.join(', ')}`);

  if (events.length === 0) return null;

  return {
    role: 'user' as const,
    content: `[Earlier: ${events.join('. ')}. Details trimmed.]`,
  };
}

// ---------------------------------------------------------------------------
// Main: trimConversation
// ---------------------------------------------------------------------------

/**
 * Trim a conversation to fit within `inputBudget` tokens.
 *
 * Algorithm:
 * 1. If total tokens ≤ budget, return unchanged.
 * 2. Group into atomic units. Protect the last `MIN_PROTECTED_GROUPS` groups.
 * 3. Phase 1: Mask old tool results — if that's enough, return masked messages.
 * 4. Phase 2: Trim oldest groups, inserting an enriched summary with result manifest.
 */
export function trimConversation(
  messages: ChatMessage[],
  systemMessage: ChatMessage,
  inputBudget: number,
): { messages: ChatMessage[]; trimmedCount: number; insertedSummary: boolean } {
  const systemTokens = estimateMessageTokens(systemMessage);
  const totalTokens = systemTokens + estimateTotalTokens(messages);

  if (totalTokens <= inputBudget) {
    return { messages, trimmedCount: 0, insertedSummary: false };
  }

  const groups = groupMessages(messages);

  // Nothing trimmable — need at least MIN_PROTECTED_GROUPS to keep
  if (groups.length <= MIN_PROTECTED_GROUPS) {
    return { messages, trimmedCount: 0, insertedSummary: false };
  }

  const protectedCount = Math.min(MIN_PROTECTED_GROUPS, groups.length);

  // Phase 1: Mask old tool results to reclaim tokens
  const { groups: maskedGroups, tokensSaved } = maskOldToolResults(groups, protectedCount);

  if (tokensSaved > 0) {
    console.log(`[CONTEXT] Observation masking saved ${tokensSaved} tokens`);
  }

  const maskedTotal = systemTokens + maskedGroups.reduce((sum, g) => sum + g.tokens, 0);
  if (maskedTotal <= inputBudget) {
    // Masking alone was enough — no groups dropped
    return {
      messages: maskedGroups.flatMap(g => g.messages),
      trimmedCount: 0,
      insertedSummary: false,
    };
  }

  // Phase 2: Still over budget — trim oldest masked groups
  const trimmable = maskedGroups.slice(0, maskedGroups.length - protectedCount);
  const protectedGroups = maskedGroups.slice(maskedGroups.length - protectedCount);

  let protectedTokens = systemTokens;
  for (const g of protectedGroups) protectedTokens += g.tokens;

  // Drop contiguously from the oldest end until under budget.
  // Never skip a group — this preserves chronological continuity.
  // Reserve ~50 tokens for the enriched summary that will be inserted.
  const SUMMARY_RESERVE = 50;
  const effectiveBudget = inputBudget - SUMMARY_RESERVE;
  let dropCount = 0;
  let trimmableTotal = trimmable.reduce((sum, g) => sum + g.tokens, 0);
  while (dropCount < trimmable.length && protectedTokens + trimmableTotal > effectiveBudget) {
    trimmableTotal -= trimmable[dropCount].tokens;
    dropCount++;
  }

  // If protected groups alone exceed budget, log a warning — we can't trim further
  if (protectedTokens > inputBudget) {
    console.warn(`[CONTEXT] Protected groups (${protectedTokens} tokens) exceed input budget (${inputBudget}) — API call may be truncated`);
  }

  const trimmedGroups = trimmable.slice(0, dropCount);
  const keptTrimmable = trimmable.slice(dropCount);
  let trimmedCount = 0;
  for (const g of trimmedGroups) trimmedCount += g.messages.length;

  // Rebuild
  const result: ChatMessage[] = [];
  let insertedSummary = false;

  const summary = buildEnrichedSummary(trimmedGroups);
  if (summary) {
    result.push(summary);
    insertedSummary = true;
  }

  for (const g of keptTrimmable) result.push(...g.messages);
  for (const g of protectedGroups) result.push(...g.messages);

  console.log(`[CONTEXT] Trimmed ${trimmedCount} messages after masking (${trimmedGroups.length} groups dropped, ${keptTrimmable.length} kept)`);

  return {
    messages: result,
    trimmedCount,
    insertedSummary,
  };
}
