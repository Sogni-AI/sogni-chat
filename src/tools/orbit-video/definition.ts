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
            'Describe the SUBJECT and ambient environment (e.g. "the bobblehead ' +
            'couple on the beach, ocean waves lapping, palm trees swaying in the ' +
            'breeze"). Do NOT describe camera motion, rotation, panning, orbiting, ' +
            'or 360-degree movement — camera motion is handled automatically. ' +
            'Do NOT put spoken dialogue here — use the dialogue parameter instead. ' +
            'Music is automatically suppressed — use generate_music separately.',
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
          description:
            'Which transition segment receives the dialogue (0-based index into the ' +
            'transition sequence). 0 = first transition (default), last index = wrap-back ' +
            'to front. With default angles there are 4 transitions (0-3). With custom ' +
            'angles the count equals angles.length + 1. Only used when dialogue is provided.',
        },
        angles: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'front-right quarter view',
              'right side view',
              'back-right quarter view',
              'back view',
              'back-left quarter view',
              'left side view',
              'front-left quarter view',
            ],
          },
          description:
            'OMIT THIS PARAMETER for standard 360° orbits — the default (3 angles ' +
            'at 90° increments: right, back, left + source as front = 4 transitions) ' +
            'works for nearly all requests. Only provide this when the user explicitly ' +
            'asks for specific angles, a partial orbit, or extra-smooth rotation. ' +
            'Each additional angle costs extra credits and generation time. ' +
            'Values are clockwise azimuths between the source (front) and wrap-back.',
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
