/**
 * Tool definition for analyze_image.
 * Uses vision LLM to analyze, describe, or extract text from images.
 */

import type { ToolDefinition } from '@sogni-ai/sogni-client';

export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'analyze_image',
    description:
      'Analyze an image using AI vision — describe contents, read text (OCR), identify objects, compare two images, or answer questions about an image. Use when the user asks "what is in this image?", "read the text", "describe this", "what does this show?", "compare these", "make it in this style", or any question about image content. For "compare" mode, two images are sent to the vision model side-by-side. Does NOT generate or modify images.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'The user\'s question or request about the image. Be specific about what to analyze. E.g., "Describe everything in this image", "Read all visible text", "What objects are present?", "What style is this artwork?".',
        },
        analysisType: {
          type: 'string',
          enum: ['describe', 'ocr', 'objects', 'document', 'compare', 'general'],
          description:
            'Type of analysis. "describe": detailed visual description. "ocr": extract all visible text. "objects": identify and list objects. "document": analyze document structure and content. "compare": compare two images side-by-side (requires compareImageIndex). "general" (default): answer the user\'s specific question.',
        },
        sourceImageIndex: {
          type: 'number',
          description:
            'Which result image to analyze (0-based index into generated results). -1 = original upload, -2 = second uploaded image, -3 = third, etc. Omit to auto-select latest result (or original if no results exist).',
        },
        compareImageIndex: {
          type: 'number',
          description:
            'Second image for "compare" mode (0-based index into generated results). -1 = original upload. Use when comparing two images side-by-side — e.g., "make it in this style" (compare style reference with source), "what changed?" (compare before/after). If the user uploaded two images, the first is the source (sourceImageIndex=-1) and the second is the comparison target (compareImageIndex=-2 for second upload, -3 for third, etc.).',
        },
        detailed: {
          type: 'boolean',
          description:
            'Whether to provide a detailed analysis. Default: false. Set to true for comprehensive descriptions.',
        },
      },
      required: ['query'],
    },
  },
};
