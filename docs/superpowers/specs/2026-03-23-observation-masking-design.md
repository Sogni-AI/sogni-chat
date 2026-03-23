# Observation Masking & Result Manifest for Context Window

**Date**: 2026-03-23
**Status**: Draft
**Scope**: `src/services/contextWindow.ts` — two-phase enhancement to context window trimming

## Problem

When `trimConversation` drops old message groups to fit the context budget, the LLM loses awareness of what it previously generated and which index maps to which result. The current trim summary says only:

```
[Earlier conversation summary: Tools used: generate_image (2 results). Details were trimmed to save context.]
```

This breaks multi-step workflows where the user later references old results by description — e.g., "generate another video with those start and end frame images you generated." The LLM cannot map that request to `sourceImageIndex=0` and `endImageIndex=1` because the conversation context that contained the prompt, result descriptions, and ordering is gone. Meanwhile, `allResultUrls` still holds all the URLs, creating a mismatch between what the tool system knows and what the LLM can reason about.

## Solution

Two-phase context compression in `trimConversation`:

1. **Phase 1 — Observation Masking**: Compress old tool *outputs* while keeping the LLM's reasoning and the user's messages intact. This extends how long conversations stay in context before any groups need to be dropped.

2. **Phase 2 — Enriched Trim Summary**: When groups must finally be dropped, build a result manifest that maps indexes to brief descriptions, so the LLM can still reference old results.

## Research Basis

- **JetBrains (2025)**: Tested observation masking with Qwen3 specifically — achieved 52% cost reduction with 2.6% accuracy *improvement*. More effective than LLM-based summarization (which caused 15% trajectory elongation). Observation masking compresses tool *outputs* while preserving agent reasoning/actions.
- **Existing architecture**: `allResultUrls` and `allResultUrlsRef` already track all result URLs independently of conversation history. Tool handlers access results by index through the execution context, not through the conversation. This means compressing conversation-level tool results is safe — the actual URLs are tracked elsewhere.

## Phase 1: Observation Masking

### What Changes

Before checking the token budget, mask tool result messages in groups older than the last `MIN_PROTECTED_GROUPS` (currently 2). Replace the full tool result JSON with a compact summary.

### Masking Format

**Before** (full tool result — ~50-80 tokens):
```json
{"success":true,"resultCount":2,"model":"Z-Image Turbo","creditsCost":"0.50","message":"Successfully generated 2 images using Z-Image Turbo. Cost: ~0.50 credits. The user can now see the results."}
```

**After** (masked — ~10 tokens):
```json
{"ok":true,"n":2}
```

For error results, keep the error message (the LLM may need it for reasoning about retries):
```json
{"ok":false,"error":"insufficient_credits"}
```

### What Is Preserved (Unchanged)

Within the same message group:

- **Assistant `tool_calls`**: Contains the prompt, tool name, all arguments (numberOfVariations, sourceImageIndex, frameRole, etc.). This is the LLM's own decision record — it knows what it generated because it can see what it asked for.
- **Assistant follow-up text**: Contains descriptions like "Here are your two images — a sunset and a mountain scene." This is the human-readable mapping of results.
- **User messages**: The request that prompted the generation.

### Why This Works

The LLM's index-to-content awareness comes from three sources, all preserved:
1. Its own `tool_calls` args → what prompt it crafted, how many variations
2. The conversation flow → first tool call produces indexes 0..N-1, second produces N..N+M-1
3. Its own follow-up text → natural language descriptions of what it generated

The only thing masked is the tool's success/count acknowledgment, which is redundant with (1) and (2).

### Token Impact

Each masked tool result saves ~40-70 tokens. For a conversation with 10 message groups (8 maskable), that's ~320-560 tokens recovered — often enough to avoid trimming any groups at all.

### Masking Rules

- **Mask**: Tool result messages (`role: 'tool'`) in groups older than `MIN_PROTECTED_GROUPS` from the end.
- **Don't mask**: Tool results in the last `MIN_PROTECTED_GROUPS` groups (recent context needs full details for active tool chaining).
- **Don't mask**: Error results beyond extracting the error type — the LLM may need error context.
- **Don't mask**: `analyze_image` results — these contain the vision analysis text that the LLM uses for subsequent creative decisions.

## Phase 2: Enriched Trim Summary with Result Manifest

### What Changes

