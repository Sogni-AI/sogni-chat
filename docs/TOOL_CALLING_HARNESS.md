# LLM Tool-Calling Harness Reference

> **Version:** 1.0
> **Scope:** Design and implementation guidance for the Sogni Creative Agent tool-calling harness
> **Audience:** Developers maintaining or extending the harness

---

## Purpose

This document defines the requirements and design patterns for a production-grade server-side harness for LLM tool calling. The harness supports ~19 tools with complex workflows, dependencies, validation, retries, and multi-step execution.

**The model proposes. The harness validates. The policy layer decides. The tools execute. The state machine tracks. The observability layer records. The app remains in control.**

---

## 1. Core Goals

The harness must be:

- **Production-safe** — no silent destructive actions
- **Deterministic where possible** — same inputs yield same behavior
- **Debuggable** — structured logs, not printf debugging
- **Auditable** — every decision is traceable
- **Resilient to model mistakes** — validation catches bad calls
- **Explicit about workflow state** — structured run state, not just message history
- **Multi-step capable** — iterative tool calling with context preservation

The model must never be trusted to manage business logic on its own. The harness enforces policy, validation, state transitions, and execution constraints.

---

## 2. Architecture Layers

### A. Model Adapter (`src/services/chatService.ts`)
- Communicates with the LLM (Qwen3 via Sogni SDK)
- Converts app/tool state into model messages
- Parses streaming responses including tool call requests
- Handles `<think>` block stripping and refusal detection

### B. Tool Registry (`src/tools/registry.ts`)
- Central typed registry of all available tools
- Defines metadata, schemas, policies, and executors
- Source of truth for what the model is allowed to call
- Validates arguments against JSON Schema before execution

### C. Orchestration Engine (`src/services/chatService.ts` + `src/hooks/useChat.ts`)
- Runs the multi-step tool calling loop (max 6 rounds)
- Invokes tools via registry
- Feeds results back to the model
- Decides when to continue, stop, pause, or fail

### D. Policy Layer (`src/tools/shared/` + guardrails in chatService)
- Enforces business rules and app constraints
- Credit checks and token switching
- Persona resolution guardrails
- Prompt sanitization
- Content filter management

### E. Run State (`src/hooks/useChat.ts` refs + context)
- Tracks conversation, result URLs, session IDs
- Manages background job routing
- Maintains tool execution progress

### F. Observability Layer (to be enhanced)
- Console logging with prefixed tags
- Tool execution timing via progress callbacks
- Error classification and structured results

---

## 3. Tool Registry Requirements

Every tool must be registered centrally with:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique snake_case identifier |
| `description` | Yes | Natural-language description for model selection |
| `inputSchema` | Yes | JSON Schema for argument validation |
| `execute` | Yes | Executor function `(args, context, callbacks) => Promise<string>` |
| `suggestions` | No | Post-execution suggestion chips |
| `timeout` | Per-tool | Override default 5min timeout |
| `sideEffectLevel` | Recommended | `read` / `write` / `destructive` |
| `retryPolicy` | Recommended | `{ maxAttempts, backoff, retryOn }` |
| `approvalRequired` | Recommended | Whether user confirmation needed |
| `prerequisites` | Recommended | State checks before execution |
| `canRunInParallel` | Recommended | Whether safe for concurrent execution |
| `idempotencyKey` | Optional | Deduplication key function |

### Current Tool Metadata Shape

```typescript
interface ToolHandler {
  definition: ToolDefinition;     // OpenAI-format JSON Schema
  execute: ToolExecutor;          // (args, context, callbacks) => Promise<string>
  suggestions?: ToolSuggestion[];
}
```

### Target Tool Metadata Shape

```typescript
interface ToolHandler {
  definition: ToolDefinition;
  execute: ToolExecutor;
  suggestions?: ToolSuggestion[];

  // Policy metadata
  sideEffectLevel: 'read' | 'write' | 'destructive';
  approvalRequired?: boolean;

  // Execution policy
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
  canRunInParallel?: boolean;
  idempotencyKey?: (args: Record<string, unknown>) => string | null;

  // Dependency checks
  prerequisites?: (state: RunState, args: Record<string, unknown>) => CheckResult;
}
```

Tool definitions must be explicit. No hidden behavior.

---

## 4. Orchestration Loop

### Current Flow

