/**
 * Tool definition for generate_video.
 * Based on workflow_text_to_video.mjs — text-to-video without a source image.
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';
import { ASPECT_RATIO_DESCRIPTION } from '../shared';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'generate_video',
    description:
      'Generate a video from text — no source image. LTX 2.3 generates audio natively (dialogue, sounds, music) — describe audio in the prompt. For animating an existing photo, use animate_photo. Do NOT use for My Personas — instead: resolve_personas → edit_image → animate_photo. If the request is vague, ask about vision/mood/style first. If an image exists, analyze it and suggest 2-3 tailored directions. Only call once you have clear creative intent.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Text description of the video. 2-4 present-tense sentences capturing scene, action, atmosphere, sound, and camera.

For complex/creative scenes (characters, dialogue, skits): capture the full creative intent — who, what they say, what happens, tone and style. The system auto-expands into a detailed prompt.

DIALOGUE: Write ACTUAL spoken words in double quotes. Never summarize as "they argue about X" — write what they say. Create appropriate dialogue if user implies conversation without exact words.

For specific characters (movies, TV): describe visual appearance (clothing, hair, build) — don't rely on names alone.

Capture the user's creative intent faithfully. Present tense. Positive phrasing. No vague words ("beautiful", "nice") — concrete sensory details. Natural, plausible movements.`,
        },
        duration: {
          type: 'number',
          description:
            'Video duration in seconds. Default: 5. Range: 2-20. Use when the user explicitly requests a specific length.',
          minimum: 2,
          maximum: 20,
        },
        videoModel: {
          type: 'string',
          enum: ['ltx23', 'wan22'],
          description:
            'Video model. "ltx23" (default): LTX 2.3 distilled, 8-step, fast + high quality with audio. "wan22": Fast 4-step, simple motion, no audio. Default: "ltx23".',
        },
        width: {
          type: 'number',
          description:
            'Video width in pixels. LTX 2.3: 640-3840 (step 64), default 1920. WAN: 480-1536 (step 16), default 640. Resolution mappings: 480p=640x480, 720p=1280x720, 1080p=1920x1088, 4K=3840x2176.',
        },
        height: {
          type: 'number',
          description:
            'Video height in pixels. LTX 2.3: 640-3840 (step 64), default 1088. WAN: 480-1536 (step 16), default 640. Set both width and height for resolution requests.',
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
      },
      required: ['prompt'],
    },
  },
};
