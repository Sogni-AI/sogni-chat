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
      'Generate video synchronized to uploaded audio or previously generated music. For music videos, lip-sync, or audio-reactive motion. Auto-detects generated audio from generate_music. If the user wants dialogue/audio WITHOUT pre-existing audio, use animate_photo instead (LTX 2.3 generates audio natively).',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Visual description of the video, synchronized to audio. 2-4 present-tense sentences.

Lip-sync: describe how the person speaks and the atmosphere. Music visualization: describe visual style reacting to the beat. Audio-reactive: describe motion synchronized to sounds.

Present tense. Positive phrasing. Describe motion as it relates to the audio.`,
        },
        audioSourceIndex: {
          type: 'number',
          description:
            'Index of the uploaded audio file to use (0-based, from uploaded files list). If only one audio file is uploaded, use 0. If no audio was uploaded but generate_music was used earlier, omit this — the tool will automatically find the generated audio.',
        },
        sourceImageIndex: {
          type: 'number',
          description:
            'Optional index of an uploaded image to use as the starting frame (0-based). Required for lip-sync models (WAN S2V). For audio-only-to-video models (LTX 2.3 A2V), this is optional — omit it to generate video purely from text + audio.',
        },
        duration: {
          type: 'number',
          description:
            'Video duration in seconds. Default: 5. Range: 2-20. For music videos, use the MAXIMUM duration (20) since the audio is always longer than the video limit. Use when the user explicitly requests a specific length.',
          minimum: 2,
          maximum: 20,
        },
        videoModel: {
          type: 'string',
          enum: ['wan-s2v', 'ltx23-ia2v', 'ltx23-a2v'],
          description:
            'Video model. "wan-s2v" (default): WAN 2.2 sound-to-video, best for lip-sync with a face image, fast 4-step. "ltx23-ia2v": LTX 2.3 image+audio to video, audio-reactive with a reference image, 8-step. "ltx23-a2v": LTX 2.3 audio-only to video, no image needed, creates video purely from text prompt + audio. Default: "wan-s2v".',
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
