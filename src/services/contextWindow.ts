/**
 * Sliding window context manager for chat conversations.
 * Trims older messages when total tokens approach the model's context limit,
 * preserving the most recent exchanges and inserting a placeholder when
 * image-bearing messages are dropped.
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

const IMAGE_PLACEHOLDER: ChatMessage = {
  role: 'user',
  content: '[Earlier: User uploaded a photo for restoration. Analysis was provided.]',
};

/**
 * Trim a conversation to fit within `inputBudget` tokens.
 *
 * Algorithm:
 * 1. If total tokens ≤ budget, return unchanged.
 * 2. Group into atomic units. Protect the last `MIN_PROTECTED_GROUPS` groups.
 * 3. Trim from oldest until under budget.
 * 4. If an image message was trimmed, insert a text placeholder.
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
  const trimmable = groups.slice(0, groups.length - protectedCount);
  const protectedGroups = groups.slice(groups.length - protectedCount);

  let currentTokens = systemTokens;
  for (const g of protectedGroups) currentTokens += g.tokens;

  let trimmedCount = 0;
  let imageWasTrimmed = false;
  const keptTrimmable: MessageGroup[] = [];

  // Keep from oldest to newest, stopping when adding would exceed budget
  for (const group of trimmable) {
    if (currentTokens + group.tokens <= inputBudget) {
      keptTrimmable.push(group);
      currentTokens += group.tokens;
    } else {
      trimmedCount += group.messages.length;
      if (group.hasImage) imageWasTrimmed = true;
    }
  }

  // Rebuild
  const result: ChatMessage[] = [];

  if (imageWasTrimmed) {
    result.push(IMAGE_PLACEHOLDER);
  }

  for (const g of keptTrimmable) result.push(...g.messages);
  for (const g of protectedGroups) result.push(...g.messages);

  return {
    messages: result,
    trimmedCount,
    insertedSummary: imageWasTrimmed,
  };
}
