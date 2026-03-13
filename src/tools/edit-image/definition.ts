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
      'Generate new images guided by reference photos. Upload 1-6 context images to influence the output style, subject, or composition. Best for: creating images inspired by reference photos, combining elements from multiple images, style-guided generation. For direct edits to a single image (remove objects, change background, enhance), use restore_photo or refine_result instead.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Edit instruction describing what to generate using the reference images as guidance. 50-200 words recommended.

Tips:
- Describe the desired output, referencing the style or content from the uploaded images.
- E.g., "Generate a portrait in the style of the reference image" or "Combine the subject from image 1 with the background from image 2".
- Use POSITIVE phrasing ("sharp details", not "no blur").
- Be specific about what to take from each reference image.`,
        },
        model: {
          type: 'string',
          enum: ['qwen-lightning', 'qwen', 'flux2'],
          description:
            'AI model for editing. "qwen-lightning" (default): Fast 4-step editing, supports up to 3 context images. "qwen": High quality 20-step editing, supports up to 3 context images. "flux2": Highest quality, supports up to 6 context images. Default: "qwen-lightning".',
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
