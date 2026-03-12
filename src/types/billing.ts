/**
 * Billing History Types
 *
 * Types for tracking estimated costs of completed generation jobs.
 * Since SDK completion events don't return actual cost data, we record
 * the estimated cost (same values shown in the UI pre-generation)
 * at the moment each job successfully completes.
 */

export type BillingJobType = 'restoration' | 'video' | 'style' | 'angle';

/** A single completed job's billing record */
export interface BillingRecord {
  id: string;
  timestamp: number;
  type: BillingJobType;
  tokenType: 'spark' | 'sogni';
  costToken: number;
  costUSD: number;
  model?: string;
  quality?: string;
  imageCount?: number;
}

/** Aggregated display item (groups same-type records within a time window) */
export interface BillingLineItem {
  id: string;
  type: BillingJobType;
  tokenType: 'spark' | 'sogni';
  totalCostToken: number;
  totalCostUSD: number;
  itemCount: number;
  timestamp: number;
  quality?: string;
}

/** Summary totals across all billing records */
export interface BillingSummary {
  totalSpark: number;
  totalSogni: number;
  totalUSD: number;
  recordCount: number;
}