```
1. Build system prompt (persona + memory context)
2. Trim conversation to context window budget
3. Attach vision data URIs
4. Send to LLM with streaming
5. On tool_calls finish reason:
   a. Apply guardrails (question suppression, persona forcing, redirect)
   b. Execute each tool via registry
   c. Inject result metadata (startIndex, videoStartIndex)
   d. Add tool results to conversation
   e. Loop back to step 2
6. On text completion: finalize and return
```

### Stop Conditions

| Condition | Action |
|-----------|--------|
| Model returns final text answer | Complete |
| Max tool rounds reached (6) | Send without tools, force text |
| Insufficient credits (both tokens) | Fire callback, break |
| Unrecoverable tool error | Surface to model for explanation |
| Abort signal fired | Cancel all in-flight tools |

### Non-Negotiable Loop Rules

- **Never allow infinite tool-call churn** — max 6 rounds enforced
- **Never trust model-generated IDs** without verification from tool results
- **Never let destructive actions execute silently** — credit checks, persona validation
- **Always validate before execute** — schema + business rules
- **Always feed errors back** — let model retry or explain

---

## 5. Validation Layers

### A. Schema Validation (Registry)
- Required fields present
- Correct types (with safe coercion: string → number/boolean)
- Enums and ranges respected
- Unknown parameters stripped with warnings
- Parse error detection for malformed JSON

### B. Business Rule Validation (Policy Layer)
- Credit pre-flight checks before job submission
- Persona resolution required before image generation
- Image dimensions validated (multiples of 16)
- Model enum validation against registry
- Prompt sanitization (grid/collage pattern stripping)

### C. Safety Validation (Guardrails)
- Content filter state management
- Refusal detection (24+ patterns)
- Abliterated model switching with user confirmation
- SSRF protection on download proxy (domain allowlist)
- Filename sanitization on downloads

### Validation Error Flow

```
Model proposes tool call
  → Schema validation (registry.validateArgs)
    → FAIL: return structured error, allow model retry
  → Business rule validation (handler internals)
    → FAIL: return structured error with guidance
  → Credit validation (preflightCreditCheck)
    → FAIL: try alternate token, or surface insufficient credits
  → Execute tool
```

---

## 6. Error Handling

### Error Categories

| Category | Example | Retryable | Action |
|----------|---------|-----------|--------|
| Schema validation | Missing required field | Yes (model can fix) | Return error to loop |
| Business rule | Invalid dimensions | Yes (model can fix) | Return error with guidance |
| Credit failure | Insufficient balance | Maybe (token switch) | Try alternate, then surface |
| Transient tool failure | API timeout | Yes (with backoff) | Retry per policy |
| Permanent tool failure | Invalid model ID | No | Surface to model |
| Content refusal | Model refuses prompt | User decision | Offer abliterated switch |
| Cancellation | User aborted | No | Clean up, stop loop |

### Structured Result Envelope

Every tool execution should return:

```typescript
interface ToolResultEnvelope {
  success: boolean;
  toolName: string;
  // Result payload
  resultUrls?: string[];
  videoResultUrls?: string[];
  audioResultUrls?: string[];
  // Error details
  error?: string;
  errorCode?: string;
  retryable?: boolean;
  // Metadata
  duration?: number;
  estimatedCost?: number;
  model?: string;
}
```

### Current Implementation

Tool handlers return JSON strings. The registry wraps exceptions in error JSON. Non-JSON results are wrapped as `{ success: true, raw: ... }`. This pattern should be formalized into typed result envelopes.

---

## 7. Credit System / Approval Pattern

### Pre-Execution Credit Flow

```
1. Check balance for estimated cost
2. If insufficient:
   a. Try alternate token type (spark ↔ sogni)
   b. If alternate has balance: switch, notify UI
   c. If both exhausted: fire onInsufficientCredits, abort
3. If sufficient: proceed with execution
4. On execution error (4024): retry with alternate token
```

### Future: Approval Pattern for High-Impact Actions

For tools marked `destructive` or `approvalRequired`:

```typescript
interface ApprovalRequest {
  actionSummary: string;
  toolName: string;
  proposedArgs: Record<string, unknown>;
  reason: string;
  impactScope: string;
  approvalToken: string;
}
```

1. Generate proposed action
2. Pause the run
3. Return approval request to UI
4. Resume only after explicit approval

---

## 8. Concurrency & Execution Policy

### Current Implementation

- **Single active request** per chat session (queued beyond that)
- **Pipeline framework** (`src/tools/shared/pipeline.ts`) for multi-step tool orchestration
- **Concurrent pipeline steps** use `Promise.allSettled()` with signal-isolated contexts
- **Per-job progress tracking** via `perJobProgress[index]`

