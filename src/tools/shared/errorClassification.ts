/**
 * Error classification utilities for the tool-calling harness.
 *
 * Maps raw errors from tool execution into typed ToolErrorCategory values
 * for structured error handling, observability, and retry decisions.
 */

import type { ToolErrorCategory } from '../types';

/** Classify a raw error into a typed category */
export function classifyError(error: unknown): {
  category: ToolErrorCategory;
  message: string;
  retryable: boolean;
} {
  if (!error) {
    return { category: 'permanent_failure', message: 'Unknown error', retryable: false };
  }

  const message = error instanceof Error ? error.message : String(error);
  const lowerMsg = message.toLowerCase();

  // Insufficient credits
  if (
    lowerMsg.includes('insufficient') ||
    lowerMsg.includes('insufficient_credits') ||
    (typeof error === 'object' && error !== null && (error as Record<string, unknown>).code === 4024)
  ) {
    return { category: 'insufficient_credits', message, retryable: true };
  }

  // Cancelled / aborted
  if (lowerMsg.includes('cancelled') || lowerMsg.includes('canceled') || lowerMsg.includes('abort')) {
    return { category: 'cancelled', message, retryable: false };
  }

  // Timeout
  if (lowerMsg.includes('timed out') || lowerMsg.includes('timeout')) {
    return { category: 'timeout', message, retryable: true };
  }

  // Transient network/API failures
  if (
    lowerMsg.includes('network') ||
    lowerMsg.includes('econnreset') ||
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('socket hang up') ||
    lowerMsg.includes('502') ||
    lowerMsg.includes('503') ||
    lowerMsg.includes('504')
  ) {
    return { category: 'transient_failure', message, retryable: true };
  }

  // Schema / parse errors
  if (lowerMsg.includes('parse') || lowerMsg.includes('malformed') || lowerMsg.includes('missing required')) {
    return { category: 'schema_validation', message, retryable: false };
  }

  // Content refusal
  if (lowerMsg.includes('content policy') || lowerMsg.includes('refused') || lowerMsg.includes('not appropriate')) {
    return { category: 'content_refused', message, retryable: false };
  }

  // Default to permanent failure
  return { category: 'permanent_failure', message, retryable: false };
}

/** Check if a result JSON string contains an error */
export function parseResultForError(rawResult: string): {
  hasError: boolean;
  error?: string;
  category?: ToolErrorCategory;
  retryable?: boolean;
} {
  try {
    const parsed = JSON.parse(rawResult);
    if (parsed.error) {
      const classified = classifyError(parsed.error === 'insufficient_credits'
        ? new Error('insufficient_credits')
        : new Error(parsed.message || parsed.error));
      return {
        hasError: true,
        error: parsed.message || parsed.error,
        category: classified.category,
        retryable: classified.retryable,
      };
    }
    return { hasError: false };
  } catch {
    // Not JSON — treat as success
    return { hasError: false };
  }
}