When `buildTrimmedSummary` processes dropped groups, extract a result manifest from the assistant's `tool_calls` in those groups. This tells the LLM what was generated and at approximately which position.

### Manifest Format

**Before** (current trim summary):
```
[Earlier conversation summary: Tools used: generate_image (2 results). Details were trimmed to save context.]
```

**After** (with result manifest):
```
[Earlier: User uploaded a photo. Generated: 2 images (generate_image, "sunset over misty mountains" / "ocean at dusk with purple sky"), 1 video (animate_photo, interpolation from first to second image). Details trimmed.]
```

### Manifest Construction

For each trimmed group:
1. Find the assistant's `tool_calls` → extract `function.name` and `function.arguments`
2. From arguments, extract `prompt` (truncated to ~50 chars, with dynamic syntax like `{a|b}` collapsed to "varied")
3. Find the corresponding `tool` result message → extract `resultCount` (or default to 1)
4. Build a compact entry: `N type(s) (tool_name, "brief prompt excerpt")`

For multi-tool groups, list each tool call separately.

### What the Manifest Does NOT Include

- Exact numeric indexes — these shift as the conversation progresses and would be fragile. Instead, the manifest preserves *what* was generated and in what order, which is sufficient for the LLM to reason about relative positions ("the first image" / "the second one").
- Full prompts — truncated to save tokens.
- URLs — tracked in `allResultUrls`, not the LLM's concern.

## Implementation

### Changes to `src/services/contextWindow.ts`

#### New Function: `maskOldToolResults`

```typescript
/**
 * Replace tool result content with compact summaries for older message groups.
 * Preserves assistant tool_calls and follow-up text — only compresses tool outputs.
 * Returns masked groups with updated token counts.
 */
function maskOldToolResults(
  groups: MessageGroup[],
  protectedCount: number,
): MessageGroup[] {
  return groups.map((group, i) => {
    // Don't mask recent groups
    if (i >= groups.length - protectedCount) return group;

    let tokensReduced = 0;
    const maskedMessages = group.messages.map((msg) => {
      if (msg.role !== 'tool') return msg;

      // Don't mask analyze_image — LLM needs the vision analysis
      if (msg.name === 'analyze_image') return msg;

      const originalTokens = estimateMessageTokens(msg);
      try {
        const parsed = JSON.parse(typeof msg.content === 'string' ? msg.content : '');
        const masked = parsed.error
          ? { ok: false, error: parsed.error }
          : { ok: true, n: parsed.resultCount || 1 };
        const maskedMsg = { ...msg, content: JSON.stringify(masked) };
        tokensReduced += originalTokens - estimateMessageTokens(maskedMsg);
        return maskedMsg;
      } catch {
        return msg; // Unparseable — leave as-is
      }
    });

    return {
      messages: maskedMessages,
      tokens: group.tokens - tokensReduced,
      hasImage: group.hasImage,
    };
  });
}
```

#### Updated `trimConversation` Flow

```typescript
export function trimConversation(messages, systemMessage, inputBudget) {
  const systemTokens = estimateMessageTokens(systemMessage);
  const totalTokens = systemTokens + estimateTotalTokens(messages);

  if (totalTokens <= inputBudget) {
    return { messages, trimmedCount: 0, insertedSummary: false };
  }

  const groups = groupMessages(messages);
  if (groups.length <= MIN_PROTECTED_GROUPS) {
    return { messages, trimmedCount: 0, insertedSummary: false };
  }

  const protectedCount = Math.min(MIN_PROTECTED_GROUPS, groups.length);

  // Phase 1: Mask old tool results before checking budget
  const maskedGroups = maskOldToolResults(groups, protectedCount);

  // Recheck budget after masking
  const maskedTotal = systemTokens + maskedGroups.reduce((sum, g) => sum + g.tokens, 0);
  if (maskedTotal <= inputBudget) {
    // Masking alone was enough — rebuild messages from masked groups
    return {
      messages: maskedGroups.flatMap(g => g.messages),
      trimmedCount: 0,
      insertedSummary: false,
    };
  }

  // Phase 2: Still over budget — trim oldest masked groups
  const trimmable = maskedGroups.slice(0, maskedGroups.length - protectedCount);
  const protectedGroups = maskedGroups.slice(maskedGroups.length - protectedCount);

  // ... existing trim logic, but operating on maskedGroups
  // ... buildEnrichedSummary instead of buildTrimmedSummary
}
```

