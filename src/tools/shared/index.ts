/**
 * Shared utilities for tool handlers.
 *
 * Re-exports everything so tool modules can do:
 *   import { fetchImageAsUint8Array, preflightCreditCheck } from '../shared';
 */

export { ASPECT_RATIO_DESCRIPTION } from './aspectRatio';
export { fetchImageAsUint8Array, fetchAudioAsUint8Array } from './sourceImage';
export {
  isInsufficientCreditsError,
  getAlternateToken,
  hasBalance,
  preflightCreditCheck,
  tryWithTokenFallback,
} from './creditCheck';
export {
  registerPendingCost,
  recordCompletion,
  discardPending,
  formatCredits,
} from './billing';
export {
  LLM_SUBCALL_TIMEOUT_MS,
  LLM_THINKING_TIMEOUT_MS,
  withTimeout,
  stripThinkBlocks,
} from './llmHelpers';
export { uint8ArrayToDataUri } from './imageEncoding';
export { needsCreativeRefinement, refineVideoPrompt } from './videoPromptRefinement';
