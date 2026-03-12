/**
 * Hook for estimating restoration costs via the Sogni API.
 * Replaces hardcoded credit costs with real-time API estimates.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { QUALITY_PRESETS, type QualityTier } from '@/config/qualityPresets';
import { useSogniAuth } from '@/services/sogniAuth';
import type { SogniClient } from '@sogni-ai/sogni-client';

interface RestorationCostEstimationParams {
  qualityTier: QualityTier;
  imageCount: number;
  tokenType: 'spark' | 'sogni';
  enabled?: boolean;
}

interface RestorationCostEstimationResult {
  loading: boolean;
  cost: number | null;
  costInUSD: number | null;
  perImageCost: number | null;
  perImageUSD: number | null;
  formattedCost: string;
  formattedUSD: string;
  error: Error | null;
  refetch: () => void;
}

async function fetchEstimate(
  sogniClient: SogniClient,
  model: string,
  imageCount: number,
  stepCount: number,
  guidance: number,
  tokenType: string,
): Promise<{ token: number; usd: number }> {
  const projectsApi = sogniClient.projects as any;
  if (!projectsApi || typeof projectsApi.estimateCost !== 'function') {
    throw new Error('estimateCost not available on SDK');
  }
  const result = await projectsApi.estimateCost({
    model,
    imageCount,
    previewCount: 0,
    stepCount,
    guidance,
    contextImages: 1,
    tokenType,
  });
  return {
    token: typeof result?.token === 'string' ? parseFloat(result.token) : result?.token,
    usd: typeof result?.usd === 'string' ? parseFloat(result.usd) : result?.usd,
  };
}

export function useRestorationCostEstimation(
  params: RestorationCostEstimationParams,
): RestorationCostEstimationResult {
  const { qualityTier, imageCount, tokenType, enabled = true } = params;
  const { isAuthenticated, getSogniClient } = useSogniAuth();

  const [loading, setLoading] = useState(false);
  const [cost, setCost] = useState<number | null>(null);
  const [costInUSD, setCostInUSD] = useState<number | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const lastParamsRef = useRef<string>('');

  const doFetch = useCallback(async () => {
    const client = getSogniClient();
    if (!enabled || imageCount <= 0 || !isAuthenticated || !client) {
      setCost(null);
      setCostInUSD(null);
      setError(null);
      setLoading(false);
      lastParamsRef.current = '';
      return;
    }

    const preset = QUALITY_PRESETS[qualityTier];
    const paramsHash = JSON.stringify({
      model: preset.model,
      steps: preset.steps,
      guidance: preset.guidance,
      imageCount,
      tokenType,
    });

    if (paramsHash === lastParamsRef.current) return;
    lastParamsRef.current = paramsHash;

    setLoading(true);
    setError(null);

    try {
      const result = await fetchEstimate(
        client,
        preset.model,
        imageCount,
        preset.steps,
        preset.guidance,
        tokenType,
      );

      const tokenCost = typeof result.token === 'string' ? parseFloat(result.token) : result.token;
      const usdCost = typeof result.usd === 'string' ? parseFloat(result.usd) : result.usd;

      setCost(!isNaN(tokenCost) ? tokenCost : null);
      setCostInUSD(!isNaN(usdCost) ? usdCost : null);
    } catch (err) {
      console.warn('[CostEstimation] Failed:', err);
      setError(err as Error);
      setCost(null);
      setCostInUSD(null);
    } finally {
      setLoading(false);
    }
  }, [enabled, imageCount, qualityTier, tokenType, isAuthenticated, getSogniClient]);

  useEffect(() => {
    void doFetch();
  }, [doFetch]);

  const perImageCost = cost !== null && imageCount > 0 ? cost / imageCount : null;
  const perImageUSD = costInUSD !== null && imageCount > 0 ? costInUSD / imageCount : null;

  const refetch = useCallback(() => {
    lastParamsRef.current = '';
    void doFetch();
  }, [doFetch]);

  return {
    loading,
    cost,
    costInUSD,
    perImageCost,
    perImageUSD,
    formattedCost: cost !== null ? cost.toFixed(2) : '—',
    formattedUSD: costInUSD !== null ? `$${costInUSD.toFixed(2)}` : '—',
    error,
    refetch,
  };
}
