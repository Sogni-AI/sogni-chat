/**
 * Tool definition for video_to_video.
 * Based on workflow_video_to_video.mjs — ControlNet video transforms.
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'video_to_video',
    description:
      'Transform an existing video using AI. Default mode is WAN 2.2 Animate Move — applies camera/motion from a source video to a reference image, bringing photos to life with the video\'s movement. Also supports Animate Replace (swap the subject in a video with a reference image) and LTX-2 ControlNet effects (pose, detailer). Requires an uploaded video file. Use when the user wants to animate a photo with video motion, replace subjects in a video, restyle, or apply effects to an existing video.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Describe the TARGET appearance (not the transformation process). 2-4 present-tense sentences.

Examples by mode:
- animate-move (DEFAULT — WAN 2.2 Animate Move: applies camera/motion from source video to reference image): "Smooth cinematic camera movement following the subject through the scene."
- animate-replace (WAN 2.2 Animate Replace: replaces the subject in the source video with the reference image): "The person from the reference photo performing the dance moves from the video."
- pose (LTX-2 — tracks skeleton, replace person): "A cartoon character with exaggerated proportions performing the dance moves."
- detailer (LTX-2 — enhance quality): "Ultra-detailed 4K footage with enhanced textures and sharp focus."

Present tense. Positive phrasing. Concrete visual details.

BATCH VARIATIONS: When numberOfVariations > 1, use Dynamic Prompt syntax to vary the artistic treatment while keeping control mode and structural intent consistent. Example: "transform to {watercolor with soft edges|oil painting with bold strokes|anime with clean lines} style".`,
        },
        videoSourceIndex: {
          type: 'number',
          description:
            'Index of the uploaded video file to transform (0-based, from uploaded files list). Required — the user must have uploaded a video file.',
        },
        controlMode: {
          type: 'string',
          enum: ['animate-move', 'animate-replace', 'pose', 'detailer'],
          description:
            'Mode determining how the source video and reference image interact. "animate-move" (DEFAULT): WAN 2.2 Animate Move — applies the camera movement and motion from the source video to the reference image, bringing a still photo to life (requires sourceImageIndex). "animate-replace": WAN 2.2 Animate Replace — replaces the subject in the source video with the person/character from the reference image, keeping the video\'s background and motion (requires sourceImageIndex). "pose": LTX-2 skeleton tracking — preserves body poses. "detailer": LTX-2 quality enhancement. Default: "animate-move".',
        },
        sourceImageIndex: {
          type: 'number',
          description:
            'Optional index of a reference image (0-based). Required for "animate-move" and "animate-replace" control modes. For other modes, an image can optionally influence the visual style.',
        },
        duration: {
          type: 'number',
          description:
            'Output video duration in seconds. Default: 5. Range: 2-20 for animate-move/animate-replace; 2-10 for pose/detailer.',
          minimum: 2,
          maximum: 20,
        },
        numberOfVariations: {
          type: 'number',
          description:
            'Number of video variations to generate (1-16). Default: 1.',
          minimum: 1,
          maximum: 16,
        },
      },
      required: ['prompt'],
    },
  },
};
