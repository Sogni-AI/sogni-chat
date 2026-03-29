/**
 * Centralized policy checks for the tool-calling harness.
 *
 * Policy functions validate whether a tool call is allowed in the current
 * execution state. They return structured check results that the orchestration
 * loop uses to approve, modify, or reject tool calls.
 *
 * Business rules belong here, not buried in individual tool handlers.
 */

import type { ToolName } from '../types';

// ---------------------------------------------------------------------------
// Check result type
// ---------------------------------------------------------------------------

export interface PolicyCheckResult {
  allowed: boolean;
  /** If not allowed, why */
  reason?: string;
  /** If the tool call should be redirected to a different tool */
  redirectTo?: ToolName;
  /** If the tool call needs additional args injected */
  injectArgs?: Record<string, unknown>;
  /** Human-readable explanation for logging */
  explanation?: string;
}

// ---------------------------------------------------------------------------
// Persona policy
// ---------------------------------------------------------------------------

/**
 * Check if a tool call involving image generation needs persona resolution first.
 *
 * Rule: If the prompt mentions persona names but personas haven't been resolved,
 * force resolve_personas before proceeding.
 *
 * Rule: If persona photos are loaded, redirect generate_image → edit_image
 * (personas must always use edit_image with reference photos).
 */
export function checkPersonaPolicy(
  toolName: string,
  args: Record<string, unknown>,
  state: {
    personaNames: string[];
    hasPersonaPhotos: boolean;
    hasUploadedImages: boolean;
  },
): PolicyCheckResult {
  // Check both prompt and imagePrompt — tools may use either field name.
  // Concatenate (don't short-circuit) so persona names in either field are caught.
  const promptText = [String(args.prompt || ''), String(args.imagePrompt || '')].join(' ').toLowerCase();

  // If persona photos are loaded and user is trying generate_image, redirect to edit_image.
  // This fires for ALL generate_image calls when photos are loaded — by design, personas
  // must always use edit_image for identity preservation, regardless of prompt content.
  if (toolName === 'generate_image' && state.hasPersonaPhotos) {
    return {
      allowed: true,
      redirectTo: 'edit_image',
      explanation: 'Redirecting generate_image → edit_image: persona photos require edit_image for identity preservation',
    };
  }

  // If prompt mentions persona names but personas haven't been resolved
  if (
    toolName !== 'resolve_personas' &&
    state.personaNames.length > 0 &&
    !state.hasPersonaPhotos &&
    state.personaNames.some(name => promptText.includes(name.toLowerCase()))
  ) {
    return {
      allowed: false,
      reason: 'precondition_failed',
      explanation: `Prompt mentions personas (${state.personaNames.filter(n => promptText.includes(n.toLowerCase())).join(', ')}) but they haven't been resolved — resolve_personas must run first`,
    };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Question suppression policy
// ---------------------------------------------------------------------------

/**
 * Check if the model's text response ends with a question, indicating
 * it's waiting for user input before executing tools.
 *
 * Rule: If the model's response text ends with "?", suppress tool calls
 * and let the user respond first.
 */
export function checkQuestionSuppression(
  responseText: string,
  hasToolCalls: boolean,
): PolicyCheckResult {
  if (!hasToolCalls) return { allowed: true };

  const trimmed = responseText.trim();
  if (trimmed.endsWith('?')) {
    return {
      allowed: false,
      reason: 'business_rule',
      explanation: 'Suppressing tool calls: model response ends with "?" — waiting for user input',
    };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Tool dependency checks
// ---------------------------------------------------------------------------

/** Map of tools to their prerequisite tools */
const TOOL_PREREQUISITES: Partial<Record<ToolName, {
  requires: ToolName;
  condition: string;
  check: (state: ToolCallState) => boolean;
}[]>> = {
  // edit_image requires persona resolution when personas are referenced
  edit_image: [
    {
      requires: 'resolve_personas',
      condition: 'When prompt references personas that have not been resolved',
      check: (state) => state.personaNames.length > 0 && !state.hasPersonaPhotos,
    },
  ],
  // animate_photo can work on any image, no hard prerequisites
  // orbit_video handles its own prerequisites internally via pipeline
  // dance_montage handles its own prerequisites internally via pipeline
};

export interface ToolCallState {
  /** Known persona names in the session */
  personaNames: string[];
  /** Whether persona photos are currently loaded */
  hasPersonaPhotos: boolean;
  /** Whether user has uploaded images */
  hasUploadedImages: boolean;
  /** Tool names that have been executed in this run */
  executedTools: string[];
  /** URLs of available results */
  availableResultUrls: string[];
  /** URLs of available video results */
  availableVideoUrls: string[];
}

/**
 * Check if all prerequisites for a tool are satisfied.
 */
export function checkPrerequisites(
  toolName: string,
  state: ToolCallState,
): PolicyCheckResult {
  const prereqs = TOOL_PREREQUISITES[toolName as ToolName];
  if (!prereqs) return { allowed: true };

  for (const prereq of prereqs) {
    if (prereq.check(state)) {
      // Prerequisite condition is active and requirement not met
      if (!state.executedTools.includes(prereq.requires)) {
        return {
          allowed: false,
          reason: 'precondition_failed',
          explanation: `${toolName} requires ${prereq.requires} first: ${prereq.condition}`,
        };
      }
    }
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Composite policy check
// ---------------------------------------------------------------------------

/**
 * Run all applicable policy checks for a tool call.
 * Returns the first failing check, or an "allowed" result.
 */
export function runPolicyChecks(
  toolName: string,
  args: Record<string, unknown>,
  state: ToolCallState,
): PolicyCheckResult {
  // 1. Persona policy
  const personaCheck = checkPersonaPolicy(toolName, args, state);
  if (!personaCheck.allowed || personaCheck.redirectTo) return personaCheck;

  // 2. Prerequisites
  const prereqCheck = checkPrerequisites(toolName, state);
  if (!prereqCheck.allowed) return prereqCheck;

  return { allowed: true };
}
