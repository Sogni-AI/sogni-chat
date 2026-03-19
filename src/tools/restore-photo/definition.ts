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
          description: `Editing prompt (50-200 words, natural language). POSITIVE phrasing only — model ignores negatives.

Format: [action] + [details] + [what to preserve]. Describe desired final state, not what to remove.
- Restoration: "remove scratches, tears, stains, dust spots, and noise"
- Object removal: describe scene WITHOUT the object, matching surrounding textures
- Colorization: "Restore and colorize the photo" or "Apply natural [decade] color palette"
- For photos with people (unless removing them): ALWAYS append "Preserve all facial features, expressions, identity, positioning, and composition."
- No keyword spam ("8k, masterpiece") — use plain descriptions.

BATCH VARIATIONS: Only use Dynamic Prompt syntax when the user explicitly requests multiple approaches to compare. Example: "restore with {warm vintage|cool modern|natural balanced} tones". Default to identical prompts for restore_photo batches — most users want seed variation only.`,
        },
        numberOfVariations: {
          type: 'number',
          description:
            'Number of variations (1-16). Use 1 unless user requests multiple. Default: 1.',
          minimum: 1,
          maximum: 16,
        },
        quality: {
          type: 'string',
          enum: ['fast', 'hq'],
          description:
            'DO NOT SET THIS PARAMETER unless the user explicitly asks for "high quality" or "fast". The app auto-selects based on quality settings.',
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
