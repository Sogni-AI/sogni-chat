/**
 * Tool definition for resolve_personas.
 * Loads persona photos from local storage for use in image generation/editing.
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'resolve_personas',
    description:
      'Load persona reference photos and appearance descriptions for identity-preserving image generation. Call this BEFORE edit_image when the user references a person by name (e.g. "make a picture of me", "draw Sarah and the kids"). Returns reference photos as numbered context images (picture 1, picture 2, etc.) plus appearance descriptions. After calling this, use edit_image and reference each person by their picture number (e.g. "the person from picture 1") with explicit instructions to preserve their face, ethnicity, age, and features. Do NOT call this for non-person subjects.',
    parameters: {
      type: 'object',
      properties: {
        names: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Names of personas to load (case-insensitive). Must match names from the user\'s people list provided in the system message. Example: ["Mark", "Sarah"].',
        },
      },
      required: ['names'],
    },
  },
};
