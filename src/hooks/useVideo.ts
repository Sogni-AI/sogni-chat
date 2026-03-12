import { useState, useCallback, useRef } from 'react';
import { SogniClient } from '@sogni-ai/sogni-client';
import { generateVideo } from '../services/videoService';
import { trackVideoGenerationStarted, trackVideoGenerationCompleted, trackVideoGenerationFailed } from '../services/analyticsService';
import { TokenType } from '../types/wallet';

interface UseVideoResult {
  isGenerating: boolean;
  progress: number;
  error: string | null;
  videoUrl: string | null;
  generate: (client: SogniClient, imageUrl: string, width: number, height: number, tokenType: TokenType) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

export function useVideo(): UseVideoResult {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const generate = useCallback(async (
    client: SogniClient,
    imageUrl: string,
    width: number,
    height: number,
    tokenType: TokenType
  ) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsGenerating(true);
    setProgress(0);
    setError(null);
    setVideoUrl(null);

    trackVideoGenerationStarted({ width, height });

    try {
      const resultUrl = await generateVideo(
        client,
        { imageUrl, width, height, tokenType },
        (progressUpdate) => {
          if (progressUpdate.progress !== undefined) {
            setProgress(progressUpdate.progress);
          }
        },
        controller.signal
      );

      setVideoUrl(resultUrl);
      setProgress(1);
      trackVideoGenerationCompleted({ width, height });
    } catch (err: any) {
      // Don't show error UI for user-initiated cancellation
      if (err.message === 'CANCELLED') {
        console.log('[VIDEO] Generation cancelled by user');
        return;
      }

      console.error('[VIDEO] Generation failed:', err);
      trackVideoGenerationFailed(err.message || 'unknown');

      if (err.isInsufficientCredits || err.message === 'INSUFFICIENT_CREDITS') {
        setError('INSUFFICIENT_CREDITS');
      } else {
        setError(err.message || 'Video generation failed. Please try again.');
      }

      // Re-throw so callers know the operation failed
      throw err;
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsGenerating(false);
    setProgress(0);
    setError(null);
    setVideoUrl(null);
  }, []);

  const reset = useCallback(() => {
    setIsGenerating(false);
    setProgress(0);
    setError(null);
    setVideoUrl(null);
  }, []);

  return {
    isGenerating,
    progress,
    error,
    videoUrl,
    generate,
    cancel,
    reset
  };
}
