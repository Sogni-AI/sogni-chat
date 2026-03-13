/**
 * Hook for Spark credit pack purchases via Stripe (through Sogni SDK IAP API).
 */
import { useCallback, useEffect } from 'react';
import type { SogniClient } from '@sogni-ai/sogni-client';
import useApiAction from './useApiAction';
import useApiQuery from './useApiQuery';
import { getPurchase, getStripeProducts, startPurchase } from '@/services/stripeService';

function useSparkPurchase() {
  const { data: products, error: productsError } = useApiQuery(getStripeProducts);

  const {
    data: purchaseIntent,
    loading: intentLoading,
    error: intentError,
    execute: makePurchase,
    reset: resetIntent,
  } = useApiAction(startPurchase);

  const purchaseId = purchaseIntent?.purchaseId;

  const fetchPurchaseStatus = useCallback(
    async (api: SogniClient) => {
      if (!purchaseId) return null;
      return getPurchase(api, purchaseId);
    },
    [purchaseId]
  );

  const {
    data: purchaseStatus,
    loading: loadingStatus,
    error: statusError,
    execute: refreshStatus,
    reset: resetStatus,
  } = useApiAction(fetchPurchaseStatus);

  const reset = useCallback(() => {
    resetIntent();
    resetStatus();
  }, [resetIntent, resetStatus]);

  useEffect(() => {
    if (productsError) {
      console.error('[SPARK PURCHASE] Failed to load products:', productsError);
    }
  }, [productsError]);

  useEffect(() => {
    if (intentError) {
      console.error('[SPARK PURCHASE] Purchase failed:', intentError);
      resetIntent();
    }
  }, [intentError, resetIntent]);

  useEffect(() => {
    if (statusError) {
      console.error('[SPARK PURCHASE] Purchase status check failed:', statusError);
      resetStatus();
    }
  }, [statusError, resetStatus]);

  return {
    products,
    purchaseIntent,
    purchaseStatus,
    makePurchase,
    refreshStatus,
    loading: loadingStatus || intentLoading,
    reset,
  };
}

export default useSparkPurchase;
