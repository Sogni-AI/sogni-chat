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
      'Analyze an image using AI vision — describe contents, read text (OCR), identify objects, answer questions about an image, or compare images. Use when the user asks "what is in this image?", "read the text", "describe this", "what does this show?", or any question about image content. Does NOT generate or modify images.',
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
            'Type of analysis. "describe": detailed visual description. "ocr": extract all visible text. "objects": identify and list objects. "document": analyze document structure and content. "compare": compare with another image. "general" (default): answer the user\'s specific question.',
        },
        sourceImageIndex: {
          type: 'number',
          description:
            'Which result image to analyze (0-based index). -1 = original upload. Omit to auto-select latest result (or original if no results exist).',
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
