# Observation Masking & Result Manifest — Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compress old tool outputs in the context window to keep conversations in context longer, and enrich the trim summary with a result manifest so the LLM can reference old results by description even after full trimming.

**Architecture:** Two-phase enhancement to `trimConversation` in `src/services/contextWindow.ts`. Phase 1 masks old tool results (no groups dropped). Phase 2 builds an enriched summary when groups must be dropped.

**Spec:** `docs/superpowers/specs/2026-03-23-observation-masking-design.md`

---

### Task 1: Add `maskOldToolResults` Function

**Files:**
- Modify: `src/services/contextWindow.ts`

- [ ] **Step 1: Add the masking function**

Add `maskOldToolResults` after the existing `contentHasImage` function (~line 83). This function:
- Takes an array of `MessageGroup[]` and a `protectedCount` number
- Returns a new array with tool result messages masked in groups older than the last `protectedCount`
- For each `role: 'tool'` message in maskable groups:
  - Skip `analyze_image` results (LLM needs vision analysis text)
  - Parse the JSON content
  - Replace with `{"ok":true,"n":resultCount}` for success, `{"ok":false,"error":"..."}` for errors
  - Recalculate the group's token count
- Leave assistant messages, user messages, and protected groups untouched

```typescript
function maskOldToolResults(
  groups: MessageGroup[],
  protectedCount: number,
): MessageGroup[] {
  const maskBoundary = groups.length - protectedCount;
  return groups.map((group, i) => {
    if (i >= maskBoundary) return group;

    let tokensReduced = 0;
    const maskedMessages = group.messages.map((msg) => {
      if (msg.role !== 'tool') return msg;
      if (msg.name === 'analyze_image') return msg;

      const originalTokens = estimateMessageTokens(msg);
      try {
        const parsed = JSON.parse(typeof msg.content === 'string' ? msg.content : '');
        const masked = parsed.error
          ? { ok: false, error: parsed.error }
          : { ok: true, n: parsed.resultCount || 1 };
        const maskedMsg: ChatMessage = { ...msg, content: JSON.stringify(masked) };
        tokensReduced += originalTokens - estimateMessageTokens(maskedMsg);
        return maskedMsg;
      } catch {
        return msg;
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

- [ ] **Step 2: Verify build**

```bash
npm run build
```

---

### Task 2: Update `trimConversation` to Run Masking Before Trimming

**Files:**
- Modify: `src/services/contextWindow.ts` — `trimConversation` function (~line 142)

- [ ] **Step 1: Add masking phase between grouping and budget check**

Update the flow:
1. Group messages (existing)
2. **NEW**: Mask old tool results → get masked groups with lower token counts
3. Recheck budget with masked tokens — if under budget, return masked messages (no trimming needed)
4. If still over budget, proceed with existing trim logic but operating on masked groups
5. Use `buildEnrichedSummary` instead of `buildTrimmedSummary`

Key changes to `trimConversation`:

```typescript
// After: const groups = groupMessages(messages);
// After: if (groups.length <= MIN_PROTECTED_GROUPS) { ... }

const protectedCount = Math.min(MIN_PROTECTED_GROUPS, groups.length);

// Phase 1: Mask old tool results to reclaim tokens
const maskedGroups = maskOldToolResults(groups, protectedCount);
const maskedTotal = systemTokens + maskedGroups.reduce((sum, g) => sum + g.tokens, 0);

if (maskedTotal <= inputBudget) {
  // Masking alone was enough — no groups dropped
  const maskedMessageCount = groups.reduce((n, g) => n + g.messages.length, 0)
    - maskedGroups.reduce((n, g) => n + g.messages.length, 0);
  console.log(`[CONTEXT] Observation masking saved ${totalTokens - maskedTotal} tokens, avoiding trim`);
  return {
    messages: maskedGroups.flatMap(g => g.messages),
    trimmedCount: 0,
    insertedSummary: false,
  };
}

// Phase 2: Still over budget — trim oldest masked groups
const trimmable = maskedGroups.slice(0, maskedGroups.length - protectedCount);
const protectedGroupsArr = maskedGroups.slice(maskedGroups.length - protectedCount);

// ... rest of existing trim logic, but using maskedGroups variables
// ... replace buildTrimmedSummary with buildEnrichedSummary
```

**Important**: The trim logic after masking operates on `maskedGroups` (already compressed), not the original `groups`. This means even the groups that get kept but aren't protected are already masked.

- [ ] **Step 2: Add logging for observability**

Log when masking saves enough to avoid trimming, and when trimming still occurs after masking:
```typescript
console.log(`[CONTEXT] Observation masking: ${savedTokens} tokens recovered from ${maskedGroupCount} groups`);
// If trimming:
console.log(`[CONTEXT] Trimmed ${trimmedCount} messages after masking (masking alone insufficient)`);
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

---

### Task 3: Replace `buildTrimmedSummary` with `buildEnrichedSummary`

**Files:**
- Modify: `src/services/contextWindow.ts` — replace `buildTrimmedSummary` function (~line 89)

- [ ] **Step 1: Rewrite the summary builder**

