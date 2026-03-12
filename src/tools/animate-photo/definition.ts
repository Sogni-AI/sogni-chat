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
      'Generate a video clip from a photo, bringing it to life with motion and animation. Default duration is 5 seconds; use the duration parameter when the user requests a specific length. Use when the user wants to animate, bring to life, create a video from, or add motion to their photo. Examples: "make them wave", "bring this to life", "animate this photo", "create a video of them smiling", "make a 10 second video". IMPORTANT: When previous results exist, this tool automatically uses the LATEST result image unless you specify a different sourceImageIndex or the user explicitly says "original". So just call it without sourceImageIndex for follow-up requests. CRITICAL: If the user\'s request is vague or lacks specific creative direction (e.g. just "animate this photo", "bring this to life", "make a video"), do NOT call this tool yet. First analyze what is actually in the image, then suggest 2-3 specific, vivid animation ideas tailored to the image content (e.g. for a portrait: "gentle breeze through hair with a slow zoom"; for a landscape: "clouds drifting with a gentle pan across the valley"). Your suggestions must reflect what you see — never give generic ideas. Ask which direction they prefer. Only call this tool once you have clear creative intent from the user.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Motion and action prompt for video generation.

--- WAN 2.2 (videoModel "wan22") --- 30-150 words ---
Describe the MOTION and ANIMATION you want to see, not the static image content.
- Include specific actions: "gently smiling and turning their head slightly to the left", "waving hello with a warm expression".
- Describe camera movement if relevant: "slow zoom in", "gentle pan to the right", "camera pushes forward".
- Include atmosphere and mood: "soft warm lighting", "gentle breeze moving their hair".
- For people: describe natural, lifelike movements. Avoid extreme or physically impossible motions.
- Keep movements subtle and natural — small gestures look more realistic than large dramatic actions.

--- LTX-2 (videoModel "ltx2") --- 2-4 present-tense sentences ---
The scene description is automatically generated from the image — you only need to describe MOTION, ACTION, ATMOSPHERE, SOUND, and CAMERA. DO NOT describe the subject's appearance or environment.
1. ACTION (1-2 sentences): One main thread of motion. Use temporal connectors ("as", "then", "while"). Keep actions physically filmable and subtle.
2. ATMOSPHERE & SOUND (1 sentence): Environmental motion and ambient sound woven into prose.
3. CAMERA (append): Camera movement ("slow push-in", "gentle pan right", "static tripod", "handheld subtle drift"). End with "The footage remains smooth and stabilised throughout."

--- AUDIO & DIALOGUE (LTX-2 only) ---
LTX-2 generates audio natively. Describe audio clearly in your prompt:
- Ambient sounds: "the sound of waves crashing on shore", "birds chirping in the background".
- Music: "soft piano melody playing", "upbeat jazz music in the background".
- Dialogue: Write out the ACTUAL spoken words in double quotes. NEVER summarize dialogue as "they argue about X" — write what they say. E.g., The subject says "Hello, how are you today?" with a warm, friendly tone.
- If the user implies a conversation/argument but doesn't specify exact words, CREATE appropriate dialogue that matches their intent.

CRITICAL FOR CHARACTERS: If the user references specific characters (from movies, TV, etc.), describe their visual appearance (clothing, hair, build, features) so they can be recognized visually. Do not rely on names alone.

CONSTRAINTS (both models):
- Present tense only. Positive phrasing.
- No vague words ("beautiful", "nice") — use concrete sensory details.
- Keep movements subtle and natural — small gestures look more realistic than dramatic actions.
- For complex/creative scenes (characters talking, arguments, skits), capture the full creative intent. The system will automatically expand it into a detailed prompt.`,
        },
        videoModel: {
          type: 'string',
          enum: ['ltx2', 'wan22', 'ltx2-hq', 'wan22-hq', 'ltx23'],
          description:
            'Which video model to use. "ltx2" (default): Fast 8-step distilled, generates audio, good balance of speed and quality. "ltx2-hq": High quality 20-step, generates audio, better detail for cinematic results. "ltx23": Latest LTX 2.3 distilled, 8-step, fast + high quality with audio (same engine as ltx2 default). "wan22": Fast 4-step, simple motion, no audio. "wan22-hq": High quality 20-step, better motion fidelity, no audio. Use ltx2 for most requests. Use ltx2-hq or wan22-hq when user asks for "high quality", "best quality", or "detailed". Use wan22 for quick simple motions. Default: "ltx2".',
        },
        duration: {
          type: 'number',
          description:
            'Video duration in seconds. Default: 5. Use when the user explicitly requests a specific length (e.g., "make a 10 second video"). Range: 2-20.',
        },
        sourceImageIndex: {
          type: 'number',
          description:
            'Which result image to animate (0-based index). Omit to use the latest result automatically (or the original if no results exist). Only set explicitly when the user specifies a particular image number or explicitly says "original" (use -1 for original).',
        },
        numberOfVariations: {
          type: 'number',
          description:
            'Number of video variations to generate (1-16). ALWAYS use 1 unless the user explicitly requests multiple videos (e.g., "make 3 versions", "generate 2 videos"). Default: 1.',
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
