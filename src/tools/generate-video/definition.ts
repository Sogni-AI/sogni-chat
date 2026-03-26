/**
 * Tool definition for generate_video.
 * Based on workflow_text_to_video.mjs — text-to-video without a source image.
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';
import { ASPECT_RATIO_DESCRIPTION } from '../shared';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'generate_video',
    description:
      'Generate a video from text — no source image. LTX 2.3 generates audio natively (dialogue, sounds, ambient music) — describe audio in the prompt. For syncing video to a specific song or audio track, use sound_to_video instead. For animating an existing photo, use animate_photo. Do NOT use for My Personas — instead: resolve_personas → edit_image → animate_photo. If the request is vague, ask about vision/mood/style first. If an image exists, analyze it and suggest 2-3 tailored directions. Only call once you have clear creative intent.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Write one flowing paragraph like a cinematographer describing a shot. Present tense, specific natural language. Longer clips need longer prompts; close-ups need more detail than wide shots.

STRUCTURE: shot/style → subject (age, clothing, hairstyle, distinguishing details) → environment, lighting, atmosphere → action beat by beat → camera movement → audio and dialogue.

DIALOGUE: Put spoken lines in double quotes. Break long speech into short quoted phrases with acting beats between them (gestures, pauses, glances). Show emotion through visible behavior — not "she is sad", instead "she looks down, pauses, and her voice cracks".

AUDIO: Prompt sound intentionally — voice quality, room tone, ambience, music, weather, footsteps. Include language or accent if relevant.

CAMERA: Cinematic terms — close-up, tracking shot, dolly in, handheld, slow arc, static frame. Describe movement relative to subject.

For specific characters (movies, TV): describe visual appearance — don't rely on names alone.

For complex/creative scenes (characters, dialogue, skits): capture the full creative intent. The system auto-expands into a detailed prompt.

AVOID: Vague prompts, too many characters at once, conflicting lighting logic, readable text or logos, abstract emotions with no visible behavior, rigid numeric constraints (exact angles, counts, speeds).

BATCH VARIATIONS: When numberOfVariations > 1, use Dynamic Prompt syntax. Lock in any camera/subject/style the user specified, vary the rest. Example: "slow dolly in on a city street {at dawn with golden light|during a rainstorm|at night with neon reflections}".`,
        },
        duration: {
          type: 'number',
          description:
            'Video duration in seconds. Default: 5. Range: 2-20. Use when the user explicitly requests a specific length.',
          minimum: 2,
          maximum: 20,
        },
        videoModel: {
          type: 'string',
          enum: ['ltx23', 'wan22'],
          description:
            'Video model. "ltx23" (default): LTX 2.3 distilled, 8-step, fast + high quality with audio. "wan22": Fast 4-step, simple motion, no audio. Default: "ltx23".',
        },
        width: {
          type: 'number',
          description:
            'Video width in pixels. LTX 2.3: 640-3840 (step 64), default 1920. WAN: 480-1536 (step 16), default 640. Resolution mappings: 480p=640x480, 720p=1280x720, 1080p=1920x1088, 4K=3840x2176.',
        },
        height: {
          type: 'number',
          description:
            'Video height in pixels. LTX 2.3: 640-3840 (step 64), default 1088. WAN: 480-1536 (step 16), default 640. Set both width and height for resolution requests.',
        },
        numberOfVariations: {
          type: 'number',
          description:
            'Number of variations (1-16). Use 1 unless user requests multiple. Default: 1.',
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
