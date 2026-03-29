import type { ToolDefinition } from '@sogni-ai/sogni-client';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'stitch_video',
    description:
      'Combine multiple previously generated videos into a single continuous video. ' +
      'Every video tool (animate_photo, generate_video, sound_to_video, video_to_video, dance_montage) ' +
      'adds results to a session-wide video array — use videoStartIndex from their results to find the indices. ' +
      'Use when the user wants to join, merge, concatenate, or combine their generated video clips. ' +
      'Requires at least 2 video results to exist. Never ask the user to upload videos that were already generated.',
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
