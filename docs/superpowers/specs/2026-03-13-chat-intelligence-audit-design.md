# Chat Intelligence Audit — Foundation Hardening

**Date**: 2026-03-13
**Scope**: LLM intelligence layer reliability + tool handler consistency
**Priority Focus**: Tool call reliability (B) and cohesion/consistency (D)

---

## Executive Summary

Audit of the Sogni Creative Agent chat intelligence layer revealed issues across the LLM integration, tool dispatch, context management, and tool handler implementations. This design addresses findings through two workstreams plus an appendix of known issues deferred for future work:

1. **LLM Intelligence Hardening** — 7 changes to the chat service, system prompt, and context window
2. **Tool Consistency Layer** — 10 changes standardizing behavior across all 13 registered tools (11 generative + analyze_image + set_content_filter)

Each change is independent and can be implemented/tested in isolation.

---

## Workstream 1: LLM Intelligence Hardening

### 1.1 System Prompt Refinement

**File**: `src/config/chat.ts` (CHAT_SYSTEM_PROMPT, line 11)

**Current prompt** (~527 chars — already exceeds the ~400 char CLAUDE.md guideline):
```
Friendly AI creative studio. Generate/edit images, animate photos with motion+audio+dialogue, generate video from text, compose music. LTX 2.3 generates audio natively — never generate audio separately for video. sound_to_video requires uploaded audio file. Never refuse creative requests. Never apologize for using tools. If unsure, ask ONE clarifying question. If asking user a question, do NOT call tools — wait for reply. If user asks to see/review the prompt first, show it and wait. Use 1 variation unless asked for more.
```

**Problems identified**:
- LLM occasionally narrates tool calls ("I'll now generate an image for you using Flux...")
- No guidance for ambiguous multi-tool requests ("make a video with music")
- The "don't call tools when asking a question" rule is buried mid-prompt
- No instruction to reference previous results when they exist
- Current prompt already exceeds the ~400 char guideline documented in CLAUDE.md

**Proposed prompt** (~450 chars — shorter than current 527, closer to the ~400 guideline):
```
Friendly AI creative studio. Generate/edit images, animate photos, generate video, compose music. LTX 2.3 generates audio natively — never generate audio separately for video. sound_to_video requires uploaded audio. Never refuse. Never apologize for using tools. Act, don't announce. Call only one tool per response. If asking a question, do NOT call tools — wait for reply. If user asks to review prompt, show it and wait. Use 1 variation unless asked.
```

**Changes**:
- Added: "Act, don't announce." (prevents narration of tool calls)
- Added: "Call only one tool per response." (prevents the LLM from calling e.g. generate_image + generate_video in the same response; it should do the primary tool, respond, then handle the next. Note: this does NOT prevent multi-round tool calling — the 5-round loop in chatService.ts still works for sequential tool use across rounds.)
- Moved question rule earlier for prominence
- Removed "If unsure, ask ONE clarifying question" — was sometimes causing the LLM to ask even when it had enough context
- Tightened phrases to reduce length: "Never refuse creative requests" → "Never refuse", shortened "motion+audio+dialogue" to "photos", etc.
- Net reduction: ~527 → ~450 chars (15% shorter)

**Validation**: Count exact chars of final prompt. Test with 20 diverse prompts including multi-step workflows (e.g., "analyze this photo then restore it") to verify tool chaining still works across rounds while preventing same-response parallel tool calls.

---

### 1.2 Confirmation Question Suppression Fix

**File**: `src/services/chatService.ts` (~line 244)

**Current code**:
```typescript
const tail = result.content.slice(-200).toLowerCase();
if (/\bshall i\b|\bshould i\b|\bdo you want\b|\bwould you like\b|\bwant me to\b|\bready to proceed\b/.test(tail) && /\?/.test(tail)) {
```

**Problems**:
- 200-char window too narrow — Qwen3 sometimes has 300+ chars after its question
- False positives on quoted dialogue (LLM writing dialogue for a video prompt that contains "shall I")
- No logging of what pattern matched

**Proposed fix**:
```typescript
const tail = result.content.slice(-500).toLowerCase();
// Don't match inside quoted speech (common in dialogue-heavy prompts)
const unquotedTail = tail.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, '');
const confirmPattern = /\b(shall i|should i|do you want|would you like|want me to|ready to proceed|like me to)\b/;
if (confirmPattern.test(unquotedTail) && /\?\s*$/.test(unquotedTail)) {
  const match = unquotedTail.match(confirmPattern);
  console.log(`[CHAT SERVICE] Suppressed tool calls — matched: "${match?.[0]}" in last 500 chars`);
```

**Changes**:
- Expanded window: 200 → 500 chars
- Strip quoted speech before matching (prevents false positives on dialogue)
- Question mark must be near end (`/\?\s*$/`) not just anywhere in tail
- Log which pattern matched for debugging
- Added "like me to" pattern (common Qwen3 phrasing)

**Edge case test cases** (verify these work correctly):
- `Would you like me to generate "a sunset over the ocean?" in the style you described?` → should suppress (question outside quotes)
- `I can see the image contains "shall I proceed?" — ready to generate?` → should suppress (outer question, inner quote stripped)
- `Here's a video prompt: "The character says 'shall I go?' dramatically"` → should NOT suppress (all confirmation words inside quotes)
- `Generated 3 images successfully. The quality looks great!` → should NOT suppress (no question mark at end)

---

### 1.3 Tool Call Argument Validation

**File**: `src/tools/registry.ts` (execute method, line 36)

**Current behavior**: Arguments from `parseChatToolArgs()` are passed directly to handlers with no validation. Hallucinated parameter names pass through silently. Wrong types cause handler crashes (caught by registry try-catch, but the error message is unhelpful).

**Proposed addition** — new method `validateArgs()` on ToolRegistry:

