/**
 * React hook for billing history data.
 *
 * Loads records from IndexedDB, subscribes to real-time changes,
 * and returns aggregated line items for display.
 */

import { useState, useEffect, useCallback } from 'react';
import type { BillingLineItem, BillingSummary } from '../types/billing';
import {
  subscribeToChanges,
  aggregateRecords,
  getAllBillingRecords,
  clearBillingHistory
} from '../services/billingHistoryService';

interface UseBillingHistoryResult {
  lineItems: BillingLineItem[];
  summary: BillingSummary;
  loading: boolean;
  clearHistory: () => Promise<void>;
  refresh: () => void;
}

const emptySummary: BillingSummary = { totalSpark: 0, totalSogni: 0, totalUSD: 0, recordCount: 0 };

export function useBillingHistory(): UseBillingHistoryResult {
  const [lineItems, setLineItems] = useState<BillingLineItem[]>([]);
  const [summary, setSummary] = useState<BillingSummary>(emptySummary);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    try {
      const records = await getAllBillingRecords();

      // Compute summary
      let totalSpark = 0;
      let totalSogni = 0;
      let totalUSD = 0;
      for (const r of records) {
        if (r.tokenType === 'spark') totalSpark += r.costToken;
        else totalSogni += r.costToken;
        totalUSD += r.costUSD;
      }
      setSummary({ totalSpark, totalSogni, totalUSD, recordCount: records.length });

      // Aggregate for display
      setLineItems(aggregateRecords(records));
    } catch (err) {
      console.error('[useBillingHistory] Failed to load:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Subscribe to changes
  useEffect(() => {
    return subscribeToChanges(() => {
      void loadData();
    });
  }, [loadData]);

  const handleClear = useCallback(async () => {
    await clearBillingHistory();
    setLineItems([]);
    setSummary(emptySummary);
  }, []);

  return {
    lineItems,
    summary,
    loading,
    clearHistory: handleClear,
    refresh: loadData
  };
}
