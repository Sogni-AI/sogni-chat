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
            'Motion and ambient audio description applied to ALL transition clips. ' +
            'Describes how the camera moves between angles and what ambient/foley sounds ' +
            'play throughout (e.g. "footsteps on gravel, wind blowing"). Default uses ' +
            'constant-speed linear motion. Do NOT put spoken dialogue here — use the ' +
            'dialogue parameter instead. Music is automatically suppressed — use ' +
            'generate_music separately for soundtrack.',
        },
        dialogue: {
          type: 'string',
          description:
            'Spoken dialogue or narration for a SINGLE segment of the orbit video. ' +
            'This is applied ONLY to the segment specified by dialogueSegment (default: ' +
            'first segment). All other segments get foley/ambient audio only. Keep it ' +
            'brief — each segment is 2.5 seconds (~6 words max). If the user asks for ' +
            'dialogue in "just the first segment" or "only at the start", put the speech ' +
            'here and leave prompt for motion/foley only.',
        },
        dialogueSegment: {
          type: 'number',
          enum: [0, 1, 2, 3],
          description:
            'Which transition segment receives the dialogue (0-3). 0 = front→right ' +
            '(first segment, default), 1 = right→back, 2 = back→left, 3 = left→front ' +
            '(last segment). Only used when dialogue is provided.',
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
