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
      'Transform an existing video using AI. Apply ControlNet effects like canny edge detection, pose tracking, depth mapping, or subject replacement. Requires an uploaded video file. Use when the user wants to restyle, transform, or apply effects to an existing video.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Text description of the desired visual transformation. 2-4 sentences.

Describe the TARGET appearance, not the transformation process:
- For style transfer: "A vibrant anime scene with bold outlines and cel-shaded coloring, energetic composition."
- For subject replacement: "A robot with metallic chrome body performing the same movements, industrial sci-fi environment."
- For enhancement: "Crisp ultra-high-definition footage with enhanced details, vivid colors, and smooth motion."

Control mode tips:
- "canny": Preserves edge structure. Good for restyling while keeping shapes. "A watercolor painting with soft edges and flowing colors."
- "pose": Tracks body skeleton. Good for replacing the person. "A cartoon character with exaggerated proportions performing the dance moves."
- "depth": Preserves spatial depth. Good for complete scene restyling. "An underwater coral reef scene with bioluminescent lighting."
- "detailer": Enhances quality. "Ultra-detailed 4K footage with enhanced textures and sharp focus."
- "animate-move": Camera animation from reference. Requires a reference image. "Smooth cinematic camera movement following the subject."
- "animate-replace": Subject replacement from reference image. "The character from the reference image performing the video's movements."

CONSTRAINTS: Present tense. Positive phrasing. Concrete visual details.`,
        },
        videoSourceIndex: {
          type: 'number',
          description:
            'Index of the uploaded video file to transform (0-based, from uploaded files list). Required — the user must have uploaded a video file.',
        },
        controlMode: {
          type: 'string',
          enum: ['canny', 'pose', 'depth', 'detailer', 'animate-move', 'animate-replace'],
          description:
            'ControlNet mode determining how the source video guides the output. "canny": Edge detection — preserves shapes and outlines (default). "pose": Skeleton tracking — preserves body poses and movements. "depth": Depth mapping — preserves spatial layout. "detailer": Quality enhancement — improves detail and resolution. "animate-move": Camera motion animation (WAN, requires reference image). "animate-replace": Subject replacement (WAN, requires reference image). Default: "canny".',
        },
        sourceImageIndex: {
          type: 'number',
          description:
            'Optional index of a reference image (0-based). Required for "animate-move" and "animate-replace" control modes. For other modes, an image can optionally influence the visual style.',
        },
        duration: {
          type: 'number',
          description:
            'Output video duration in seconds. Default: matches source video length (up to 10s). Range: 2-10.',
          minimum: 2,
          maximum: 10,
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