```typescript
private validateArgs(
  definition: ToolDefinition,
  args: Record<string, unknown>
): { valid: true; cleaned: Record<string, unknown> } | { valid: false; error: string } {
  const params = definition.function.parameters;
  if (!params?.properties) return { valid: true, cleaned: args };

  const cleaned: Record<string, unknown> = {};
  const required = new Set(params.required || []);

  // Check required params
  for (const name of required) {
    if (!(name in args) || args[name] === undefined || args[name] === null) {
      return { valid: false, error: `Missing required parameter: ${name}` };
    }
  }

  // Copy known params, strip unknown ones
  for (const [key, value] of Object.entries(args)) {
    if (key in params.properties) {
      const prop = params.properties[key];
      // Type coerce string→number for numeric params
      if (prop.type === 'number' && typeof value === 'string') {
        const num = Number(value);
        if (!isNaN(num)) { cleaned[key] = num; continue; }
      }
      // Type coerce string→boolean
      if (prop.type === 'boolean' && typeof value === 'string') {
        cleaned[key] = value === 'true';
        continue;
      }
      cleaned[key] = value;
    } else {
      console.warn(`[TOOL REGISTRY] Stripping unknown parameter "${key}" from ${definition.function.name}`);
    }
  }

  return { valid: true, cleaned };
}
```

**Integration into execute()**:
```typescript
async execute(name, args, context, callbacks) {
  const handler = this.handlers.get(name);
  if (!handler) { /* existing unknown tool handling */ }

  const validation = this.validateArgs(handler.definition, args);
  if (!validation.valid) {
    console.warn(`[TOOL REGISTRY] Invalid args for "${name}": ${validation.error}`);
    return JSON.stringify({ error: validation.error });
  }

  try {
    return await handler.execute(validation.cleaned, context, callbacks);
  } catch (err) { /* existing error handling */ }
}
```

**Impact**: LLM receives clear error feedback on bad tool calls (e.g., "Missing required parameter: prompt") and can self-correct in the next round. Unknown parameters stripped silently. Type mismatches auto-corrected where safe.

**TypeScript note**: `ToolDefinition` is imported from `@sogni-ai/sogni-client`. The `function.parameters` field may be typed as `Record<string, unknown>` rather than having explicit `.properties` and `.required` fields. The implementation should use type assertions: `const params = definition.function.parameters as { properties?: Record<string, { type?: string }>; required?: string[] };`

**Empty args guard**: `parseChatToolArgs()` in `config/chat.ts` returns `{}` on JSON parse failure. With this validation in place, an empty `{}` will correctly fail validation if any params are `required` (e.g., `prompt`). For tools where no params are required, an empty args object would pass validation and reach the handler — handlers should still guard against undefined values for non-required params they use.

**Coercion logging**: Type coercions (string→number, string→boolean) should be logged at debug level so prompt engineering issues are visible during development: `console.debug(`[TOOL REGISTRY] Coerced "${key}" from string to number for ${name}`);

---

### 1.4 Tool Result Error Detection Hardening

**File**: `src/services/chatService.ts` (~line 280)

**Current code**:
```typescript
try {
  const parsed = JSON.parse(toolResult);
  if (parsed?.error) { /* report error */ }
} catch { /* not JSON, assume success */ }
```

**Problems**:
- Non-JSON results silently treated as success
- No `.success` field verification
- Error callback doesn't include tool name

**Proposed fix**:
```typescript
let parsed: Record<string, unknown> | null = null;
try {
  parsed = JSON.parse(toolResult);
} catch {
  console.warn(`[CHAT SERVICE] Tool "${toolName}" returned non-JSON result — wrapping`);
  parsed = { success: true, raw: toolResult.slice(0, 500) };
}

if (parsed?.error) {
  callbacks.onToolProgress({
    type: 'error',
    toolName,
    error: typeof parsed.error === 'string'
      ? parsed.error
      : parsed.message as string || `${toolName} failed`,
  });
} else if (parsed && !('success' in parsed)) {
  console.warn(`[CHAT SERVICE] Tool "${toolName}" result missing success field`);
}
```

**Changes**:
- Non-JSON results wrapped in `{success: true, raw: ...}` instead of silently ignored
- Error messages include tool name for LLM context
- Warning logged when result lacks `success` field (helps catch handler bugs)
- Raw result truncated to 500 chars to prevent log bloat

---

### 1.5 Context Window Intelligence

**File**: `src/services/contextWindow.ts`

**Problem 1 — Single generic placeholder** (line 85-88):
```typescript
const IMAGE_PLACEHOLDER = {
  role: 'user',
  content: '[Earlier: User uploaded a photo for restoration. Analysis was provided.]'
};
```
This is always the same regardless of what was trimmed. If the user uploaded 3 images and generated 5 results, trimming loses all that context.

**Problem 2 — No tool result summarization**: Full tool result JSON (with URLs, metadata) consumes tokens. When trimmed, all context about what was generated is lost.

**Proposed fix — Dynamic placeholder generation**:

```typescript
function buildTrimmedSummary(trimmedGroups: MessageGroup[]): ChatMessage | null {
  const events: string[] = [];
  let hasUpload = false;
  let toolCalls: string[] = [];

  for (const group of trimmedGroups) {
    for (const msg of group.messages) {
      if (msg.role === 'user' && typeof msg.content === 'string' && msg.content.includes('[Earlier:')) continue;

      // Detect uploads
      if (msg.role === 'user' && (
        Array.isArray(msg.content)
          ? msg.content.some(p => p.type === 'image_url')
          : false
      )) {
        hasUpload = true;
      }

      // Detect tool results (skip errors — only summarize successful tool calls)
      if (msg.role === 'tool' && msg.name) {
        try {
          const parsed = JSON.parse(msg.content);
          if (parsed.error) continue; // Don't include failed tool calls in summary
          const count = parsed.resultCount || parsed.urls?.length || 1;
          toolCalls.push(`${msg.name} (${count} result${count > 1 ? 's' : ''})`);
        } catch {
          toolCalls.push(msg.name);
        }
      }
    }
  }

  if (hasUpload) events.push('User uploaded media for editing');
  if (toolCalls.length > 0) {
    // Deduplicate: "restore_photo (3 results), animate_photo (1 result)"
    events.push(`Tools used: ${[...new Set(toolCalls)].join(', ')}`);
  }

  if (events.length === 0) return null;

  return {
    role: 'user' as const,
    content: `[Earlier conversation summary: ${events.join('. ')}. Details were trimmed to save context.]`,
  };
}
```

**Integration**: The current trimming loop (lines 130-138) iterates trimmable groups and keeps ones that fit within budget. This can create non-contiguous gaps (e.g., group 3 trimmed but groups 1-2 and 4 kept). The `buildTrimmedSummary` function handles this correctly because it iterates all trimmed groups regardless of position. However, to collect trimmed groups, the trimming loop must be modified:

```typescript
// During the trimming loop, collect trimmed groups:
const trimmedGroups: MessageGroup[] = [];
for (const group of trimmable) {
  if (currentTokens + group.tokens <= inputBudget) {
    result.push(...group.messages);
    currentTokens += group.tokens;
  } else {
    trimmedGroups.push(group);
    trimmedCount += group.messages.length;
  }
}

