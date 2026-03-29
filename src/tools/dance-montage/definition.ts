/**
 * Tool definition for dance_montage.
 * Enum and description generated from DANCE_PRESETS (single source of truth).
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';
import { DANCE_PRESETS } from './dances';

const danceEnum = DANCE_PRESETS.map(d => d.id);
const danceParamDesc = DANCE_PRESETS.map(d => `"${d.id}": ${d.title} (${d.description})`).join('. ');

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'dance_montage',
    description:
      'REQUIRED for ALL dance video requests — do NOT use animate_photo or generate_video for dances. Uses real choreography reference videos to transfer dance motion onto a photo via WAN 2.2 Animate Move. Output is always 9:16 480p portrait. IMAGE PREP: When generating images for dance (via edit_image or generate_image), ALWAYS use aspectRatio="9:16" and numberOfVariations=4 with Dynamic Prompts for variety — 4 images enable 4-way concurrent clip rendering for faster output. USING GENERATED IMAGES: When images have already been generated earlier in the conversation, simply call dance_montage WITHOUT sourceImageIndex — all previously generated images are used automatically as alternating montage segments. Do NOT tell the user to "upload" images that were already generated. PERSONAS WITHOUT PRE-GENERATED IMAGES: When personas are loaded but NO images have been generated yet, pass imagePrompt with the desired style/look and dance_montage will generate per-persona images internally, ensuring each image contains only ONE person. If images were already generated from personas (e.g. bobbleheads via edit_image), those generated images take priority — do NOT pass imagePrompt. Requires at least one uploaded photo, previously generated image, or loaded personas. Best results with photos of people.',
    parameters: {
      type: 'object',
      properties: {
        dance: {
          type: 'string',
          enum: danceEnum,
          description: `Which dance choreography to use. ${danceParamDesc}.`,
        },
        duration: {
          type: 'number',
          description:
            'Total video duration in seconds. Default: 15. Range: 8-30.',
          minimum: 8,
          maximum: 30,
        },
        sourceImageIndex: {
          type: 'number',
          description:
            'Which previously generated result image to use (0-based index). Use -1 for the original uploaded image. When omitted, all previously generated images are used automatically as alternating montage segments.',
        },
        imagePrompt: {
          type: 'string',
          description:
            'Creative style/look for auto-generated persona images (e.g. "cute 3D bobblehead cartoon character with oversized head", "anime chibi character"). Used ONLY when personas are loaded — dance_montage generates one image per persona internally to guarantee each contains exactly one person. If omitted, uses a default full-body portrait style.',
        },
      },
      required: ['dance'],
    },
  },
};
