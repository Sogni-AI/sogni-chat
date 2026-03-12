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
          description: `Text description of the video to generate. Capture the user's creative intent as faithfully and completely as possible.

For SIMPLE scenes (landscape, abstract, single action): Write 2-4 present-tense sentences with scene, action, atmosphere, and camera movement.

For COMPLEX/CREATIVE scenes (characters talking, arguments, fights, skits, stories, scenes from movies/shows): Capture the FULL creative intent — who the characters are, what they say, what happens, the tone and style. Include specific details the user mentioned. The system will automatically expand this into a detailed video prompt, so focus on accurately representing what the user wants rather than summarizing.

CRITICAL FOR DIALOGUE: If the user's request involves people talking, arguing, or any spoken words, you MUST write out the actual dialogue in double quotes. NEVER summarize dialogue as "they argue about X" — instead write what they actually say. If the user didn't specify exact words, create appropriate dialogue that matches their intent.

CRITICAL FOR CHARACTERS: If the user references specific characters (from movies, TV, etc.), describe their visual appearance (clothing, hair, build, features) so they can be recognized. Do not rely on names alone.

CONSTRAINTS:
- Present tense only. Positive phrasing.
- No vague words ("beautiful", "nice") — use concrete sensory details.
- Keep movements natural and physically plausible.
- End with "The footage remains smooth and stabilised throughout."`,
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
          enum: ['ltx2', 'wan22', 'ltx2-hq', 'wan22-hq', 'ltx23'],
          description:
            'Video model. "ltx2" (default): Fast 8-step distilled, generates audio, good balance of speed and quality. "ltx2-hq": High quality 20-step, generates audio, best for cinematic detail. "ltx23": Latest LTX 2.3 distilled, 8-step, fast + high quality with audio. "wan22": Fast 4-step, simple motion, no audio. "wan22-hq": High quality 20-step, better motion fidelity, no audio. Default: "ltx2".',
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
