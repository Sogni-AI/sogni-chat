/**
 * Handler for analyze_image tool.
 * Uses vision LLM (multimodal chat completions) to analyze images.
 */

import type { ChatMessage } from '@sogni-ai/sogni-client';
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
  general:
    'You are a helpful AI vision assistant. Answer the user\'s question about this image accurately and concisely.',
};

export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<string> {
  const query = args.query as string;
  const analysisType = (args.analysisType as string) || 'general';
  const rawSourceIndex = args.sourceImageIndex as number | undefined;
  const detailed = (args.detailed as boolean) || false;

  // Resolve source image
  const useOriginal = rawSourceIndex === -1;
  const effectiveSourceIndex = useOriginal
    ? undefined
    : rawSourceIndex ?? (context.resultUrls.length > 0 ? context.resultUrls.length - 1 : undefined);

  let imageData: Uint8Array | null = null;

  if (effectiveSourceIndex !== undefined && context.resultUrls[effectiveSourceIndex]) {
    try {
      console.log(`[ANALYZE] Analyzing result image #${effectiveSourceIndex}`);
      const fetched = await fetchImageAsUint8Array(context.resultUrls[effectiveSourceIndex]);
      imageData = fetched.data;
    } catch (err) {
      console.error('[ANALYZE] Failed to fetch result image, falling back to original:', err);
    }
  }

  if (!imageData) {
    // Try original upload
    if (context.imageData) {
      imageData = context.imageData;
    } else if (context.uploadedFiles.length > 0) {
      const imgFile = context.uploadedFiles.find((f) => f.type === 'image');
      if (imgFile) imageData = imgFile.data;
    }
  }

  if (!imageData) {
    return JSON.stringify({ error: 'no_image', message: 'No image available to analyze. Please upload an image first.' });
  }

  callbacks.onToolProgress({
    type: 'started',
    toolName: 'analyze_image',
    totalCount: 1,
    stepLabel: 'Analyzing image...',
  });

  const dataUri = uint8ArrayToDataUri(imageData);
  const systemPrompt = SYSTEM_PROMPTS[analysisType] || SYSTEM_PROMPTS.general;
  const detailedSuffix = detailed ? ' Provide an extremely thorough and detailed analysis.' : '';

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt + detailedSuffix },
    {
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: dataUri } },
        { type: 'text', text: query },
      ],
    },
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
    console.log(`[ANALYZE] Analysis complete (${analysis.length} chars)`);

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
