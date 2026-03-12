/**
 * Hook for fetching and caching token-to-USD price conversion.
 * Uses the public endpoint https://api.sogni.ai/v1/contract/price
 * which returns { sogni: "0.001798", spark: "0.005" } (USD per token).
 */
import { useState, useEffect, useCallback } from 'react';
import type { TokenType } from '../types/wallet';

interface TokenPrices {
  sogni: number;
  spark: number;
}

interface UseTokenPriceResult {
  prices: TokenPrices | null;
  loading: boolean;
  /** Convert a token amount to USD */
  tokenToUSD: (amount: number, tokenType?: TokenType) => number | null;
}

// Module-level cache — shared across all hook instances
let cachedPrices: TokenPrices | null = null;
let fetchPromise: Promise<TokenPrices | null> | null = null;

const PRICE_API_URL = 'https://api.sogni.ai/v1/contract/price';

async function fetchPrices(): Promise<TokenPrices | null> {
  try {
    const response = await fetch(PRICE_API_URL);
    if (!response.ok) return null;
    const json = await response.json();
    if (json.status === 'success' && json.data) {
      const prices: TokenPrices = {
        sogni: parseFloat(json.data.sogni),
        spark: parseFloat(json.data.spark),
      };
      if (!isNaN(prices.sogni) && !isNaN(prices.spark)) {
        cachedPrices = prices;
        return prices;
      }
    }
    return null;
  } catch (err) {
    console.warn('[useTokenPrice] Failed to fetch token prices:', err);
    return null;
  }
}

/**
 * Non-hook utility for converting tokens to USD.
 * Uses the module-level cache — returns 0 if prices haven't been fetched yet.
 * Safe to call from services and non-React contexts.
 */
export function convertTokenToUSD(amount: number, tokenType: TokenType): number {
  if (!cachedPrices) return 0;
  return amount * cachedPrices[tokenType];
}

export function useTokenPrice(tokenType: TokenType = 'spark'): UseTokenPriceResult {
  const [prices, setPrices] = useState<TokenPrices | null>(cachedPrices);
  const [loading, setLoading] = useState(!cachedPrices);

  useEffect(() => {
    let cancelled = false;

    if (cachedPrices) {
      setPrices(cachedPrices);
      setLoading(false);
      return;
    }

    // Deduplicate concurrent fetches
    if (!fetchPromise) {
      fetchPromise = fetchPrices().finally(() => { fetchPromise = null; });
    }

    fetchPromise.then((result) => {
      if (cancelled) return;
      if (result) setPrices(result);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, []);

  const tokenToUSD = useCallback((amount: number, type?: TokenType): number | null => {
    const p = cachedPrices || prices;
    if (!p) return null;
    const rate = p[type || tokenType];
    return amount * rate;
  }, [prices, tokenType]);

  return { prices, loading, tokenToUSD };
}
