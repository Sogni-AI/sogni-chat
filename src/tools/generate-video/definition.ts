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
      'Generate a video from a text description — no source image needed. LTX 2.3 generates audio natively (dialogue, ambient sounds, music, foley) — no separate audio generation step is needed. Describe audio in the prompt. Use this when the user wants to create a video from scratch without uploading a photo. For animating an existing photo, use animate_photo instead. CRITICAL: If the user\'s request is vague or lacks specific creative direction (e.g. just "create a video", "make a video"), do NOT call this tool yet. Instead, ask about their vision: subject matter, mood, camera style, and any specific actions or dialogue. If an image is available, analyze what is actually in it and suggest 2-3 creative directions tailored to the image content — never give generic ideas. Only call this tool once you have clear creative intent.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Text description of the video to generate. Capture the user's creative intent as faithfully and completely as possible.

For SIMPLE scenes (landscape, abstract, single action): Write 2-4 present-tense sentences with scene, action, atmosphere, and camera movement.

For COMPLEX/CREATIVE scenes (characters talking, arguments, fights, skits, stories, scenes from movies/shows): Capture the FULL creative intent — who the characters are, what they say, what happens, the tone and style. Include specific details the user mentioned. The system will automatically expand this into a detailed video prompt, so focus on accurately representing what the user wants rather than summarizing.

CRITICAL FOR DIALOGUE: If the user's request involves people talking, arguing, or any spoken words, you MUST write out the actual dialogue in double quotes. NEVER summarize dialogue as "they argue about X" — instead write what they actually say. If the user didn't specify exact words, create appropriate dialogue that matches their intent.

CRITICAL FOR CHARACTERS: If the user references specific characters (from movies, TV, etc.), describe their visual appearance (clothing, hair, build, features) so they can be recognized. Do not rely on names alone.

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
          enum: ['ltx23', 'wan22'],
          description:
            'Video model. "ltx23" (default): LTX 2.3 distilled, 8-step, fast + high quality with audio. "wan22": Fast 4-step, simple motion, no audio. Default: "ltx23".',
        },
        width: {
          type: 'number',
          description:
            'Video width in pixels. LTX 2.3: 640-3840 (step 64), default 1920. WAN: 480-1536 (step 16), default 640.',
        },
        height: {
          type: 'number',
          description:
            'Video height in pixels. LTX 2.3: 640-3840 (step 64), default 1088. WAN: 480-1536 (step 16), default 640.',
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
