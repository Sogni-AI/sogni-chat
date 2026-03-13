import type { ToolDefinition } from '@sogni-ai/sogni-client';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'set_content_filter',
    description:
      'Enable or disable the Safe Content Filter. When enabled, generated images/videos are checked by the safety filter and blocked if flagged. When disabled, no safety filtering is applied. Only call this when the user explicitly asks to change the setting.',
    parameters: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description:
            'Set to true to enable the safe content filter (default), or false to disable it.',
        },
      },
      required: ['enabled'],
    },
  },
};
