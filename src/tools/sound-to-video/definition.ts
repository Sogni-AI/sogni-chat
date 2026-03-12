/**
 * Tool definition for sound_to_video.
 * Based on workflow_sound_to_video.mjs — audio-driven video generation.
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';
import { ASPECT_RATIO_DESCRIPTION } from '../shared';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sound_to_video',
    description:
      'Generate video synchronized to audio. The video motion and lip movements follow the audio. Requires an uploaded audio file. Use when the user has uploaded an audio file and wants to create a video that matches or reacts to the sound — such as lip-sync, music visualization, or audio-reactive motion.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Visual description of the video to generate, synchronized to the audio. 2-4 sentences.

For lip-sync (with a face image):
- Describe the person's appearance and how they speak: "A person speaking naturally with synchronized lip movements, warm expression, soft studio lighting."
- Include atmosphere: "In a cozy living room with warm bokeh lights in the background."

For music visualization (no face needed):
- Describe the visual style that reacts to the music: "Abstract colorful waveforms pulsing to the beat, neon lights flowing across a dark background."
- Match the mood to the music: "Energetic geometric shapes exploding outward in sync with drum beats."

For audio-reactive (general):
- Describe visual elements that should move with the audio: "Ocean waves rising and falling in rhythm with the ambient sounds."

CONSTRAINTS:
- Present tense. Positive phrasing. Concrete details.
- Describe motion as it relates to the audio.`,
        },
        audioSourceIndex: {
          type: 'number',
          description:
            'Index of the uploaded audio file to use (0-based, from uploaded files list). Required — the user must have uploaded an audio file (mp3, wav, m4a). If only one audio file is uploaded, use 0.',
        },
        sourceImageIndex: {
          type: 'number',
          description:
            'Optional index of an uploaded image to use as the starting frame (0-based). Required for lip-sync models (WAN S2V). For audio-only-to-video models (LTX-2 A2V), this is optional — omit it to generate video purely from text + audio.',
        },
        duration: {
          type: 'number',
          description:
            'Video duration in seconds. Default: matches audio length (up to 10s). Range: 2-10.',
          minimum: 2,
          maximum: 10,
        },
        videoModel: {
          type: 'string',
          enum: ['wan-s2v', 'ltx2-ia2v', 'ltx2-a2v'],
          description:
            'Video model. "wan-s2v" (default): WAN 2.2 sound-to-video, best for lip-sync with a face image, fast 4-step. "ltx2-ia2v": LTX-2 image+audio to video, audio-reactive with a reference image, 8-step. "ltx2-a2v": LTX-2 audio-only to video, no image needed, creates video purely from text prompt + audio. Default: "wan-s2v".',
        },
        numberOfVariations: {
          type: 'number',
          description:
            'Number of video variations to generate (1-16). Default: 1.',
          minimum: 1,
          maximum: 16,
        },
        aspectRatio: {
          type: 'string',
          description: ASPECT_RATIO_DESCRIPTION,
        },
      },
      required: ['prompt'],
    },
  },
};
