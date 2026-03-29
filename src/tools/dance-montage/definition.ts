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
      'REQUIRED for ALL dance video requests — do NOT use animate_photo or generate_video for dances. Uses real choreography reference videos to transfer dance motion onto a photo via WAN 2.2 Animate Move. Output is always 9:16 480p portrait. IMAGE PREP: When generating images for dance (via generate_image), ALWAYS use aspectRatio="9:16" and numberOfVariations=4 with Dynamic Prompts for variety — 4 images enable 4-way concurrent clip rendering for faster output. All generated images are used automatically as alternating montage segments. Requires at least one uploaded photo or previously generated image. Best results with photos of people.',
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
            'Which previously generated result image to use (0-based index). Use -1 for the original uploaded image. When multiple images are uploaded, all are used automatically for montage segments.',
        },
      },
      required: ['dance'],
    },
  },
};