Replace `buildTrimmedSummary` with `buildEnrichedSummary` that extracts a result manifest from trimmed groups. The function:

1. Iterates trimmed groups
2. Detects user uploads (existing)
3. For each group with assistant `tool_calls`:
   - Pairs each `tool_call` with its corresponding `tool` result message
   - Extracts the tool name from `tool_call.function.name`
   - Extracts the prompt from `tool_call.function.arguments`, truncates to ~50 chars, collapses `{a|b}` dynamic syntax to "(varied)"
   - Extracts `resultCount` from the tool result (or `n` if already masked)
   - Determines media type: video tools → "video", generate_music → "audio", everything else → "image"
   - Builds entry: `N mediaType(s) (toolName, "promptExcerpt")`
4. Assembles into: `[Earlier: User uploaded media. Generated: 2 images (generate_image, "sunset over misty mountains…"), 1 video (animate_photo, "gentle sway with birdsong…"). Details trimmed.]`

```typescript
function buildEnrichedSummary(trimmedGroups: MessageGroup[]): ChatMessage | null {
  const events: string[] = [];
  let hasUpload = false;
  const generatedItems: string[] = [];

  const VIDEO_TOOLS = new Set(['animate_photo', 'generate_video', 'sound_to_video', 'video_to_video']);
  const AUDIO_TOOLS = new Set(['generate_music']);

  for (const group of trimmedGroups) {
    for (const msg of group.messages) {
      if (msg.role === 'user' && typeof msg.content === 'string' && msg.content.includes('[Earlier:')) continue;
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        if (msg.content.some((p: { type: string }) => p.type === 'image_url')) hasUpload = true;
      }
    }

    const toolCallsMsg = group.messages.find(
      (m) => m.role === 'assistant' && m.tool_calls?.length,
    );
    const toolResults = group.messages.filter((m) => m.role === 'tool');

    if (toolCallsMsg?.tool_calls) {
      for (let i = 0; i < toolCallsMsg.tool_calls.length; i++) {
        const tc = toolCallsMsg.tool_calls[i];
        const result = toolResults[i];
        const name: string = tc.function.name;

        // Extract result count (handles both full and masked formats)
        let count = 1;
        if (result) {
          try {
            const parsed = JSON.parse(typeof result.content === 'string' ? result.content : '');
            if (parsed.error || parsed.ok === false) continue;
            count = parsed.n ?? parsed.resultCount ?? 1;
          } catch { /* use default */ }
        }

        // Extract and truncate prompt
        let promptExcerpt = '';
        try {
          const args = JSON.parse(tc.function.arguments);
          if (args.prompt) {
            promptExcerpt = args.prompt
              .replace(/\{[^}]*\}/g, '(varied)')
              .slice(0, 50)
              .trim();
            if (args.prompt.length > 50) promptExcerpt += '…';
          }
        } catch { /* no excerpt */ }

        const mediaType = VIDEO_TOOLS.has(name)
          ? 'video' : AUDIO_TOOLS.has(name) ? 'audio' : 'image';
        const label = `${count} ${mediaType}${count > 1 ? 's' : ''}`;
        const entry = promptExcerpt
          ? `${label} (${name}, "${promptExcerpt}")`
          : `${label} (${name})`;
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

- [ ] **Step 2: Update the call site in `trimConversation`**

Replace the reference from `buildTrimmedSummary(trimmedGroups)` to `buildEnrichedSummary(trimmedGroups)`.

- [ ] **Step 3: Remove old `buildTrimmedSummary`**

Delete the old function entirely — `buildEnrichedSummary` is a complete replacement.

- [ ] **Step 4: Verify build and lint**

```bash
npm run build && npm run lint
```

---

### Task 4: Validate and Commit

**Files:**
- None (validation only)

- [ ] **Step 1: Run TypeScript check**

```bash
npm run build
```
Expected: Clean build, no type errors.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```
Expected: Pass (max 16 warnings threshold).

- [ ] **Step 3: Manual review of edge cases**

Review the final `contextWindow.ts` to verify:
- `analyze_image` results are NOT masked (check `maskOldToolResults`)
- Error results preserve error type (check masking logic)
- Protected groups are never masked (check boundary calculation)
- Enriched summary skips failed tool results (check `parsed.error || parsed.ok === false`)
- Dynamic prompt syntax is collapsed in manifest (check `.replace(/\{[^}]*\}/g, '(varied)')`)
- Masked results use `n` field, enriched summary reads both `n` and `resultCount` (handles both masked and unmmasked)

- [ ] **Step 4: Commit**

```bash
git add src/services/contextWindow.ts
git commit -m "feat: observation masking and enriched trim summary for context window

Phase 1: Compress old tool outputs to compact summaries ({ok,n}) while
preserving assistant reasoning and user messages. Extends how long
conversations stay in context before trimming.

Phase 2: When groups must be dropped, build a result manifest with
tool names, prompt excerpts, and media types so the LLM can reference
old results by description even after full context trimming.

Refs: docs/superpowers/specs/2026-03-23-observation-masking-design.md"
```