#### Updated `buildTrimmedSummary` → `buildEnrichedSummary`

```typescript
function buildEnrichedSummary(trimmedGroups: MessageGroup[]): ChatMessage | null {
  const events: string[] = [];
  let hasUpload = false;
  const generatedItems: string[] = [];

  for (const group of trimmedGroups) {
    // Pair tool_calls with their results within the group
    const toolCallsMsg = group.messages.find(m => m.role === 'assistant' && m.tool_calls?.length);
    const toolResults = group.messages.filter(m => m.role === 'tool');

    // Detect uploads
    for (const msg of group.messages) {
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        if (msg.content.some(p => p.type === 'image_url')) hasUpload = true;
      }
    }

    // Build manifest entries from tool_calls + results
    if (toolCallsMsg?.tool_calls) {
      for (let i = 0; i < toolCallsMsg.tool_calls.length; i++) {
        const tc = toolCallsMsg.tool_calls[i];
        const result = toolResults[i];
        const name = tc.function.name;

        let count = 1;
        if (result) {
          try {
            const parsed = JSON.parse(typeof result.content === 'string' ? result.content : '');
            if (parsed.error) continue; // Skip failed tools
            count = parsed.n || parsed.resultCount || 1;
          } catch { /* use default count */ }
        }

        // Extract and truncate prompt
        let promptExcerpt = '';
        try {
          const args = JSON.parse(tc.function.arguments);
          if (args.prompt) {
            promptExcerpt = args.prompt
              .replace(/\{[^}]*\}/g, '(varied)')  // Collapse dynamic syntax
              .slice(0, 50)
              .trim();
            if (args.prompt.length > 50) promptExcerpt += '…';
          }
        } catch { /* no prompt excerpt */ }

        const mediaType = ['animate_photo', 'generate_video', 'sound_to_video', 'video_to_video'].includes(name)
          ? 'video' : name === 'generate_music' ? 'audio' : 'image';
        const entry = promptExcerpt
          ? `${count} ${mediaType}${count > 1 ? 's' : ''} (${name}, "${promptExcerpt}")`
          : `${count} ${mediaType}${count > 1 ? 's' : ''} (${name})`;
        generatedItems.push(entry);
      }
    }
  }

  if (hasUpload) events.push('User uploaded media');
  if (generatedItems.length > 0) events.push(`Generated: ${generatedItems.join(', ')}`);

  if (events.length === 0) return null;

  return {
    role: 'user' as const,
    content: `[Earlier: ${events.join('. ')}. Details trimmed.]`,
  };
}
```

## Files to Modify

| File | Change |
|------|--------|
| `src/services/contextWindow.ts` | Add `maskOldToolResults`, update `trimConversation` flow, replace `buildTrimmedSummary` with `buildEnrichedSummary` |

## What Does NOT Change

- No tool handler changes
- No SDK changes
- No UI changes
- No system prompt changes
- `allResultUrls` / `allResultUrlsRef` tracking is unaffected
- Tool execution context construction is unaffected
- Session persistence (IndexedDB, sessionStorage backup) stores full unmasked conversation — masking only applies to the API-bound copy

## Edge Cases

### analyze_image results
Not masked — the vision analysis text is used by the LLM for subsequent creative decisions (e.g., "Based on what I see in your photo, here are some ideas..."). Masking these would degrade quality.

### Error results
Masked to `{"ok":false,"error":"..."}` preserving the error type. The LLM may reference past errors (e.g., "it failed last time because of credits").

### Multi-round tool chains
If the LLM called generate_image then animate_photo in one conversation turn, each tool call is in its own message group (onToolComplete rotates localStreamingId). Each gets masked independently.

### Extremely long conversations
Phase 2 handles this — even if all masked groups still exceed budget, the enriched manifest preserves enough context for the LLM to reference old results meaningfully.

## Validation

1. **Token accounting**: After implementation, log `[CONTEXT] Masking saved N tokens, budget now at M/B` to verify savings match expectations.
2. **Functional test**: Start a long conversation, generate multiple image batches, let trimming kick in, then ask the LLM to reference an early result by description. It should be able to identify the correct index.
3. **Edge case**: Generate images, then videos, then ask about the images. Verify the manifest distinguishes media types.
