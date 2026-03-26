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
      'Generate video synchronized to audio. Use this when the user wants to visualize music — including after generate_music ("turn that song into a video", "make a music video from that"). Auto-detects generated audio from generate_music if no audio file is uploaded. If the user provides a reference image, use ltx23-ia2v; if no image, use ltx23-a2v. If the user wants dialogue/audio WITHOUT pre-existing audio, use animate_photo instead (LTX 2.3 generates audio natively).',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Describe the video like a cinematographer. Let the audio define timing — use the prompt for visual interpretation. One flowing paragraph, present tense, specific natural language.

STRUCTURE: shot/style → subject → environment and lighting → visual action synced to audio → camera movement.

LIP-SYNC: Shot framing, speaker's appearance and setting, physical performance synced to audio — gestures, expressions, jaw movement between phrases. Include acting beats.

MUSIC VISUALIZATION: Visual style, environment, and how elements react to rhythm and energy.

AUDIO-REACTIVE: Motion and visual changes that correspond to sounds in the track.

AVOID: Vague prompts, too many competing visual elements, abstract descriptions without visible behavior, rigid numeric constraints.

BATCH VARIATIONS: When numberOfVariations > 1, use Dynamic Prompt syntax to vary the visual interpretation while keeping audio sync intent consistent. Example: "{abstract neon visualization|nature scene with swaying trees|urban street with rain} synced to the beat".`,
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
        audioStart: {
          type: 'number',
          description:
            'Start offset in seconds into the audio track. Use when the user says "start 20 seconds in", "skip the intro", "use the chorus at 1:30", etc. Default: 0 (beginning of audio). The video will be synced to the audio starting from this point.',
          minimum: 0,
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
            'Video model. "ltx23-ia2v" (default when image available): LTX 2.3 image+audio to video, audio-reactive with a reference image, 8-step. "ltx23-a2v" (default when no image): LTX 2.3 audio-only to video, no image needed, creates video purely from text prompt + audio. "wan-s2v": WAN 2.2 sound-to-video, best for lip-sync with a face image, fast 4-step. Omit to auto-select based on whether an image is present.',
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
