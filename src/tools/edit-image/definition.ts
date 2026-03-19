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
      'Generate new images guided by reference photos. Supports Qwen and Flux.2 models. Upload 1-6 context images to influence the output style, subject, or composition. Best for: creating images inspired by reference photos, combining elements from multiple images, style-guided generation, and ANY image creation involving personas/My People. ALWAYS use this tool (never generate_image) when persona reference photos are in context — even if the user requests Flux.2 or another model. For direct edits to a single image (remove objects, change background, enhance), use restore_photo or refine_result instead.',
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
- Be specific about what to take from each reference image.`,
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
            'Number of variations to generate (1-16). ALWAYS use 1 unless the user explicitly requests multiple versions. Default: 1.',
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
