import type { ToolDefinition } from '@sogni-ai/sogni-client';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'extract_metadata',
    description:
      'Extracts generation metadata (prompt, model, parameters) from an uploaded media file. ' +
      'Use this when the user asks about an uploaded file\'s original prompt, generation settings, or metadata — ' +
      'or when you need the original parameters to recreate, remix, or generate new versions of an uploaded file. ' +
      'The extracted parameters (prompt, model, steps, seed, cfg, sampler, dimensions, LoRAs) can be fed directly ' +
      'into tools like generate_image, generate_video, etc. ' +
      'Supports PNG, JPEG, WebP, HEIF/AVIF, GIF, MP4, WebM, and MOV files.',
    parameters: {
      type: 'object',
      properties: {
        file_index: {
          type: 'number',
          description:
            'Index of the uploaded file to inspect (0-based). Defaults to 0 (the first uploaded file). ' +
            'Only indexes into user-uploaded files, not previously generated results.',
        },
      },
      required: [],
    },
  },
};