### Rules

| Scenario | Execution |
|----------|-----------|
| Independent read-only tools | May run in parallel |
| Pipeline steps (sequential) | One at a time |
| Pipeline steps (concurrent) | `Promise.allSettled()` with isolated signals |
| Write operations | Sequential, credit-checked |
| Same tool, same args | Dedupe if idempotent |

### Signal Management

- Each tool execution gets its own `AbortController`
- Concurrent pipeline jobs get signal-isolated contexts via `Object.create()`
- Progress callbacks reset timeout (prevents false timeouts during slow operations)
- Timeout fires only after 5+ minutes of silence

---

## 9. Observability

### Current State

- Console logging with prefix tags: `[CHAT SERVICE]`, `[TOOL REGISTRY]`, `[AUTH]`, etc.
- Tool execution timing via progress callbacks
- Error classification in result JSON

### Target State

| Layer | Implementation |
|-------|---------------|
| Structured logging | Replace console.log with leveled, structured logger |
| Trace IDs | Generate per-run trace ID, propagate through tool calls |
| Tool timeline | Capture start/end/duration per tool execution |
| Step summaries | Log each orchestration loop iteration |
| Error classification | Typed error categories with context |
| Debug mode | Toggle verbose logging without code changes |

### Run Summary Object

```typescript
interface RunSummary {
  traceId: string;
  runStatus: 'completed' | 'approval_needed' | 'error' | 'cancelled' | 'max_steps';
  stepCount: number;
  toolTimeline: ToolTimelineEntry[];
  completedActions: string[];
  pendingActions: string[];
  approvalsNeeded: ApprovalRequest[];
  errorSummary: string | null;
  totalDuration: number;
  tokenUsage: { input: number; output: number };
}
```

---

## 10. Context Window Management

### Budget Allocation

```
Total context = model context length (default 65,536)
Available = Total - MAX_OUTPUT_TOKENS(4096) - SAFETY_MARGIN(2048) - TOOL_SCHEMA_TOKENS(15000)
Vision budget = images × 1300 tokens each
Message budget = Available - Vision budget
```

### Trimming Strategy

- Sliding window: remove oldest messages first
- Protect minimum 2 message groups (user + assistant)
- **Observation masking**: compress old tool results into summaries
- Full conversation preserved in memory for mid-loop persistence
- Result URL indices injected for trimming awareness

---

## 11. Model Instructions Contract

The model must understand:

1. **Tools are the only source of truth** for external data and mutations
2. **Never invent IDs** or assume successful actions without tool confirmation
3. **Ask for missing information** via structured repair or clarification
4. **Use tools incrementally** — don't batch unrelated operations
5. **Stop when enough information is gathered** — don't over-call
6. **Don't repeat failed calls** without meaningful change
7. **Expect approval gates** for high-impact actions
8. **Acknowledge user requests** with brief friendly message alongside tool calls
9. **Never mention tool names** to the user
10. **Maximize concurrency** via `numberOfVariations` and Dynamic Prompts

---

## 12. Non-Negotiable Principles

1. **Do not trust the model** with business logic enforcement
2. **Do not trust model-generated identifiers** without verification
3. **Do not let destructive actions execute silently**
4. **Do not rely only on conversation history** — maintain structured state
5. **Do not hide policy** inside random tool executors
6. **Do not treat all failures the same** — classify and handle differently
7. **Do not build an unobservable black box** — every decision must be traceable
8. **Do not allow infinite tool-call churn** — enforce step limits

---

## 13. Testing Expectations

### A. Happy Path
- Single read-only tool flow (analyze_image)
- Multi-step dependent workflow (resolve_personas → edit_image → animate_photo)
- Successful final answer generation after tool execution

### B. Validation Failures
- Missing required fields → structured error returned
- Invalid enum values → error with allowed values
- Malformed JSON from model → parse error detection
- Business rule rejection (bad dimensions) → guidance in error

### C. Policy / Safety
- Insufficient credits → token switch or popup
- Persona required but not resolved → guardrail forces resolution
- Content refusal → abliterated model offer
- SSRF attempt on download → domain allowlist blocks

### D. Error Handling
- Transient API failure → retry per policy
- Permanent tool failure → surface to model
- Timeout → abort and return error JSON
- Partial success in pipeline → report per-job status