// Replace static IMAGE_PLACEHOLDER insertion with:
const summary = buildTrimmedSummary(trimmedGroups);
if (summary) {
  result.unshift(summary);
  insertedSummary = true;
}
```

**Note on non-contiguous trimming**: The current algorithm can create gaps in conversation (e.g., a large group in the middle is trimmed while smaller groups on either side are kept). This is a pre-existing behavior. A future improvement would be to trim strictly from oldest-first (stop keeping groups after the first one that doesn't fit), but that is a behavioral change beyond this spec's scope.

**Impact**: LLM retains awareness of what tools were used and how many results exist, even after trimming. Prevents "what did we do earlier?" confusion.

---

### 1.6 Stream Finalization Robustness

**File**: `src/services/chatService.ts` (~line 228)

**Current behavior**: If `stream.finalResult` is null, breaks with "No response from the AI assistant".

**Proposed fix**:

Declare `let streamNullRetries = 0;` outside the while loop (same scope as `toolRound`), as a total budget across all rounds:

```typescript
// Declared at the same level as toolRound, OUTSIDE the while loop
let streamNullRetries = 0;

// Inside the while loop, after streaming completes:
const result = stream.finalResult;
if (!result) {
  if (streamNullRetries < 1) {
    streamNullRetries++;
    console.warn(`[CHAT SERVICE] Null stream result on round ${toolRound}, retrying (attempt ${streamNullRetries})...`);
    // Don't decrement toolRound — just continue to re-attempt this round.
    // The conversation messages haven't changed, so the LLM gets the same context.
    continue;
  }
  console.error(`[CHAT SERVICE] Null stream result after retry — round: ${toolRound}, msgs: ${updatedMessages.length}`);
  callbacks.onComplete(
    "I wasn't able to complete that response. Could you try rephrasing your request?"
  );
  break;
}
```

**Changes**:
- `streamNullRetries` declared outside while loop as a total budget (not per-round) — one retry total across the entire tool-calling loop, not one per round
- Does NOT decrement `toolRound` — the `continue` re-enters the loop which will re-attempt the same round since messages haven't changed. The `toolRound` counter stays accurate for the MAX_TOOL_ROUNDS check.
- Better error message on persistent failure (actionable for user)
- Diagnostic logging with round number and conversation size

---

### 1.7 Tool Execution Safety Timeout

**File**: `src/tools/registry.ts` (execute method)

**Current behavior**: No timeout — if a tool handler hangs, the chat spins forever.

**Proposed addition**:
```typescript
private static readonly DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes

// Per-tool timeout overrides (tools with their own internal timeouts get longer leash)
private static readonly TIMEOUT_OVERRIDES: Partial<Record<string, number>> = {
  generate_music: 660_000,    // 11 min safety net (handler's own 10-min timeout fires first)
  video_to_video: 660_000,    // 11 min
  generate_video: 300_000,    // 5 min (has its own 4-min activity timeout)
  animate_photo: 300_000,     // 5 min
};

