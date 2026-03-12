/**
 * Tool definition for generate_image.
 * Based on workflow_text_to_image.mjs and MODELS.image config.
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';
import { ASPECT_RATIO_DESCRIPTION } from '../shared';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'generate_image',
    description:
      'Generate a new image from a text description. No source image needed — creates entirely new images from your prompt. Supports multiple AI models for different styles and quality levels.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Detailed text description of the image to generate. Be specific about subject, composition, lighting, style, and mood. Use concrete visual details rather than vague adjectives. 50-200 words recommended for best results.

Tips:
- Describe the subject first, then environment, then style/mood.
- Include lighting ("soft golden hour light", "dramatic studio lighting").
- Mention composition ("close-up portrait", "wide establishing shot", "bird's eye view").
- For photorealistic: specify camera details ("shot on Canon EOS R5, 85mm f/1.4, shallow depth of field").
- For artistic: specify style ("oil painting", "watercolor", "digital art", "anime style").
- Use POSITIVE phrasing only ("sharp and detailed", not "no blur").`,
        },
        model: {
          type: 'string',
          enum: ['z-turbo', 'chroma-v46-flash', 'flux2'],
          description:
            'AI model for generation. "z-turbo" (default): Fast generation with good quality, 4-8 steps. "chroma-v46-flash": High quality with fast speed, 10 steps, good for photorealistic and artistic images. "flux2": Highest quality, 20 steps, best for detailed/complex scenes and supports context images. Default: "z-turbo".',
        },
        width: {
          type: 'number',
          description:
            'Output image width in pixels. Must be a multiple of 16. Default: 1024. Max: 2048.',
        },
        height: {
          type: 'number',
          description:
            'Output image height in pixels. Must be a multiple of 16. Default: 1024. Max: 2048.',
        },
        numberOfVariations: {
          type: 'number',
          description:
            'Number of image variations to generate (1-16). ALWAYS use 1 unless the user explicitly requests a specific quantity (e.g., "give me 4 options", "generate 3 versions"). Default: 1.',
          minimum: 1,
          maximum: 16,
        },
        negativePrompt: {
          type: 'string',
          description:
            'Things to avoid in the generated image. Only set when the user explicitly mentions what to avoid. E.g., "no watermarks, no text, no blurry edges".',
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
