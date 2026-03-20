/**
 * Tool definition for edit_image.
 * Based on workflow_image_edit.mjs and MODELS.imageEdit config.
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';
import { ASPECT_RATIO_DESCRIPTION } from '../shared';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'edit_image',
    description:
      'Generate images guided by 1-6 reference photos. Supports Qwen and Flux.2. Best for style-guided generation, combining elements from multiple images, and ANY persona image creation. ALWAYS use this (never generate_image) when persona photos are in context — even if a specific model is requested. For direct edits (remove objects, enhance), use restore_photo or refine_result instead.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Edit instruction describing what to generate using the reference images as guidance. 50-200 words recommended.

Tips:
- Reference context images by number: "picture 1", "picture 2" etc. (numbered in the order they appear).
- For identity preservation: "the person from picture N — preserve their face, ethnicity, age, skin tone, hairstyle, and features exactly"
- Include specific appearance descriptors in the prompt to reinforce the likeness.
- Use POSITIVE phrasing ("sharp details", not "no blur").
- Be specific about what to take from each reference image.

BATCH VARIATIONS: When numberOfVariations > 1, the prompt must describe ONE subject in ONE scene — never mention counts, "versions", "different", or "multiple" in the prompt text. NEVER describe multiple copies or duplicates of the subject in a single image (no grids, collages, or side-by-side). Use Dynamic Prompt syntax to vary ONE dimension across separate images. For personas: vary scene, activity, expression, or environment — never vary identity. Example: user asks "4 versions at the beach" → numberOfVariations=4, prompt="[persona] at the beach {building a sandcastle|surfing a wave|reading under a palm tree|flying a kite}" — each output is ONE person doing ONE activity. For direct edits: vary the approach, e.g., numberOfVariations=3, prompt="make the sky {a vibrant sunset|stormy and dramatic|clear blue}".`,
        },
        model: {
          type: 'string',
          enum: ['qwen-lightning', 'qwen', 'flux2'],
          description:
            'DO NOT SET THIS PARAMETER unless the user names a specific model. The app auto-selects based on quality settings.',
        },
        sourceImageIndex: {
          type: 'number',
          description:
            'Index of the primary image to use as the main reference (0-based, from uploaded files). The primary image and any additional uploaded images are passed as context images to guide generation.',
        },
        numberOfVariations: {
          type: 'number',
          description:
            'Number of variations (1-16). Use 1 unless user requests multiple. Default: 1.',
          minimum: 1,
          maximum: 16,
        },
        width: {
          type: 'number',
          description:
            'Output image width in pixels. Defaults to the context image width. Max: 2048.',
        },
        height: {
          type: 'number',
          description:
            'Output image height in pixels. Defaults to the context image height. Max: 2048.',
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
