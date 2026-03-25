import type { ToolDefinition } from '@sogni-ai/sogni-client';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'stitch_video',
    description:
      'Combine multiple video results into a single continuous video. ' +
      'Use when the user wants to join, merge, or concatenate previously ' +
      'generated video clips into one video. Requires at least 2 video results to exist.',
    parameters: {
      type: 'object',
      properties: {
        videoIndices: {
          type: 'array',
          items: { type: 'number' },
          description:
            'Array of 0-based video result indices to stitch together, ' +
            'in the desired playback order. References videos from previous ' +
            'tool results in this conversation.',
        },
      },
      required: ['videoIndices'],
    },
  },
};
