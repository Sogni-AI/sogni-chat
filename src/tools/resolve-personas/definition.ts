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
      'Load persona reference photos and appearance descriptions for image generation. Call this BEFORE generate_image or edit_image when the user references a person by name (e.g. "make a picture of me", "draw Sarah and the kids"). Returns appearance descriptions and reference photos. IMPORTANT: The appearance description text is the primary tool for capturing likeness — weave it directly into your image prompt. Reference photos provide visual guidance for composition but will not perfectly reproduce exact facial features. Do NOT call this for non-person subjects.',
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