### E. Orchestration Robustness
- Max tool rounds reached → force text response
- Duplicate tool call detection
- State preserved across loop iterations
- Background job routing on session mismatch

### F. Concurrency
- Parallel pipeline steps with isolated signals
- Single active request enforcement
- Credit checks serialized (no double-spend)

---

## 14. File Map

| File | Layer | Purpose |
|------|-------|---------|
| `src/tools/registry.ts` | Registry | Tool registration, validation, dispatch |
| `src/tools/types.ts` | Registry | Type definitions for tools |
| `src/tools/index.ts` | Registry | Import triggers for self-registration |
| `src/services/chatService.ts` | Orchestration | LLM loop, streaming, guardrails |
| `src/hooks/useChat.ts` | Orchestration | React integration, state management |
| `src/config/chat.ts` | Configuration | System prompts, model config, constants |
| `src/services/contextWindow.ts` | Orchestration | Conversation trimming |
| `src/tools/shared/creditCheck.ts` | Policy | Credit validation, token switching |
| `src/tools/shared/pipeline.ts` | Orchestration | Multi-step tool pipelines |
| `src/tools/shared/promptSanitizer.ts` | Policy | Prompt pattern stripping |
| `src/tools/shared/modelRegistry.ts` | Registry | Model-to-tool mapping |
| `src/tools/shared/llmHelpers.ts` | Utility | Timeouts, think block stripping |
| `src/tools/shared/aspectRatio.ts` | Utility | Dimension handling |
| `src/tools/shared/errorClassification.ts` | Policy | Error categorization and classification |
| `src/tools/shared/policyChecks.ts` | Policy | Persona, prerequisite, and question suppression checks |
| `src/tools/shared/sourceImage.ts` | Utility | Image/audio fetching |
| `src/services/tracing.ts` | Observability | RunTracker, trace IDs, tool timeline, run summaries |
| `server/services/sogni.js` | Server | Global SDK client |
| `server/middleware/auth.js` | Server | Session management |
| `server/routes/auth.js` | Server | Auth endpoints |
| `server/routes/download.js` | Server | SSRF-protected download proxy |
| `server/routes/transcode.js` | Server | Image format conversion |

---

## 15. Improvement Roadmap

### Phase 1: Type Safety & Structure
- [x] Add `sideEffectLevel` to all tool registrations
- [x] Formalize `ToolResultEnvelope` type for all tool returns
- [x] Add `retryPolicy` to tool metadata (type defined, per-tool config TBD)
- [x] Add `prerequisites` checks to dependent tools (policy layer created)

### Phase 2: Observability
- [x] Implement structured logging with consistent format
- [x] Add trace IDs to orchestration loop (`RunTracker`)
- [x] Capture tool execution timeline (`ToolTimelineEntry`)
- [x] Add run summary generation (`RunSummary`)
- [ ] Add leveled logger (debug/info/warn/error filtering)

### Phase 3: Resilience
- [ ] Implement retry with exponential backoff for transient failures
- [ ] Add circuit breaker for repeated API failures
- [ ] Implement idempotency keys for write operations
- [ ] Add loop detection (same args, same outcome)

### Phase 4: Policy Enhancement
- [x] Extract business rules into shared policy functions (`policyChecks.ts`)
- [ ] Wire policy functions into chatService orchestration loop
- [ ] Implement approval pattern for destructive actions
- [ ] Add per-user rate limiting
- [ ] Implement credit reservation before execution

---

## Appendix: Current Tool Inventory

| Tool | Side Effect | Timeout | Pipeline |
|------|------------|---------|----------|
| `generate_image` | write | 5min | No |
| `edit_image` | write | 5min | No |
| `restore_photo` | write | 5min | No |
| `apply_style` | write | 5min | No |
| `refine_result` | write | 5min | No |
| `animate_photo` | write | 10min | No |
| `change_angle` | write | 5min | No |
| `generate_video` | write | 10min | No |
| `sound_to_video` | write | 5min | No |
| `video_to_video` | write | 11min | No |
| `generate_music` | write | 11min | No |
| `analyze_image` | read | 5min | No |
| `set_content_filter` | write | 5min | No |
| `extract_metadata` | read | 1min | No |
| `resolve_personas` | read | 5min | No |
| `manage_memory` | write | 5min | No |
| `stitch_video` | write | 10min | Yes |
| `orbit_video` | write | 30min | Yes |
| `dance_montage` | write | 10min | Yes |
