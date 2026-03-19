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
      'Load persona reference photos for identity-preserving image generation. Call this BEFORE edit_image when the user references a person from My Personas (e.g. "make a picture of me", "draw Sarah and the kids"). Returns reference photos as numbered context images plus appearance descriptions. CRITICAL: After calling this, you MUST use edit_image (NOT generate_image). For video requests: edit_image first to generate the image, then animate_photo (never generate_video). Reference each person by picture number with explicit face preservation directives. Do NOT call this for fictional/non-persona subjects.',
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
