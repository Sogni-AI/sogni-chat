/**
 * Tool definition for refine_result.
 * Extracted from the superapp's chatTools.ts REFINE_RESULT_TOOL.
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';
import { ASPECT_RATIO_DESCRIPTION } from '../shared';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'refine_result',
    description:
      'Make ANY edit to an existing result image. This is the DEFAULT tool for follow-up requests after results exist. Use whenever the user wants to modify, adjust, or build upon a previous result — including brightness, color, sharpening, object removal, background changes, further restoration, or any other edit. If the user does not specify which image, use the most recent result (index 0 if only one result, or the last result the user referenced). Only use restore_photo instead if the user explicitly wants to start over from the original upload.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Targeted refinement prompt for Qwen Image Edit 2511 (50-150 words, natural language sentences).

Rules:
- Use POSITIVE phrasing only. The model ignores negatives.
- Be specific about what to change: "warmer skin tones", "cooler shadows", "sharper facial features", "more natural greens".
- ALWAYS include "Keep everything else unchanged" to prevent unwanted changes.
- CRITICAL for photos with people: append identity preservation directive.`,
        },
        sourceImageIndex: {
          type: 'number',
          description:
            'Which result image to refine (0-based index). If the user specifies an image number, use that index. If omitted, the latest result is used automatically. When multiple results exist and the user previously referenced a specific one, use that one.',
        },
        numberOfVariations: {
          type: 'number',
          description:
            'Number of variations to generate (1-16). ALWAYS use 1 unless the user explicitly asks for multiple options or a specific count. Default: 1.',
          minimum: 1,
          maximum: 16,
        },
        scale: {
          type: 'number',
          enum: [1, 1.5, 2, 3, 4],
          description:
            'Output scale multiplier relative to the source image size. 1 = same resolution as source (default). Use higher values when user asks to upscale, enlarge, make bigger, or increase resolution. Small images (<480px) are automatically upscaled to at least 480px regardless of this setting. Default: 1.',
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
