/**
 * Shared utilities for tool handlers.
 *
 * Re-exports everything so tool modules can do:
 *   import { fetchImageAsUint8Array, preflightCreditCheck } from '../shared';
 */

export { ASPECT_RATIO_DESCRIPTION } from './aspectRatio';
export { fetchImageAsUint8Array, fetchAudioAsUint8Array, getPersonaVoiceClip } from './sourceImage';
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
export { sanitizeBatchPrompt } from './promptSanitizer';
export { needsCreativeRefinement, refineVideoPrompt, estimateDialogueDuration } from './videoPromptRefinement';
export type { RefinementResult } from './videoPromptRefinement';
export { getModelOptions, getAlternativeModels, getModelArgKey, isQualityTierTool } from './modelRegistry';
export type { ModelOption } from './modelRegistry';
export { executePipeline } from './pipeline';
export type { PipelineConfig, PipelineStep, PipelineState, StepResult } from './pipeline';
export { classifyError, parseResultForError } from './errorClassification';
export {
  checkPersonaPolicy,
  checkQuestionSuppression,
  checkPrerequisites,
  runPolicyChecks,
  type PolicyCheckResult,
  type ToolCallState,
} from './policyChecks';