async execute(name, args, context, callbacks): Promise<string> {
  // ... validation ...

  const timeoutMs = ToolRegistry.TIMEOUT_OVERRIDES[name] ?? ToolRegistry.DEFAULT_TIMEOUT_MS;

  // Wrap the caller's signal (if any) with a timeout-aware AbortController.
  // When the timeout fires, we abort the signal so handlers can clean up
  // (clear intervals, remove event listeners, cancel SDK jobs).
  const timeoutController = new AbortController();
  const originalSignal = context.signal;
  // If the original signal is already aborted, propagate immediately
  if (originalSignal?.aborted) timeoutController.abort();
  else originalSignal?.addEventListener('abort', () => timeoutController.abort(), { once: true });

  const timeoutId = setTimeout(() => {
    console.warn(`[TOOL REGISTRY] Timeout: "${name}" exceeded ${timeoutMs / 1000}s — aborting`);
    timeoutController.abort();
  }, timeoutMs);

  // Pass the timeout-aware signal to the handler
  const timeoutContext = { ...context, signal: timeoutController.signal };

  try {
    const result = await handler.execute(validation.cleaned, timeoutContext, callbacks);
    clearTimeout(timeoutId);
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);

    // Distinguish timeout from other errors
    if (timeoutController.signal.aborted && !originalSignal?.aborted) {
      console.error(`[TOOL REGISTRY] "${name}" timed out after ${timeoutMs / 1000}s`);
      return JSON.stringify({ error: `${name} timed out. The operation took too long — try a simpler prompt or smaller output.` });
    }

    console.error(`[TOOL REGISTRY] Error executing "${name}":`, message);
    return JSON.stringify({ error: message });
  }
}
```

**Impact**: Safety net for hung SDK jobs. When the timeout fires, it aborts the signal so handlers can run their cleanup logic (clearing intervals, removing SDK event listeners, cancelling in-flight jobs). Tools with their own internal timeouts (generate_video's activity timeout, generate_music's 10-min timeout) will typically fire first. The registry timeout catches cases where internal timeouts fail.

**Handler cleanup requirement**: All handlers that set up intervals or event listeners MUST clean up in response to `signal.abort`. Most already do this (e.g., generate_video's `abortHandler` at line ~380). Handlers that don't yet listen for abort should be updated in Phase 4 (handler updates) to add `signal.addEventListener('abort', cleanup)` alongside their existing cleanup patterns.

---

## Workstream 2: Tool Consistency Layer

### 2.1 Standardized Error Handling Pattern

**Problem**: Each tool implements error handling differently. Some catch specific errors, some have broad catches, some let exceptions propagate to the registry. Error messages vary in quality from excellent ("No audio file uploaded. Tell user to upload an audio file.") to generic ("All jobs failed").

**Proposed standard pattern** — every handler should follow:

```typescript
export async function execute(args, context, callbacks): Promise<string> {
  // 1. Parse & validate args
  const prompt = args.prompt as string;
  // ...

  // 2. Estimate cost
  const originalTokenType = context.tokenType;
  let estimatedCost: number;
  try {
    estimatedCost = await fetchCostEstimate(context.sogniClient, context.tokenType, ...);
  } catch (err) {
    // Cost estimation failure may indicate model unavailability.
    // For generate_image, this returns model_unavailable error (preferred).
    // For other tools, proceed with 0 cost — the actual SDK call will fail
    // if the model is truly down, giving a more specific error.
    estimatedCost = 0;
  }

  // 3. Preflight credit check
  // Note: preflightCreditCheck returns { ok: true } | { ok: false; errorJson: string }.
  // It does NOT return a tokenSwitched field. It mutates context.tokenType directly
  // if it switches tokens. Compare against originalTokenType to detect a switch.
  const preflight = preflightCreditCheck(context, estimatedCost);
  if (!preflight.ok) return preflight.errorJson;

  // 4. Re-estimate if token was switched during preflight
  if (context.tokenType !== originalTokenType) {
    try {
      estimatedCost = await fetchCostEstimate(context.sogniClient, context.tokenType, ...);
    } catch { /* keep previous estimate */ }
  }

  // 5. Register billing
  const billingId = estimatedCost > 0 ? registerPendingCost(toolName, estimatedCost, context.tokenType) : null;

  // 6. Signal start
  callbacks.onToolProgress({ type: 'started', toolName, totalCount, estimatedCost });

  try {
    // 7. Execute with token fallback
    const results = await tryWithTokenFallback(operation, context, estimatedCost);

    // 8. Record completion
    if (billingId) void recordCompletion(billingId);

    // 9. Signal complete
    callbacks.onToolComplete(toolName, imageUrls, videoUrls);

    // 10. Return success JSON
    return JSON.stringify({ success: true, resultCount: results.length, ... });

  } catch (err) {
    // 11. Discard pending billing
    if (billingId) discardPending(billingId);

    // 12. Handle specific error types
    if (isInsufficientCreditsError(err)) {
      callbacks.onInsufficientCredits?.();
      return JSON.stringify({ error: 'insufficient_credits', message: 'Not enough credits.' });
    }

    // NSFW detection (for image/video tools)
    if (err instanceof Error && (err as any).isNSFW) {
      return JSON.stringify({
        error: 'nsfw_filtered',
        message: 'Content blocked by Safe Content Filter. Ask user if they want to disable it, then call set_content_filter with enabled=false and retry.',
      });
    }

    // 13. Generic error with tool context
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${TOOL_NAME}] Execution failed:`, message);
    return JSON.stringify({ error: `${toolName} failed`, message });
  }
}
```

**Files to update**: All 11 tool handlers to align with this pattern. Most are close already — the main gaps are:
- `edit_image`: Missing NSFW handling (no detection of isNSFW flag or sensitiveContent errors)
- `refine_result`: Returns generic `fetch_failed` error on missing source — should use the standard `toolError()` helper with a user-friendly message

Note: `sound_to_video` and `video_to_video` already properly call `discardPending(billingId)` in their catch blocks — no change needed there.

---

### 2.2 Consistent Progress Reporting

**Problem**: Progress reporting varies significantly across tools:

| Tool | ETA Reported | Step Labels | Per-Job Tracking |
|------|:---:|:---:|:---:|
| restore_photo | Sometimes (SDK provides) | No | Yes |
| apply_style | Sometimes | No | Yes |
| refine_result | Sometimes | No | Yes |
| animate_photo | Yes | Yes ("Analyzing image", "Crafting prompt", "Starting generation") | Yes |
| change_angle | Yes | No | Yes |
| generate_image | No | No | Yes (jobId→index map) |
| edit_image | No | No | Yes |
| generate_video | Yes | Yes ("Starting generation") | Yes |
| sound_to_video | No | No | No (single-job) |
| video_to_video | No | No | Yes |
| generate_music | No | No | No (single-job) |

**Proposed standard**: All tools MUST report:

1. **`type: 'started'`** — with `totalCount`, `estimatedCost`, and `sourceImageUrl` (if applicable)
2. **`type: 'progress'`** — with `progress` (0-1 normalized), `jobIndex`, and `etaSeconds` when available from SDK
3. **`type: 'completed'`** — with `resultUrls` or `videoResultUrls`, `completedCount`, `totalCount`
4. **`stepLabel`** — required for multi-phase tools (animate_photo, generate_video). Other tools may omit.

**Normalization rule**: Progress values from SDK must be normalized to 0-1 range before passing to callbacks. Current code sometimes passes 0-100 values through.

**Implementation**: Add a shared helper:

```typescript
// src/tools/shared/progressHelper.ts
export function normalizeProgress(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return value > 1 ? value / 100 : value;
}

export function buildStartedProgress(
  toolName: ToolName,
  totalCount: number,
  estimatedCost: number,
  opts?: { sourceImageUrl?: string; modelName?: string }
): ToolExecutionProgress {
  return {
    type: 'started',
    toolName,
    totalCount,
    estimatedCost,
    progress: 0,
    completedCount: 0,
    ...opts,
  };
}
```

---

### 2.3 Unified Timeout Strategy

**Problem**: Each tool picks its own timeout strategy and duration:

| Tool | Strategy | Duration |
|------|----------|----------|
| restore_photo | Fixed (SDK internal) | ~5 min |
| generate_image | Fixed | 5 min |
| generate_video | Activity-based | 4 min idle |
| generate_music | Fixed | 10 min |
| sound_to_video | Fixed | 3 min |
| video_to_video | Fixed | 10 min |
| animate_photo | None (relies on SDK) | N/A |

**Proposed standard**:

| Category | Strategy | Duration | Rationale |
|----------|----------|----------|-----------|
| Image tools | Fixed | 5 min | Quick operations, fixed timeout appropriate |
| Video tools | Activity-based | 4 min idle, 10 min hard cap | Video jobs can legitimately take time but shouldn't hang silently |
| Music tools | Fixed | 10 min (current) | Duration up to 600s; 10-min timeout matches current handler |

**Activity-based timeout** should be extracted to a shared utility:

```typescript
// src/tools/shared/activityTimeout.ts
export function createActivityTimeout(opts: {
  inactivityMs: number;       // e.g., 240_000 (4 min)
  hardCapMs: number;          // e.g., 600_000 (10 min)
  onTimeout: (hasPartialResults: boolean) => void;  // true if some jobs completed before timeout
  checkIntervalMs?: number;   // default 30_000
}): {
  markActivity: () => void;
  cleanup: () => void;
} {
  let lastActivity = Date.now();
  const startTime = Date.now();

  const interval = setInterval(() => {
    const now = Date.now();
    const idle = now - lastActivity;
    const elapsed = now - startTime;

    if (idle >= opts.inactivityMs || elapsed >= opts.hardCapMs) {
      opts.onTimeout(false); // Caller determines partial status from their own result tracking
      cleanup();
    }
  }, opts.checkIntervalMs ?? 30_000);

  const cleanup = () => clearInterval(interval);
  const markActivity = () => { lastActivity = Date.now(); };

  return { markActivity, cleanup };
}
```

**Adoption plan**:
- `generate_video`: Refactor to use shared utility (already close). **Critical**: the current handler has NO hard cap — only a 4-min inactivity timeout. If the SDK sends a progress event every 3 minutes, the job runs indefinitely. Adding a 10-min hard cap via the shared utility fixes this.
- `animate_photo`: Add activity-based timeout (currently has none)
- `video_to_video`: Switch from fixed 10-min to activity-based with 10-min hard cap
- `sound_to_video`: Switch from fixed 3-min to activity-based with 5-min hard cap. **Tradeoff note**: The current 3-min fixed timeout was likely chosen for S2V's typical completion time. Activity-based means a progress event at 2:59 resets the inactivity timer, potentially extending total wait. The 5-min hard cap ensures a ceiling. If S2V jobs rarely take >3 min in practice, consider keeping the 3-min hard cap instead.
- Image tools: Keep fixed timeouts (operations are quick)
- `generate_music`: Keep fixed 10-min (single-job, progress updates are sparse; matches current handler)

---

### 2.4 NSFW Handling Across All Media Tools

**Problem**: Only `generate_image` has comprehensive NSFW detection. Other tools that produce visual content (`edit_image`, `animate_photo`, `generate_video`, `video_to_video`, `sound_to_video`) pass through `disableNSFWFilter` but don't handle NSFW rejections from the SDK.

**Current state**:
- `generate_image`: Full detection (isNSFW flag + sensitiveContent error code + nsfwCount tracking)
- `edit_image`: No NSFW handling
- Video tools: `disableNSFWFilter` param passed but no detection on response

**Proposed fix**: Extract NSFW detection to shared utility:

```typescript
// src/tools/shared/nsfwDetection.ts
export function isNSFWError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;
    if (obj.originalCode === 'sensitiveContent') return true;
    if (typeof obj.message === 'string' && obj.message.toLowerCase().includes('sensitive content')) return true;
  }
  if (typeof err === 'string' && err.toLowerCase().includes('sensitive content')) return true;
  if (err instanceof Error && (err as any).isNSFW) return true;
  return false;
}

export function isNSFWEvent(event: Record<string, unknown>): boolean {
  return !!(event.isNSFW);
}

export const NSFW_ERROR_RESPONSE = JSON.stringify({
  error: 'nsfw_filtered',
  message: 'Content was blocked by the Safe Content Filter. Ask the user if they would like to disable it, then call set_content_filter with enabled=false and retry.',
});
```

**Adoption**: Add NSFW detection to:
- `edit_image/handler.ts` — check both error events and completed events (image SDK, same as generate_image)
- `animate_photo/handler.ts` — check video completion events
- `generate_video/handler.ts` — check video completion events
- `video_to_video/handler.ts` — check video completion events
- `sound_to_video/handler.ts` — check video completion events

**SDK verification required**: The `isNSFW` flag is confirmed on image job completion events. For video jobs, verify with the Sogni SDK that video completion events also emit `isNSFW` or `sensitiveContent` error codes. If the SDK does not emit these for video jobs, NSFW detection for video tools should rely on error code/message matching via `isNSFWError()` only (not `isNSFWEvent()`).

---

### 2.5 Quality Tier Standardization

**Problem**: Quality control is inconsistent:
- `restore_photo`: Has `quality` param ('fast' | 'hq') — affects cost and step count
- `refine_result`: Always uses 'fast' — no user choice
- `apply_style`: Always uses 'fast' — no user choice
- `change_angle`: Uses QUALITY_PRESETS config
- `generate_image`: Model selection serves as implicit quality control
- Video tools: Model-specific, no unified quality concept

**Proposed standard**: Respect `context.qualityTier` consistently:

- `refine_result`: Honor `context.qualityTier` (currently hardcoded to 'fast'). Change line 59:
  ```typescript
  // Before:
  const estimatedCost = await fetchRestorationCostEstimate(..., 'fast');
  // After:
  const qualityTier = context.qualityTier || 'fast';
  const estimatedCost = await fetchRestorationCostEstimate(..., qualityTier);
  ```
  Also pass `qualityTier` through to the `restorePhoto()` SDK call params object (currently on lines 84-93 of `refine_result/handler.ts`, which omits `qualityTier` — add it alongside the other params).

- `apply_style`: Same fix — honor `context.qualityTier` instead of hardcoding. Verify that the style transfer SDK function accepts a quality parameter before adding it — if it doesn't, this change is cost-estimation only.

- Video tools: Quality is already controlled by model selection and resolution params. No change needed.

- `generate_image`: Quality controlled via model selection. No change needed.

**Impact**: When user selects HQ mode in the UI, refinement and style transfer operations also produce HQ results. Currently only the initial restore respects the quality toggle.

---

### 2.6 Consistent Source Image Fallback Strategy

**Problem**: Tools that need a source image handle missing/failed fetches differently:
- `apply_style`: Falls back to original upload if fetch fails
- `animate_photo`: Falls back to original upload if fetch fails
- `refine_result`: Returns error immediately on fetch failure — no fallback
- `edit_image`: Deduplicates with Set but no fallback

**Proposed standard**: All tools that operate on previous results should:
1. Attempt to fetch the specified result URL
2. On failure, attempt to use the original uploaded image (if the operation makes sense on original)
3. On failure of both, return a clear error: `{"error": "Could not load source image. The result may have expired — try generating a new one."}`

**Implementation**: Add to `src/tools/shared/sourceImage.ts`:

```typescript
export async function fetchSourceImageWithFallback(
  resultUrls: string[],
  sourceIndex: number,
  originalImageData: Uint8Array | null,
  originalWidth: number,
  originalHeight: number,
): Promise<{ data: Uint8Array; width: number; height: number } | { error: string }> {
  // Try result URL first
  if (sourceIndex >= 0 && sourceIndex < resultUrls.length) {
    try {
      return await fetchImageAsUint8Array(resultUrls[sourceIndex]);
    } catch (err) {
      console.warn(`[SOURCE IMAGE] Failed to fetch result ${sourceIndex}, trying original:`, err);
    }
  }

  // Fallback to original upload
  if (originalImageData) {
    return { data: originalImageData, width: originalWidth, height: originalHeight };
  }

  return { error: 'Could not load source image. The result may have expired — try generating a new one.' };
}
```

**Adoption**: Use in `refine_result`, `apply_style`, `animate_photo`, `change_angle`.

---

### 2.7 Gallery Integration for All Video Tools

**Problem**: Only `animate_photo` saves to gallery (fire-and-forget with `saveVideoToGallery()`). Other video-producing tools (`generate_video`, `sound_to_video`, `video_to_video`) don't save to gallery at all.

**Proposed fix**: Extract gallery save to shared utility and use in all video tools:

```typescript
// src/tools/shared/gallerySave.ts
export function createGallerySaver(callbacks: ToolCallbacks) {
  const savedUrls = new Set<string>();

  return {
    saveVideo: (opts: {
      videoUrl: string;
      sourceImageBlob?: Blob;
      sourceWidth?: number;
      sourceHeight?: number;
      prompt: string;
      duration?: number;
    }) => {
      if (savedUrls.has(opts.videoUrl)) return;
      savedUrls.add(opts.videoUrl);

      saveVideoToGallery(opts)
        .then(({ galleryImageId }) => {
          callbacks.onGallerySaved?.([], [galleryImageId]);
        })
        .catch(err => {
          console.error('[GALLERY] Failed to save video:', err);
        });
    },
    hasSaved: (url: string) => savedUrls.has(url),
  };
}
```

**Import**: `saveVideoToGallery` is imported from `@/services/galleryService` (see `animate_photo/handler.ts` line 37). The shared utility should re-export it through `shared/index.ts` for consistency, so handlers import from `../shared` rather than reaching into services directly.

**Adoption**: Add to `generate_video`, `sound_to_video`, `video_to_video` handlers — call `saver.saveVideo()` on each completed video URL.

---

### 2.8 Transient Error Retry for All SDK Tools

**Problem**: Only `animate_photo` handles the "worker disconnected" transient error with a retry. All other tools that call SDK functions can hit the same transient error and will fail permanently.

**Proposed fix**: Extract retry logic to shared utility:

```typescript
// src/tools/shared/retryHelper.ts
const TRANSIENT_PATTERNS = ['worker disconnected', 'workerdisconnected', 'connection reset'];

export function isTransientError(err: unknown): boolean {
  const msg = ((err instanceof Error ? err.message : String(err)) || '').toLowerCase();
  return TRANSIENT_PATTERNS.some(p => msg.includes(p));
}

export async function withTransientRetry<T>(
  operation: () => Promise<T>,
  opts: {
    maxRetries?: number;    // default 1
    signal?: AbortSignal;
    onRetry?: () => void;   // Reset state before retry
    toolName: string;
  }
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 1;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && isTransientError(err) && !isInsufficientCreditsError(err)) {
        if (opts.signal?.aborted) throw err;
        console.warn(`[${opts.toolName}] Transient error, retry ${attempt + 1}/${maxRetries}:`, (err as Error).message);
        opts.onRetry?.();
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
```

**Adoption**: Wrap the `tryWithTokenFallback()` call in all tool handlers:
```typescript
const results = await withTransientRetry(
  () => tryWithTokenFallback(operation, context, estimatedCost),
  { toolName: 'generate_video', signal: context.signal, onRetry: resetState }
);
```

**Retry nesting note**: This creates a 2-deep retry stack: `withTransientRetry` (retries on worker disconnection) wraps `tryWithTokenFallback` (retries on insufficient credits with alternate token). Worst case for a single user action: attempt 1 (spark, transient fail) → retry (spark, insufficient credits) → fallback (sogni, success) = 3 SDK calls. This is acceptable and each layer handles a distinct failure mode.

---

### 2.9 Standardized Tool Result Shape

**Problem**: Tools return inconsistent JSON shapes:
- `restore_photo`: `{success, resultCount, creditsCost, message}`
- `generate_image`: `{success, resultCount, creditsCost, message}`
- `animate_photo`: `{success, resultCount, creditsCost, message, videoUrls}`
- `generate_music`: `{success, resultCount, creditsCost, audioUrls, message}`
- `analyze_image`: `{success, analysis}` (no creditsCost)
- `set_content_filter`: `{success, contentFilter, message}`

The LLM sees all these different shapes and has to interpret them. Standardizing helps the LLM generate more consistent post-tool responses.

**Proposed standard result shape**:
```typescript
// For generative tools (restore_photo, generate_image, animate_photo, etc.)
interface ToolSuccessResult {
  success: true;
  tool: ToolName;
  resultCount?: number;       // Optional — omit for non-generative tools (analyze_image, set_content_filter)
  creditsCost?: string;       // Optional — omit for free operations (analyze_image)
  message: string;            // Human-readable summary for LLM
}

// For non-generative tools
// analyze_image: { success: true, tool: 'analyze_image', message: '...', analysis: '...' }
// set_content_filter: { success: true, tool: 'set_content_filter', message: '...', safeContentFilter: boolean }

interface ToolErrorResult {
  error: string;             // Error type key (e.g. 'nsfw_filtered', 'insufficient_credits')
  tool: ToolName;
  message: string;           // Human-readable error for LLM
}
```

**Key change**: Always include `tool` field so the LLM knows which tool produced the result without relying on message ordering. This is especially important when context window trimming moves messages around.

**Implementation**: Add helpers to `src/tools/shared/resultHelpers.ts`:
```typescript
// For generative tools — extra param preserves tool-specific metadata the LLM uses
// (e.g., generate_music returns bpm, keyscale, duration, hasLyrics;
//  generate_video returns model, duration, mediaType;
//  video_to_video returns controlMode; etc.)
export function toolSuccess(
  tool: ToolName,
  resultCount: number,
  creditsCost: string,
  message: string,
  extra?: Record<string, unknown>,
): string {
  return JSON.stringify({ success: true, tool, resultCount, creditsCost, message, ...extra });
}

// For non-generative tools (analyze_image, set_content_filter)
export function toolInfoSuccess(
  tool: ToolName,
  message: string,
  extra?: Record<string, unknown>,
): string {
  return JSON.stringify({ success: true, tool, message, ...extra });
}

// For all error cases
export function toolError(tool: ToolName, error: string, message: string): string {
  return JSON.stringify({ error, tool, message });
}
```

**Important**: The `extra` param on `toolSuccess` ensures no structured metadata is lost during standardization. Handlers that currently return tool-specific fields (e.g., `generate_music`'s `{bpm, keyscale, duration, hasLyrics, model}`) must pass those via `extra`. The `message` field should also contain this info as human-readable text (it already does in most handlers), but the structured `extra` fields give the LLM reliable data to reference.

Update all handlers to use these helpers instead of manual JSON.stringify.

---

### 2.10 Prompt Refinement Consistency for Video Tools

**Problem**: Only `animate_photo` and `generate_video` (LTX only) use thinking-mode prompt refinement via `refineVideoPrompt()`. Other video tools (`sound_to_video`, `video_to_video`) get raw user prompts, which are often too vague for good results.

**Current state**:
- `animate_photo`: Vision analysis → `needsCreativeRefinement()` check → `refineVideoPrompt()` if needed
- `generate_video`: `needsCreativeRefinement()` check → `refineVideoPrompt()` if needed (LTX models only)
- `sound_to_video`: No refinement
- `video_to_video`: No refinement

**Proposed fix**:
- `sound_to_video`: Add prompt refinement for the visual description. The audio is user-provided, but the video prompt describing visuals benefits from expansion. Call `refineVideoPrompt()` when `needsCreativeRefinement()` is true.
- `video_to_video`: Add prompt refinement. ControlNet transformations benefit from detailed style/scene descriptions. Call `refineVideoPrompt()` when `needsCreativeRefinement()` is true.

**Step labels**: Both tools should report `stepLabel: 'Crafting detailed prompt'` during refinement (matching animate_photo's pattern).

**Guard**: Skip refinement if `context.signal?.aborted` to avoid wasted LLM calls on cancelled operations.

---

## Change Impact Summary

| Change | Files Modified | Risk | Independence |
|--------|---------------|------|:---:|
| 1.1 System prompt | `config/chat.ts` | Low — text change only | Yes |
| 1.2 Confirmation suppression | `chatService.ts` | Low — regex improvement | Yes |
| 1.3 Arg validation | `registry.ts` | Medium — new validation layer | Yes |
| 1.4 Error detection | `chatService.ts` | Low — additional checks | Yes |
| 1.5 Context window | `contextWindow.ts` | Medium — new summary logic | Yes |
| 1.6 Stream robustness | `chatService.ts` | Low — retry + better error | Yes |
| 1.7 Safety timeout | `registry.ts` | Low — safety net, doesn't change happy path | Yes |
| 2.1 Error pattern | All handlers | Medium — many files, pattern change | Yes |
| 2.2 Progress reporting | All handlers + new shared util | Medium — many files | Yes |
| 2.3 Timeout strategy | Video handlers + new shared util | Medium — behavioral change | Yes |
| 2.4 NSFW handling | 5 handlers + new shared util | Low — additive | Yes |
| 2.5 Quality tiers | `refine_result`, `apply_style` | Low — small change | Yes |
| 2.6 Source image fallback | 4 handlers + shared util | Low — additive fallback | Yes |
| 2.7 Gallery integration | 3 video handlers + new shared util | Low — additive | Yes |
| 2.8 Transient retry | All handlers + new shared util | Low — additive safety | Yes |
| 2.9 Result shape | All handlers + new shared util | Medium — many files | Yes |
| 2.10 Prompt refinement | `sound_to_video`, `video_to_video` | Low — additive | Yes |

## Implementation Order (Recommended)

**Phase 1 — Core intelligence** (changes that affect every user interaction):
1. 1.1 System prompt refinement
2. 1.2 Confirmation suppression fix
3. 1.4 Tool result error detection
4. 1.6 Stream finalization robustness

**Phase 2 — New shared utilities** (foundation for handler changes):
5. 2.2 Progress helper (`shared/progressHelper.ts`)
6. 2.4 NSFW detection (`shared/nsfwDetection.ts`)
7. 2.3 Activity timeout (`shared/activityTimeout.ts`)
8. 2.8 Transient retry (`shared/retryHelper.ts`)
9. 2.6 Source image fallback (extend `shared/sourceImage.ts`)
10. 2.9 Result shape helpers (`shared/resultHelpers.ts`)
11. 2.7 Gallery saver (`shared/gallerySave.ts`)

**Phase 3 — Registry hardening**:
12. 1.3 Argument validation
13. 1.7 Safety timeout

**Phase 4 — Handler updates** (apply new shared utils to each handler):
14. 2.1 + 2.2 + 2.4 + 2.5 + 2.8 + 2.9 across all 13 registered tools
15. 2.6 Source fallback in applicable handlers
16. 2.7 Gallery save in video handlers
17. 2.10 Prompt refinement in sound_to_video, video_to_video

**Phase 5 — Context window** (can be done independently, but note: `buildTrimmedSummary` uses the `MessageGroup` type which is currently private to `contextWindow.ts` — co-locate the function in the same file):
18. 1.5 Dynamic placeholder generation

---

## Testing Strategy

Each change should be validated with:

1. **System prompt changes**: Test 20 diverse prompts (simple image, complex video with dialogue, ambiguous multi-tool, edge cases like "make me something cool") — verify tool call rate doesn't regress, narration eliminated
2. **Confirmation suppression**: Test with prompts that include quoted dialogue containing trigger words
3. **Argument validation**: Test with malformed args (missing required, wrong types, extra params)
4. **Error detection**: Test with tools that return non-JSON, tools that fail, tools that timeout
5. **Context window**: Test with conversations exceeding 65k tokens — verify summaries are accurate
6. **Timeout**: Test with artificially slow operations — verify timeout fires and error propagates
7. **NSFW**: Test with content that triggers safe filter across all media tools
8. **Retry**: Test by simulating transient SDK disconnections
9. **Gallery**: Verify video saves appear in gallery for all video-producing tools
10. **Quality**: Verify HQ mode affects refine_result and apply_style operations

---

## Appendix: Known Issues Deferred for Future Work

Issues identified during the audit that are real but outside the scope of this foundation-hardening pass. These should be addressed in subsequent work.

### A. Chat Hook & Session Management (useChat.ts)

**A1. Queued requests can execute in wrong session context** — severity: HIGH
`MAX_CONCURRENT_REQUESTS = 2` queues excess requests. The queued closures capture conversation state from the original session. If the user switches sessions before the queue drains, `loadFromSession` clears the queue (line 957), but if a background job completes and triggers `dequeue` (line 805-806), the stale closure runs within the new session's state, potentially corrupting conversation history. Fix: queue should store session ID and skip execution if session has changed.

**A2. cancelToolExecution does not abort the LLM stream** — severity: MEDIUM
`cancelToolExecution` (lines 821-839) aborts tool AbortControllers and sets `abortRef.current.aborted = true`, but the `sogniClient.chat.completions.create()` stream in chatService.ts has no abort mechanism. The `for await (const chunk of stream)` loop continues consuming tokens and credits until the response completes. Fix: pass AbortSignal to the chat completions API if supported, or break the for-await loop when `aborted` flag is set.

**A3. Vision images re-attached on every tool round** — severity: LOW
On each iteration of the tool-calling loop, vision data URIs are re-attached to the last user message (chatService.ts lines 181-198). After round 2+, the same base64 images are re-serialized and sent. For multi-image conversations this adds unnecessary token cost. Fix: only attach vision data on the first round, or track whether they've changed.

### B. LLM Sub-Call Efficiency

**B1. refineVideoPrompt has no abort check** — severity: MEDIUM
Neither `animate_photo` nor `generate_video` check `context.signal?.aborted` before calling `refineVideoPrompt()`. If a user cancels during the "Crafting detailed prompt" phase, the LLM sub-call runs to completion, consuming credits. The function also doesn't accept an AbortSignal. Fix: add abort guard before calling, and pass signal to the chat completions call if SDK supports it.

**B2. withTimeout silently falls back on timeout** — severity: LOW
`withTimeout()` in llmHelpers.ts returns `undefined` on timeout. Callers use `?? ''` or `?? prompt` to fall back silently. The user gets worse results (unrefined prompt) with no indication that refinement failed. Fix: log a warning and optionally update the stepLabel to indicate fallback.

**B3. refineVideoPrompt max_tokens is 8192** — severity: LOW
A 15-second video prompt does not need 8,192 tokens of output. This wastes credits on overly verbose refinements. Fix: reduce to 2048 or 4096.

### C. Context & Token Estimation

**C1. TOOL_SCHEMA_TOKENS is a static underestimate** — severity: MEDIUM
`TOOL_SCHEMA_TOKENS = 2_500` (config/chat.ts line 116) does not scale with the number of registered tools. With 13 tools and detailed parameter descriptions (some 200+ words), the actual schema token count is likely 4,000-6,000. This means the context budget calculation is too generous, potentially causing the LLM to hit token limits. Fix: compute dynamically from `JSON.stringify(toolRegistry.getDefinitions()).length / CHARS_PER_TOKEN`.

**C2. parseChatToolArgs returns `{}` on malformed JSON** — severity: HIGH
When the LLM produces truncated or malformed JSON for tool arguments, `parseChatToolArgs()` (config/chat.ts lines 121-128) returns `{}`. Without Section 1.3's validation, this empty object passes through to handlers where `args.prompt as string` is `undefined`, causing TypeErrors. Section 1.3 fixes this for `required` params, but the function itself should also be hardened to return a more explicit failure signal.

**C3. Context window trimming creates non-contiguous gaps** — severity: MEDIUM
The trimming algorithm (contextWindow.ts lines 130-138) keeps groups that fit within budget, skipping oversized ones. This can create conversation gaps where middle messages are trimmed but surrounding ones are kept. The LLM sees a jump in context without explanation. Section 1.5 partially addresses this with summaries but a future improvement should trim strictly oldest-first.

### D. UX & Tool Definition Issues

**D1. WELCOME_MESSAGE assumes image upload** — severity: MEDIUM
The static `WELCOME_MESSAGE` in useChat.ts (lines 109-115) says "I can see your photo!" but is shown for all new sessions, including text-only ones (generate image, create video, compose music). Fix: make the welcome message conditional on whether files are uploaded.

**D2. edit_image name contradicts its description** — severity: MEDIUM
The `edit_image` tool definition says "does NOT directly edit a single image" and directs users to restore_photo/refine_result. But the tool is named `edit_image`, which is what users naturally ask for. This creates semantic confusion in the LLM's tool selection. Fix: either rename the tool or revise the description to be less confusing.

**D3. generate_image model selection is too complex** — severity: LOW
The model enum has 7 options with a 161-word description embedding NSFW routing logic. This complexity increases LLM hallucination risk. Fix: simplify the parameter description or use the system prompt to provide model selection guidance.

**D4. sound_to_video audioSourceIndex is required but easily omitted** — severity: LOW
`audioSourceIndex` is in the `required` array but the LLM may omit it when only one audio file exists. Section 1.3's validation would reject this. Fix: either make it optional with default 0, or reinforce the requirement in the description.

**D5. Only the latest result image is visible to the LLM for vision** — severity: LOW
`prepareVisionDataUris` (chatService.ts line 68-69) only takes `resultUrls[resultUrls.length - 1]`. If a user generated 4 variations and says "I like the second one", the LLM cannot see it — only the latest (fourth) result. Fix: allow specifying which result(s) to include in vision context.

### E. Error Handling Clarification

**E1. Handler error pattern is intentionally two-layered** — severity: NOTE
All 13 handlers follow the same pattern: catch insufficient credits specifically, rethrow everything else. The registry's catch (registry.ts lines 49-52) converts uncaught exceptions to JSON error strings. This is a deliberate two-layer pattern, not inconsistency. Section 2.1's standard pattern should be understood as documenting and formalizing this existing pattern with the addition of NSFW handling, not replacing a broken approach.
