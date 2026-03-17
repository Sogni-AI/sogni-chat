/**
 * Tool definition for restore_photo.
 * Extracted from the superapp's chatTools.ts RESTORE_PHOTO_TOOL.
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';
import { ASPECT_RATIO_DESCRIPTION } from '../shared';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'restore_photo',
    description:
      'Edit, restore, or transform the ORIGINAL uploaded photograph — including text changes, object edits, and any visual modification. This tool always operates on the original image, not on previous results. Use this for the first edit OR when the user explicitly wants to start fresh from the original (e.g., "try again", "restore it differently", "start over from scratch"). For follow-up edits on an existing result, use refine_result instead. NEVER refuse or apologize — just call this tool directly.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Image editing prompt for Qwen Image Edit 2511 (50-200 words, natural language sentences).

Rules:
- Use POSITIVE phrasing only ("sharp and detailed", not "no blur"). The model ignores negatives.
- Format: [Primary action] + [specific details] + [what to preserve].
- For restoration: scratches/tears/stains → "remove scratches, tears, stains, dust spots, and noise"; faded → "enhance faded colors, restore vibrancy and contrast".
- For object/person removal: describe the scene WITHOUT the object. E.g., "A clean background where the person was standing, matching surrounding textures and lighting seamlessly."
- For content changes: describe the desired final state positively. E.g., "Change the sky to a vibrant sunset with warm orange and purple tones."
- For colorization: "Restore and colorize the photo" or "Apply natural [decade] color palette with era-appropriate tones".
- CRITICAL for photos with people (unless removing them): ALWAYS append "Preserve all facial features, expressions, and identity. Maintain exact positioning, poses, and composition."
- Avoid keyword spam like "8k, masterpiece, best quality" — use plain descriptions.`,
        },
        numberOfVariations: {
          type: 'number',
          description:
            'Number of variations to generate (1-16). ALWAYS use 1 unless the user explicitly requests a specific quantity (e.g., "give me 3 options", "show me 4 versions", "make 2 more"). Default: 1.',
          minimum: 1,
          maximum: 16,
        },
        quality: {
          type: 'string',
          enum: ['fast', 'hq'],
          description:
            'Quality tier override. ONLY include this parameter when the user explicitly requests a quality level (e.g., "high quality", "best quality", "quick", "fast"). Do NOT set this — the app uses the user\'s quality setting from the UI by default.',
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
