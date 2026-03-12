/**
 * Hook for Spark credit pack purchases via Stripe.
 * Stub — full implementation pending Stripe integration.
 */

import { useState, useCallback } from 'react';
import type { Product, PurchaseStatus } from '@/services/stripeService';

interface PurchaseIntent {
  purchaseId?: string;
  productId?: string;
  url?: string;
}

export default function useSparkPurchase() {
  const [products] = useState<Product[]>([]);
  const [loading] = useState(false);
  const [purchaseStatus] = useState<PurchaseStatus>(null);
  const [purchaseIntent] = useState<PurchaseIntent | null>(null);

  const makePurchase = useCallback(async (_productId: string) => {
    console.warn('[PURCHASE] Stripe integration not yet available');
  }, []);

  const reset = useCallback(() => {}, []);
  const refreshStatus = useCallback(async () => {}, []);

  return { products, loading, purchaseStatus, purchaseIntent, makePurchase, reset, refreshStatus };
}
