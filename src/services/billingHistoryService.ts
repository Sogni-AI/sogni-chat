/**
 * Billing History Service
 *
 * Core service for tracking generation costs. Uses a pending cost cache
 * for in-flight jobs and persists completed jobs to IndexedDB.
 *
 * Flow:
 * 1. Before generation: registerPendingCost() -> returns correlationId
 * 2. On success: recordCompletion(correlationId) -> persists to DB
 * 3. On failure: discardPending(correlationId) -> removes from cache
 */

import { v4 as uuidv4 } from 'uuid';
import type { BillingRecord, BillingLineItem, BillingJobType } from '@/types/billing';
import { addBillingRecord, getAllBillingRecords, clearBillingHistory as clearDB } from './billingHistoryDB';

/** Metadata attached to a pending cost entry */
interface PendingCostMetadata {
  type: BillingJobType;
  model?: string;
  quality?: string;
  imageCount?: number;
}

interface PendingCost {
  costToken: number;
  costUSD: number;
  tokenType: 'spark' | 'sogni';
  metadata: PendingCostMetadata;
  createdAt: number;
}

// In-memory cache for in-flight jobs
const pendingCosts = new Map<string, PendingCost>();

// Pub-sub for React hook
type ChangeListener = () => void;
const changeListeners = new Set<ChangeListener>();

function notifyChange() {
  for (const listener of changeListeners) {
    listener();
  }
}

/** Subscribe to billing data changes */
export function subscribeToChanges(listener: ChangeListener): () => void {
  changeListeners.add(listener);
  return () => { changeListeners.delete(listener); };
}

/**
 * Register a pending cost for an in-flight job.
 * Returns a correlationId to use with recordCompletion/discardPending.
 *
 * Overloaded: can be called with simple (toolName, cost, tokenType) from tool handlers,
 * or with the full (costToken, costUSD, tokenType, metadata) signature.
 */
export function registerPendingCost(
  toolNameOrCostToken: string | number,
  estimatedCostOrCostUSD: number,
  tokenType: 'spark' | 'sogni',
  metadata?: PendingCostMetadata,
): string {
  const correlationId = uuidv4();

  // Map tool names to billing job types
  const toolToBillingType: Record<string, BillingJobType> = {
    restore_photo: 'restoration',
    apply_style: 'style',
    refine_result: 'restoration',
    animate_photo: 'video',
    change_angle: 'angle',
    generate_image: 'restoration',
    edit_image: 'restoration',
    generate_video: 'video',
    sound_to_video: 'video',
    video_to_video: 'video',
    generate_music: 'restoration',
  };

  // Simple call from tool handlers: registerPendingCost('restore_photo', 5.0, 'spark')
  if (typeof toolNameOrCostToken === 'string') {
    pendingCosts.set(correlationId, {
      costToken: estimatedCostOrCostUSD,
      costUSD: 0,
      tokenType,
      metadata: metadata ?? { type: toolToBillingType[toolNameOrCostToken] ?? 'restoration' },
      createdAt: Date.now(),
    });
  } else {
    // Full call: registerPendingCost(costToken, costUSD, tokenType, metadata)
    pendingCosts.set(correlationId, {
      costToken: toolNameOrCostToken,
      costUSD: estimatedCostOrCostUSD,
      tokenType,
      metadata: metadata ?? { type: 'restoration' },
      createdAt: Date.now(),
    });
  }

  return correlationId;
}

/**
 * Record a completed job — persists to IndexedDB and notifies listeners.
 */
export async function recordCompletion(correlationId: string): Promise<void> {
  const pending = pendingCosts.get(correlationId);
  if (!pending) {
    console.warn('[BillingService] No pending cost for correlationId:', correlationId);
    return;
  }

  pendingCosts.delete(correlationId);

  const record: BillingRecord = {
    id: uuidv4(),
    timestamp: Date.now(),
    type: pending.metadata.type,
    tokenType: pending.tokenType,
    costToken: pending.costToken,
    costUSD: pending.costUSD,
    model: pending.metadata.model,
    quality: pending.metadata.quality,
    imageCount: pending.metadata.imageCount
  };

  await addBillingRecord(record);
  notifyChange();
}

/**
 * Discard a pending cost (for failed/cancelled jobs).
 */
export function discardPending(correlationId: string): void {
  pendingCosts.delete(correlationId);
}

// 5-minute aggregation window
const AGGREGATION_WINDOW_MS = 5 * 60 * 1000;

/**
 * Aggregate billing records into display line items.
 * Groups same-type + same-tokenType records within a 5-minute window.
 */
export function aggregateRecords(records: BillingRecord[]): BillingLineItem[] {
  if (records.length === 0) return [];

  // Sort chronologically (oldest first for grouping)
  const sorted = [...records].sort((a, b) => a.timestamp - b.timestamp);

  const lineItems: BillingLineItem[] = [];
  let currentGroup: BillingRecord[] = [];
  let groupType = sorted[0].type;
  let groupTokenType = sorted[0].tokenType;
  let groupStart = sorted[0].timestamp;

  const flushGroup = () => {
    if (currentGroup.length === 0) return;

    const first = currentGroup[0];
    const last = currentGroup[currentGroup.length - 1];

    lineItems.push({
      id: first.id,
      type: first.type,
      tokenType: first.tokenType,
      totalCostToken: currentGroup.reduce((sum, r) => sum + r.costToken, 0),
      totalCostUSD: currentGroup.reduce((sum, r) => sum + r.costUSD, 0),
      itemCount: currentGroup.length,
      timestamp: last.timestamp,
      quality: first.quality
    });
  };

  for (const record of sorted) {
    const sameType = record.type === groupType;
    const sameToken = record.tokenType === groupTokenType;
    const withinWindow = record.timestamp - groupStart < AGGREGATION_WINDOW_MS;

    if (sameType && sameToken && withinWindow) {
      currentGroup.push(record);
    } else {
      flushGroup();
      currentGroup = [record];
      groupType = record.type;
      groupTokenType = record.tokenType;
      groupStart = record.timestamp;
    }
  }

  flushGroup();

  // Return newest first for display
  return lineItems.reverse();
}

/** Get all records from DB */
export { getAllBillingRecords };

/** Clear all billing history */
export async function clearBillingHistory(): Promise<void> {
  await clearDB();
  notifyChange();
}
