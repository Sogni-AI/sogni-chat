/**
 * Tool definition for animate_photo.
 * Extracted from the superapp's chatTools.ts ANIMATE_PHOTO_TOOL.
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';
import { ASPECT_RATIO_DESCRIPTION } from '../shared';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'animate_photo',
    description:
      'Animate a photo into video with motion, audio, and dialogue. LTX 2.3 generates audio natively — describe audio in the prompt. Do NOT use sound_to_video or generate_music for dialogue/audio. Auto-uses latest result unless sourceImageIndex is set. If the request is vague, analyze the image first and suggest 2-3 specific animation ideas tailored to what you see. Only call once you have clear creative intent.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Describe MOTION, ACTION, SOUND, and CAMERA — not the static image content. 2-4 present-tense sentences.

WAN 2.2 ("wan22"): 30-150 words. Describe actions, camera movement, atmosphere. Keep movements subtle and natural.

LTX 2.3 ("ltx23"): Scene description is auto-generated from the image — describe only motion, sound, and camera.
- ACTION: One main thread of motion with temporal connectors ("as", "then", "while").
- SOUND: Ambient sounds, music, or dialogue woven into prose. LTX 2.3 generates audio natively.
- CAMERA: Camera movement ("slow push-in", "static tripod", etc.). End with "The footage remains smooth and stabilised throughout."

DIALOGUE (LTX 2.3): Write ACTUAL spoken words in double quotes. Never summarize as "they argue about X" — write what they say. Create appropriate dialogue if user implies conversation without exact words.

For specific characters (movies, TV): describe visual appearance (clothing, hair, build) — don't rely on names alone.

For complex/creative scenes (characters talking, skits), capture full creative intent — system auto-expands into detailed prompt.

Present tense. Positive phrasing. No vague words ("beautiful", "nice") — use concrete sensory details. Subtle, natural movements.`,
        },
        videoModel: {
          type: 'string',
          enum: ['ltx23', 'wan22'],
          description:
            'Which video model to use. "ltx23" (default): LTX 2.3 distilled, 8-step, fast + high quality with audio. "wan22": Fast 4-step, simple motion, no audio. Use ltx23 for most requests. Use wan22 for quick simple motions without audio. Default: "ltx23".',
        },
        duration: {
          type: 'number',
          description:
            'Video duration in seconds. Default: 5. Use when the user explicitly requests a specific length (e.g., "make a 10 second video"). Range: 2-20.',
        },
        sourceImageIndex: {
          type: 'number',
          description:
            'Which result image to animate (0-based index). Omit to use the latest result automatically (or the original if no results exist). Only set explicitly when the user specifies a particular image number or explicitly says "original" (use -1 for original).',
        },
        numberOfVariations: {
          type: 'number',
          description:
            'Number of variations (1-16). Use 1 unless user requests multiple. Default: 1.',
          minimum: 1,
          maximum: 16,
        },
        aspectRatio: {
          type: 'string',
          description: ASPECT_RATIO_DESCRIPTION,
        },
        frameMode: {
          type: 'string',
          enum: ['first', 'last'],
          description:
            'Which frame the source image anchors. "first" (default): image is the first frame — video animates forward from it. "last": image is the LAST frame — video generates motion that ends at the image (LTX 2.3 only). Use "last" when the user says "end at this image", "use as last frame", "arrive at this pose", or similar.',
        },
      },
      required: ['prompt'],
    },
  },
};
