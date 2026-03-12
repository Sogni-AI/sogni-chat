/**
 * Tool definition for apply_style.
 * Extracted from the superapp's chatTools.ts APPLY_STYLE_TOOL.
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';
import { ASPECT_RATIO_DESCRIPTION } from '../shared';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'apply_style',
    description:
      'Apply an artistic style, era-specific look, or creative transformation to a photo. Use when the user wants to change the visual style (e.g., "make it look like the 70s", "oil painting style", "vintage polaroid look"). Can handle any creative transformation. One style per call.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Style prompt for Qwen Image Edit 2511 (50-200 words, natural language sentences).

Rules:
- Use POSITIVE phrasing only. The model ignores negatives.
- Reference known art styles or works to anchor the style.
- Describe specific visual characteristics: brushstrokes, color palette, texture, composition approach, mood.
- For era looks: describe the photographic qualities of that era (e.g., "warm faded Kodachrome tones with soft vignette, typical of 1970s amateur photography").
- CRITICAL for photos with people: ALWAYS append "Preserve all facial features, expressions, and identity. Maintain exact positioning, poses, and composition."`,
        },
        sourceImageIndex: {
          type: 'number',
          description:
            'Which result image to apply the style to (0-based index). If not specified, applies to the original uploaded image.',
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
