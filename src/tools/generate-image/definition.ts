/**
 * Tool definition for generate_image.
 * Based on workflow_text_to_image.mjs and MODELS.image config.
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';
import { ASPECT_RATIO_DESCRIPTION } from '../shared';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'generate_image',
    description:
      'Generate a new image from a text description ONLY. No reference photos — creates from text alone. IMPORTANT: Do NOT use this tool when the user references people from My Personas — even if the user requests a specific model like Flux.2. If resolve_personas was called and reference photos were loaded, you MUST use edit_image instead (edit_image also supports Flux.2). generate_image cannot use reference photos for identity preservation. A model preference NEVER changes which tool to use.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: `Text description of the image (50-200 words). Subject first, then environment, then style/mood.

Include: lighting ("soft golden hour light"), composition ("close-up portrait", "wide shot"), and style ("oil painting", "shot on Canon EOS R5, 85mm f/1.4"). POSITIVE phrasing only. Be culturally specific and vivid — reference real artists, franchises, and aesthetics by name: "in the style of Monet's Water Lilies", "Pixar 3D render", "cyberpunk Blade Runner neon city", "Miyazaki fantasy landscape", "Wes Anderson symmetrical pastel composition".

BATCH VARIATIONS: When numberOfVariations > 1, the prompt must describe ONE subject in ONE scene — never mention counts, "versions", "different", or "multiple" in the prompt text. NEVER describe multiple copies or duplicates of the subject in a single image (no grids, collages, or side-by-side). Use Dynamic Prompt syntax to vary ONE dimension across separate images. Example: user asks "4 cats in different spots" → numberOfVariations=4, prompt="a black cat {lounging in a sunlit window|prowling through autumn leaves|sitting on a vintage bookshelf|curled up by a fireplace}" — each output is ONE cat in ONE spot. Vary setting, style, lighting, expression, or composition — never override what the user specified.

VIDEO KEYFRAMES: When generating images intended as first+last frames for video (animate_photo with frameRole="both"), use numberOfVariations=2 with Dynamic Prompts to create both frames in one call. Make each frame a distinct scene that creates a compelling transition. Example: "a serene lake {at dawn with mist rising and soft pink sky|at dusk with fireflies and deep blue twilight}".`,
        },
        model: {
          type: 'string',
          enum: [
            'z-turbo', 'z-image', 'chroma-v46-flash', 'chroma-detail', 'flux1-krea', 'flux2', 'pony-v7',
            'qwen-2512', 'qwen-2512-lightning',
            'albedo-xl', 'animagine-xl', 'anima-pencil-xl', 'art-universe-xl', 'hyphoria-real',
            'analog-madness-xl', 'cyberrealistic-xl', 'real-dream-xl', 'faetastic-xl',
            'zavychroma-xl', 'pony-faetality', 'dreamshaper-xl',
          ],
          description:
            'DO NOT SET THIS PARAMETER unless the user names a specific model. The app auto-selects based on quality settings. NSFW rule: "flux2"/"flux1-krea" CANNOT do nudity — use "pony-v7", "chroma-detail", "chroma-v46-flash", or "z-turbo" instead.',
        },
        width: {
          type: 'number',
          description:
            'Output image width in pixels. Must be a multiple of 16. Default: 1024. Max: 2048. IMPORTANT: When the user specifies exact pixel dimensions (e.g., "1080x1920"), set width and height explicitly rather than relying solely on aspectRatio — this ensures the requested resolution is honored.',
        },
        height: {
          type: 'number',
          description:
            'Output image height in pixels. Must be a multiple of 16. Default: 1024. Max: 2048. IMPORTANT: When the user specifies exact pixel dimensions (e.g., "1080x1920"), set width and height explicitly rather than relying solely on aspectRatio — this ensures the requested resolution is honored.',
        },
        numberOfVariations: {
          type: 'number',
          description:
            'Number of variations (1-16). Use 1 unless user requests multiple. Default: 1.',
          minimum: 1,
          maximum: 16,
        },
        negativePrompt: {
          type: 'string',
          description:
            'Things to avoid in the generated image. Only set when the user explicitly mentions what to avoid. E.g., "no watermarks, no text, no blurry edges".',
        },
        starting_image_strength: {
          type: 'number',
          description:
            'Image-to-image strength (0.0-1.0). Only used when a source image is available and model supports img2img. Higher values = more deviation from the source image. 0.5 = balanced, 0.8 = creative. Only set when the user wants to generate variations or use an existing image as a starting point.',
        },
        sourceImageIndex: {
          type: 'number',
          description:
            'Which result image to use as starting image for img2img (0-based index). -1 = original upload. Omit to auto-select latest result. Only relevant when starting_image_strength is set.',
        },
        seed: {
          type: 'integer',
          description:
            'Random seed for reproducibility. Use -1 for random (default). Set a specific seed when the user wants to reproduce a previous result.',
        },
        guidance: {
          type: 'number',
          description:
            'Guidance scale override. Higher values = more prompt adherence. Model-specific defaults are used if omitted. Only set when the user explicitly requests a guidance value.',
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
