/**
 * Token estimation for chat messages.
 * Uses char/4 heuristic (matches SDK's approach) with fixed costs for
 * images and per-message overhead.
 */
import type { ChatMessage } from '@sogni-ai/sogni-client';

const CHARS_PER_TOKEN = 4;
const IMAGE_TOKENS_HIGH = 1_300; // ~1024px auto/high detail
const IMAGE_TOKENS_LOW = 340;    // low detail
const MESSAGE_OVERHEAD = 4;      // role, separators

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessageTokens(message: ChatMessage): number {
  let tokens = MESSAGE_OVERHEAD;

  if (typeof message.content === 'string') {
    tokens += estimateTextTokens(message.content);
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === 'text') {
        tokens += estimateTextTokens(part.text);
      } else if (part.type === 'image_url') {
        const detail = part.image_url.detail ?? 'auto';
        tokens += detail === 'low' ? IMAGE_TOKENS_LOW : IMAGE_TOKENS_HIGH;
      }
    }
  }

  if (message.tool_calls) {
    tokens += Math.ceil(JSON.stringify(message.tool_calls).length / CHARS_PER_TOKEN);
  }

  return tokens;
}

export function estimateTotalTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}
