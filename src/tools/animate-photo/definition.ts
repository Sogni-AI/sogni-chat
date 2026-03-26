/**
 * Tool definition for animate_photo.
 * Extracted from the superapp's chatTools.ts ANIMATE_PHOTO_TOOL.
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';
import { ASPECT_RATIO_DESCRIPTION } from '../shared';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'animate_photo',
    description:
      'Animate a photo into video with motion, audio, and dialogue. LTX 2.3 generates audio natively — describe dialogue and ambient sounds directly in the prompt (do NOT pre-generate audio for this tool). For syncing video to a specific song or audio track, use sound_to_video instead. Auto-uses latest result unless sourceImageIndex is set. Supports start-frame (default), end-frame, and start+end interpolation modes — ask the user which frame role their image should play if they mention "end frame", "last frame", or provide two images. FIRST+LAST FRAME WORKFLOW: When the user wants a video using two different scenes as start and end frames, FIRST generate both images in a single generate_image call with numberOfVariations=2 and Dynamic Prompts, THEN call animate_photo with frameRole="both", sourceImageIndex=0, endImageIndex=1. Never generate the two frames in separate tool calls. If the request is vague, analyze the image first and suggest 2-3 specific animation ideas tailored to what you see. Only call once you have clear creative intent.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Describe MOTION, ACTION, SOUND, and CAMERA — not the static image content. 2-4 present-tense sentences.

WAN 2.2 ("wan22"): 30-150 words. Describe actions, camera movement, atmosphere. Keep movements subtle and natural.

LTX 2.3 ("ltx23"): Scene description is auto-generated from the image — describe only motion, sound, and camera.
- ACTION: One main thread of motion with temporal connectors ("as", "then", "while").
- SOUND: Ambient sounds, music, or dialogue woven into prose. LTX 2.3 generates audio natively.
- CAMERA: Camera movement ("slow push-in", "static tripod", etc.). End with "The footage remains smooth and stabilised throughout."

DIALOGUE (LTX 2.3): Write ACTUAL spoken words in double quotes. Never summarize as "they argue about X" — write what they say. Create appropriate dialogue if user implies conversation without exact words.

For specific characters (movies, TV): describe visual appearance (clothing, hair, build) — don't rely on names alone.

For complex/creative scenes (characters talking, skits), capture full creative intent — system auto-expands into detailed prompt.

Present tense. Positive phrasing. No vague words ("beautiful", "nice") — use concrete sensory details. Subtle, natural movements.

BATCH VARIATIONS: When numberOfVariations > 1, use Dynamic Prompt syntax to vary motion, camera, or atmosphere while preserving the user's specified elements. Example: "{gentle sway with soft birdsong|dramatic zoom with rolling thunder|slow pan with ambient music}".`,
        },
        videoModel: {
          type: 'string',
          enum: ['ltx23', 'wan22'],
          description:
            'Which video model to use. "ltx23" (default): LTX 2.3 distilled, 8-step, fast + high quality with audio. "wan22": Fast 4-step, simple motion, no audio. Use ltx23 for most requests. Use wan22 for quick simple motions without audio. Default: "ltx23".',
        },
        duration: {
          type: 'number',
          description:
            'Video duration in seconds. Default: 5. Use when the user explicitly requests a specific length (e.g., "make a 10 second video"). Range: 2-20.',
        },
        sourceImageIndex: {
          type: 'number',
          description:
            'Which result image to use as the START frame (0-based index). Omit to auto-select: uses the latest result for "start"/"end" modes, or the FIRST result for "both" mode. Use -1 for the original uploaded image. IMPORTANT: When frameRole is "both", set this to the start frame image index and endImageIndex to the end frame image index.',
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
        frameRole: {
          type: 'string',
          enum: ['start', 'end', 'both'],
          description:
            'How to use the source image(s) for video generation. "start" (default): image is the first frame — video animates forward from it. "end": image is the last frame — video leads up to it. "both": two images provided — interpolates between start and end frames. When using "both", you MUST set sourceImageIndex to the start frame and endImageIndex to the end frame.',
        },
        endImageIndex: {
          type: 'number',
          description:
            'Which image to use as the END frame (0-based index into results). Required when frameRole is "both". Use -1 for the primary/first uploaded image. If omitted when frameRole is "both", auto-selects the latest generated result.',
        },
      },
      required: ['prompt'],
    },
  },
};
