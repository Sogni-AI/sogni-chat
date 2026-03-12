/**
 * Handler for analyze_image tool.
 * Uses vision LLM (multimodal chat completions) to analyze images.
 */

import type { ChatMessage, ContentPart } from '@sogni-ai/sogni-client';
import type { ToolExecutionContext, ToolCallbacks } from '../types';
import {
  fetchImageAsUint8Array,
  stripThinkBlocks,
  uint8ArrayToDataUri,
} from '../shared';
import { CHAT_MODEL } from '@/config/chat';

// System prompts per analysis type
const SYSTEM_PROMPTS: Record<string, string> = {
  describe:
    'You are an expert image analyst. Provide a detailed, structured visual description of this image. Include: subjects, composition, colors, lighting, style, mood, and any notable details.',
  ocr:
    'You are an OCR specialist. Extract ALL visible text from this image exactly as it appears. Preserve formatting, line breaks, and structure. If text is partially obscured, note what you can read and indicate uncertain characters.',
  objects:
    'You are an object detection specialist. Identify and list all distinct objects visible in this image. For each object, note its position (left/center/right, top/middle/bottom) and approximate size relative to the image.',
  document:
    'You are a document analysis specialist. Analyze this document image: identify its type, extract key information, describe its structure, and note any formatting, signatures, stamps, or annotations.',
  compare:
    'You are an image comparison specialist. Two images are provided: Image A (first) and Image B (second). Compare them in detail: note similarities and differences in composition, content, style, colors, quality, and any notable changes. If one appears to be a style reference, describe exactly what stylistic elements could be transferred to the other image.',
  general:
    'You are a helpful AI vision assistant. Answer the user\'s question about this image accurately and concisely.',
};

/**
 * Resolve an image by index.
 * Positive numbers index into context.resultUrls (generated results).
 * -1 = original upload (context.imageData or first uploaded image).
 * -2, -3, ... = second, third, etc. uploaded image file.
 * undefined = auto-select latest result, falling back to original.
 */
async function resolveImage(
  index: number | undefined,
  context: ToolExecutionContext,
): Promise<Uint8Array | null> {
  // Negative indices: uploaded images (-1 = first/original, -2 = second, etc.)
  if (index !== undefined && index < 0) {
    const uploadIdx = Math.abs(index) - 1; // -1 → 0, -2 → 1, -3 → 2
    if (uploadIdx === 0 && context.imageData) {
      return context.imageData;
    }
    const imgFiles = context.uploadedFiles.filter(f => f.type === 'image');
    if (imgFiles[uploadIdx]) return imgFiles[uploadIdx].data;
    // Fallback for -1 when no imageData but uploadedFiles exist
    if (uploadIdx === 0 && imgFiles.length > 0) return imgFiles[0].data;
    return null;
  }

  // Positive or undefined: index into resultUrls
  const effectiveIndex = index ?? (context.resultUrls.length > 0 ? context.resultUrls.length - 1 : undefined);

  if (effectiveIndex !== undefined && context.resultUrls[effectiveIndex]) {
    try {
      const fetched = await fetchImageAsUint8Array(context.resultUrls[effectiveIndex]);
      return fetched.data;
    } catch (err) {
      console.error('[ANALYZE] Failed to fetch result image:', err);
    }
  }

  // Fallback to original upload
  if (context.imageData) return context.imageData;
  const imgFile = context.uploadedFiles.find(f => f.type === 'image');
  return imgFile?.data ?? null;
}

export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<string> {
  const query = args.query as string;
  const analysisType = (args.analysisType as string) || 'general';
  const rawSourceIndex = args.sourceImageIndex as number | undefined;
  const compareIndex = args.compareImageIndex as number | undefined;
  const detailed = (args.detailed as boolean) || false;

  // Resolve primary image
  const imageData = await resolveImage(rawSourceIndex, context);

  if (!imageData) {
    return JSON.stringify({ error: 'no_image', message: 'No image available to analyze. Please upload an image first.' });
  }

  // Resolve second image for compare mode
  let compareImageData: Uint8Array | null = null;
  if (analysisType === 'compare') {
    if (compareIndex !== undefined) {
      compareImageData = await resolveImage(compareIndex, context);
    } else {
      // Auto-detect second image for comparison
      const imgFiles = context.uploadedFiles.filter(f => f.type === 'image');
      if (imgFiles.length >= 2) {
        // Multiple uploads: compare first vs second
        compareImageData = imgFiles[1].data;
      } else if (context.resultUrls.length > 0) {
        // Results exist: compare original upload vs latest result
        // (regardless of whether sourceImageIndex was explicit or omitted)
        const sourceIsOriginal = rawSourceIndex !== undefined && rawSourceIndex < 0;
        if (sourceIsOriginal) {
          // Source is original → compare against latest result
          compareImageData = await resolveImage(context.resultUrls.length - 1, context);
        } else {
          // Source is a result (or auto-selected) → compare against original upload
          compareImageData = await resolveImage(-1, context);
        }
      }
    }

    if (!compareImageData) {
      return JSON.stringify({
        error: 'no_compare_image',
        message: 'Compare mode requires two images. Upload a second image or specify compareImageIndex to select which result to compare against.',
      });
    }
  }

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'analyze_image',
    totalCount: 1,
    stepLabel: analysisType === 'compare' ? 'Comparing images...' : 'Analyzing image...',
  });

  const dataUri = uint8ArrayToDataUri(imageData);
  const systemPrompt = SYSTEM_PROMPTS[analysisType] || SYSTEM_PROMPTS.general;
  const detailedSuffix = detailed ? ' Provide an extremely thorough and detailed analysis.' : '';

  // Build user message content — single image or two images for compare
  const userContent: ContentPart[] = [
    { type: 'image_url', image_url: { url: dataUri } },
  ];

  if (compareImageData) {
    const compareDataUri = uint8ArrayToDataUri(compareImageData);
    userContent.push({ type: 'image_url', image_url: { url: compareDataUri } });
  }

  userContent.push({ type: 'text', text: query });

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt + detailedSuffix },
    { role: 'user', content: userContent },
  ];

  try {
    const stream = await context.sogniClient.chat.completions.create({
      model: context.model || CHAT_MODEL,
      messages,
      stream: true,
      tokenType: context.tokenType,
      temperature: 0.3,
      max_tokens: detailed ? 2048 : 1024,
      think: false,
    });

    let analysis = '';
    let insideThink = false;
    for await (const chunk of stream) {
      if (chunk.content) {
        const { cleaned, insideThink: still } = stripThinkBlocks(chunk.content, insideThink);
        insideThink = still;
        if (cleaned) analysis += cleaned;
      }
    }

    analysis = analysis.trim();
    console.log(`[ANALYZE] ${analysisType === 'compare' ? 'Comparison' : 'Analysis'} complete (${analysis.length} chars)`);

    callbacks.onToolProgress({
      type: 'completed',
      toolName: 'analyze_image',
      progress: 1,
    });

    // No onToolComplete with URLs — this tool produces text, not images/videos
    callbacks.onToolComplete('analyze_image', []);

    return JSON.stringify({
      success: true,
      analysis,
      message: analysis,
    });
  } catch (err: unknown) {
    console.error('[ANALYZE] Vision analysis failed:', err);
    return JSON.stringify({
      error: 'analysis_failed',
      message: `Image analysis failed: ${(err as Error).message || 'Unknown error'}`,
    });
  }
}
