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
      'Generate a video from a text description — no source image needed. Creates entirely new video content from your prompt. Use this when the user wants to create a video from scratch without uploading a photo. For animating an existing photo, use animate_photo instead.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Detailed text description of the video to generate. 2-4 present-tense sentences recommended.

Structure your prompt:
1. SCENE (1 sentence): Describe the setting, subjects, and visual style in detail.
2. ACTION (1-2 sentences): Describe motion, movement, and what happens over time. Use temporal connectors ("as", "then", "while").
3. ATMOSPHERE & SOUND (1 sentence): Environmental motion, ambient sounds, music.
4. CAMERA (append): Camera movement ("slow push-in", "gentle pan right", "static tripod").

--- AUDIO & DIALOGUE (LTX-2 only) ---
LTX-2 generates audio natively. Describe audio clearly:
- Ambient sounds: "the sound of waves crashing", "birds chirping".
- Music: "soft piano melody playing in the background".
- Dialogue: Place spoken text in quotes. E.g., A narrator says "Welcome to the future."
- End with "The footage remains smooth and stabilised throughout."

CONSTRAINTS:
- Present tense only. Positive phrasing.
- No vague words ("beautiful", "nice") — use concrete sensory details.
- Keep movements natural and physically plausible.`,
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
          enum: ['ltx2', 'wan22'],
          description:
            'Video model. "ltx2" (default): Higher quality, generates audio, supports up to 20s, best for detailed/cinematic prompts with sound. "wan22": Faster, simpler motion, no audio, up to 10s. Default: "ltx2".',
        },
        width: {
          type: 'number',
          description:
            'Video width in pixels. LTX-2: 640-3840 (step 64), default 1920. WAN: 480-1536 (step 16), default 640.',
        },
        height: {
          type: 'number',
          description:
            'Video height in pixels. LTX-2: 640-3840 (step 64), default 1088. WAN: 480-1536 (step 16), default 640.',
        },
        numberOfVariations: {
          type: 'number',
          description:
            'Number of video variations to generate (1-16). ALWAYS use 1 unless the user explicitly requests multiple videos. Default: 1.',
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
