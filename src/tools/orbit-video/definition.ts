import type { ToolDefinition } from '@sogni-ai/sogni-client';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'orbit_video',
    description:
      'Create a 360-degree orbit video around a subject. This is a SELF-CONTAINED ' +
      'pipeline — it automatically generates angle views (via change_angle), creates ' +
      'transition video clips, and stitches them into one seamless looping video. ' +
      'You only need ONE source image as the front view — either an uploaded image ' +
      'or a previously generated result. If the user uploaded an image, call this ' +
      'tool directly without generating anything first. Do NOT pre-generate multiple ' +
      'angles or variations — this tool handles everything internally. ' +
      'Use when the user asks for a "360 pan", "orbit", "rotate around", "spin ' +
      'around", or "turntable" view.',
    parameters: {
      type: 'object',
      properties: {
        elevation: {
          type: 'string',
          enum: ['low-angle shot', 'eye-level shot', 'elevated shot', 'high-angle shot'],
          description: 'Camera elevation for all angles. Default: "eye-level shot".',
        },
        distance: {
          type: 'string',
          enum: ['close-up', 'medium shot', 'wide shot'],
          description: 'Camera distance for all angles. Default: "medium shot".',
        },
        prompt: {
          type: 'string',
          description:
            'Motion/animation description for transition clips. Describes how the ' +
            'camera moves between angles. Default uses constant-speed linear motion. ' +
            'Can include speech/narration or foley/sound effects descriptions ' +
            '(e.g. "footsteps on gravel, wind blowing") which carry across clips with ' +
            'audio continuity when stitched. Foley and ambient SFX are recommended for ' +
            'realism. Music is automatically suppressed — use generate_music separately for soundtrack.',
        },
        sourceImageIndex: {
          type: 'number',
          description:
            'Which result image to orbit around (0-based). Omit to use latest ' +
            'result or original upload.',
        },
      },
      required: [],
    },
  },
};
