/**
 * Credit / balance checking utilities for tool execution.
 *
 * Handles pre-flight balance verification, automatic token-type switching
 * (spark ↔ sogni), and retry-with-fallback for insufficient-credits errors.
 */

import type { TokenType, Balances } from '@/types/wallet';
import type { ToolExecutionContext } from '../types';

/** Unified check for insufficient-credits errors from any source */
export function isInsufficientCreditsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if (e.isInsufficientCredits) return true;
  if (e.code === 4024) return true;
  const msg = String(e.message || '').toLowerCase();
  return msg.includes('insufficient') || msg === 'insufficient_credits';
}

/** Get the alternate token type */
export function getAlternateToken(current: TokenType): TokenType {
  return current === 'spark' ? 'sogni' : 'spark';
}

/** Check if a token type has usable balance, optionally requiring a minimum amount */
export function hasBalance(balances: Balances | null, token: TokenType, minRequired?: number): boolean {
  if (!balances) return false;
  const net = parseFloat(balances[token]?.net || '0');
  return minRequired !== undefined ? net >= minRequired : net > 0;
}

/**
 * Pre-flight credit check: verify the user can afford the operation
 * BEFORE creating placeholders or submitting jobs.
 *
 * If the current token is insufficient but the alternate has enough,
 * proactively switches and mutates context.tokenType.
 * If neither can afford it, triggers the insufficient credits popup.
 */
export function preflightCreditCheck(
  context: ToolExecutionContext,
  estimatedCost: number,
): { ok: true } | { ok: false; errorJson: string } {
  if (hasBalance(context.balances, context.tokenType, estimatedCost)) {
    return { ok: true };
  }

  const alternate = getAlternateToken(context.tokenType);
  if (hasBalance(context.balances, alternate, estimatedCost)) {
    console.log(`[CREDIT CHECK] Pre-flight: ${context.tokenType} insufficient, switching to ${alternate}`);
    context.tokenType = alternate;
    context.onTokenSwitch?.(alternate);
    return { ok: true };
  }

  console.log(`[CREDIT CHECK] Pre-flight: insufficient credits on both token types (need ${estimatedCost})`);
  context.onInsufficientCredits?.();
  return {
    ok: false,
    errorJson: JSON.stringify({
      error: 'insufficient_credits',
      message: 'The user does not have enough credits for this operation. The credits purchase popup has been shown.',
    }),
  };
}

/**
 * Try an operation with the current token type, auto-switching to the
 * alternate type if the first attempt fails with insufficient credits.
 */
export async function tryWithTokenFallback<T>(
  operation: (tokenType: TokenType) => Promise<T>,
  context: ToolExecutionContext,
  estimatedCost?: number,
): Promise<T> {
  try {
    return await operation(context.tokenType);
  } catch (err: unknown) {
    if (!isInsufficientCreditsError(err)) throw err;

    const alternate = getAlternateToken(context.tokenType);
    if (hasBalance(context.balances, alternate, estimatedCost)) {
      console.log(`[CREDIT CHECK] Insufficient ${context.tokenType} balance, switching to ${alternate}`);
      context.tokenType = alternate;
      context.onTokenSwitch?.(alternate);

      try {
        return await operation(alternate);
      } catch (retryErr: unknown) {
        if (isInsufficientCreditsError(retryErr)) {
          context.onInsufficientCredits?.();
        }
        throw retryErr;
      }
    }

    // No alternate balance available
    context.onInsufficientCredits?.();
    throw err;
  }
}
