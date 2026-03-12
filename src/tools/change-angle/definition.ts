/**
 * Tool definition for change_angle.
 * Extracted from the superapp's chatTools.ts CHANGE_ANGLE_TOOL.
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';
import { ASPECT_RATIO_DESCRIPTION } from '../shared';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'change_angle',
    description:
      'Generate the photo from a different camera angle or perspective. Uses AI to create a new view of the subject as if photographed from a different position. Use when the user wants to see the subject from another angle, generate a different view, create a portrait from a specific direction, or get a closeup/wide shot. Examples: "show me from the left side", "generate a 3/4 portrait view", "closeup from slightly above". IMPORTANT: When previous results exist, this tool automatically uses the LATEST result image unless you specify a different sourceImageIndex or the user explicitly says "original".',
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: `EXACT camera angle string. You MUST construct this by concatenating exactly one value from each category below, separated by single spaces. No commas, no extra words.

Format: "[azimuth] [elevation] [distance]"

Azimuth (pick one): "front view", "front-right quarter view", "right side view", "back-right quarter view", "back view", "back-left quarter view", "left side view", "front-left quarter view"
Elevation (pick one): "low-angle shot", "eye-level shot", "elevated shot", "high-angle shot"
Distance (pick one): "close-up", "medium shot", "wide shot"

Examples:
- "front-right quarter view eye-level shot medium shot"
- "left side view eye-level shot close-up"
- "front view low-angle shot wide shot"
- "right side view elevated shot medium shot"

Map user requests: "from the left" → "left side view", "looking up at" → "low-angle shot", "closeup" → "close-up", "3/4 view" → "front-right quarter view" or "front-left quarter view", "portrait" → "front-right quarter view eye-level shot medium shot".
Default elevation to "eye-level shot" and distance to "medium shot" when not specified.`,
        },
        sourceImageIndex: {
          type: 'number',
          description:
            'Which result image to use as source (0-based index). Omit to use the latest result automatically (or the original if no results exist). Only set explicitly when the user specifies a particular image number or explicitly says "original" (use -1 for original).',
        },
        aspectRatio: {
          type: 'string',
          description: ASPECT_RATIO_DESCRIPTION,
        },
      },
      required: ['description'],
    },
  },
};
