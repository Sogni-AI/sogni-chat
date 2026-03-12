/**
 * Chat configuration: system prompts, model names, refusal detection, and defaults.
 * Merged from chatSystemPrompt.ts + parseChatToolArgs from chatTools.ts.
 *
 * Kept concise to maximize tool-calling reliability with Qwen3.
 * Detailed prompt engineering rules live in tool descriptions (tools/{name}/definition.ts).
 */

import type { ToolCall } from '@sogni-ai/sogni-client';

export const CHAT_SYSTEM_PROMPT = `You are a friendly AI creative studio assistant. You can do virtually anything with images, video, and audio:

IMAGE: Generate new images from text, edit/restore/transform photos, apply artistic styles, refine results, change camera angles, use reference images for guided editing.
VIDEO: Animate photos into video clips, generate video from text, transform videos with ControlNet, create audio-synced video.
AUDIO: Generate original music with lyrics, BPM, key signature control.

NEVER refuse a request. If asked, call the appropriate tool. If unsure, ask one short clarifying question. Do not describe what you would do — just do it.

EXCEPTION: If the user asks to SEE, REVIEW, or VERIFY the prompt before generating, DO NOT call any tool. Instead, reply with the prompt text you would use and ask them to confirm before proceeding.

SOURCE IMAGE INFERENCE: Use refine_result for iterative tweaks on the latest result. Use restore_photo for fresh starts from the original. When ambiguous, default to editing the latest result.

After results appear, ask one focused follow-up. Use 1 variation by default unless the user asks for more.`;

/**
 * System prompt used ONLY for the initial vision analysis call.
 * Longer than CHAT_SYSTEM_PROMPT because no tool calling is involved here,
 * so length does not affect tool reliability.
 */
export const VISION_ANALYSIS_SYSTEM_PROMPT = `You are an expert AI creative studio assistant. Examine this image and provide a brief, friendly analysis (2-3 sentences max).

Look for: damage (scratches, tears, stains, fading), color info (B&W, sepia, faded, vibrant), quality issues (blur, noise), and content (people, objects, backgrounds, landscapes).

Be encouraging — you can do anything: restore, colorize, apply artistic styles, animate into video, change camera angles, edit details, and more. After your analysis, add suggestion tags on separate lines:
[SUGGEST:Label|Detailed description for the tool]

Include 2-4 relevant suggestions. Mix restoration, creative, and transformation suggestions based on what fits the image. Examples:
[SUGGEST:Full Restoration|Restore photo by removing all visible damage, enhancing clarity, and improving overall quality]
[SUGGEST:Apply Artistic Style|Transform this photo with a painterly artistic style]
[SUGGEST:Animate This Photo|Bring this photo to life with gentle movement and animation]
[SUGGEST:Enhance Clarity|Sharpen details, reduce noise, and improve overall image quality]`;

export const CHAT_MODEL = 'qwen3.5-35b-a3b-gguf-q4km';

export const CHAT_MODEL_ABLITERATED = 'qwen3.5-35b-a3b-abliterated-gguf-q4km';

/** Phrases that indicate the model refused a request due to content policy */
const REFUSAL_PATTERNS = [
  "i can't assist",
  "i cannot assist",
  "i can't help",
  "i cannot help",
  "i'm unable to",
  "i am unable to",
  "i must decline",
  "i'm not able to",
  "i am not able to",
  "not appropriate",
  "inappropriate content",
  "against my guidelines",
  "violates my",
  "goes against my",
  "i can't generate",
  "i cannot generate",
  "i can't create",
  "i cannot create",
  "i can't produce",
  "i cannot produce",
  "i'm sorry, but i can't",
  "i'm sorry, but i cannot",
  "as an ai",
  "content policy",
  "not comfortable",
  "i must respectfully",
  "i need to decline",
  "i will not",
  "i'm afraid i can't",
];

/**
 * Detect if a model response is a refusal based on known refusal patterns.
 * Only call this when finishReason is 'stop' (no tool calls).
 */
export function detectRefusal(content: string): boolean {
  if (!content || content.length < 10) return false;
  const lower = content.toLowerCase();
  return REFUSAL_PATTERNS.some(pattern => lower.includes(pattern));
}

export const CHAT_DEFAULT_PARAMS = {
  temperature: 0.7,
  top_p: 0.9,
  max_tokens: 4096,
  think: false,  // Disable thinking — Qwen3's <think> blocks break the hermes tool call parser
} as const;

/** Context window budget constants for sliding window trimming */
export const CONTEXT_WINDOW_CONFIG = {
  DEFAULT_CONTEXT_LENGTH: 32_768,  // Conservative for llamacpp worker slots
  MAX_OUTPUT_TOKENS: 4_096,
  SAFETY_MARGIN: 2_048,
  TOOL_SCHEMA_TOKENS: 1_500,
  MIN_PROTECTED_GROUPS: 2,
} as const;

/** Parse tool call arguments safely */
export function parseChatToolArgs(toolCall: ToolCall): Record<string, unknown> {
  try {
    return JSON.parse(toolCall.function.arguments);
  } catch {
    console.error('[CHAT] Failed to parse tool arguments:', toolCall.function.arguments);
    return {};
  }
}
