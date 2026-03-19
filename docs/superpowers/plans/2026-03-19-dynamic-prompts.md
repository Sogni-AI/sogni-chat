# Dynamic Prompts for Batch Generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the LLM to use Sogni Dynamic Prompt syntax (`{a|b}`, `{@a|b}`, `{~a|b}`) when generating batch requests, so each variation is meaningfully different instead of seed-only different.

**Architecture:** Purely prompt engineering — update the system prompt with dynamic prompt rules, then update each batch-capable tool's `prompt` parameter description with per-tool variation guidance. No handler/SDK/UI code changes. The server already expands dynamic prompt syntax.

**Tech Stack:** TypeScript (tool definition files), system prompt text

**Spec:** `docs/superpowers/specs/2026-03-19-dynamic-prompts-design.md`

---

### Task 1: Add Dynamic Prompt Section to System Prompt

**Files:**
- Modify: `src/config/chat.ts:10-20` (CHAT_SYSTEM_PROMPT)

- [ ] **Step 1: Add dynamic prompt rules to the system prompt**

Add a new `DYNAMIC PROMPTS` section after the existing `HARD CONSTRAINTS` section in `CHAT_SYSTEM_PROMPT`. Insert before the closing backtick:

```typescript
DYNAMIC PROMPTS: When numberOfVariations > 1, use Dynamic Prompt syntax to make each variation meaningfully different — not just seed-different. Syntax: {a|b|c} cycles options sequentially (default), {@a|b|c} picks randomly, {@75::a|25::b} weighted random, {~a|b} paired cycling across groups. Multiple groups multiply ({a|b} {c|d} = 4 combos) — prefer a single group or match the product to numberOfVariations. Rules: (1) Vary ONLY what the user left unspecified — lock in everything they specified. (2) Match option count to numberOfVariations so every result is unique. If you can't think of enough options, use {@...} with extra options instead. (3) Briefly tell the user what you're varying ("Generating 4 variations exploring different environments and lighting") — never show raw {|} syntax. (4) Skip dynamic prompts when: user wants consistency, prompt is fully specified, user typed their own {|} syntax, or iterating on a specific result. Only use in the prompt parameter, not negativePrompt.
```

- [ ] **Step 2: Verify the prompt reads correctly**

Read the full `CHAT_SYSTEM_PROMPT` string to verify the new section flows naturally after HARD CONSTRAINTS.

- [ ] **Step 3: Commit**

```bash
git add src/config/chat.ts
git commit -m "feat: add dynamic prompt rules to system prompt for batch variation"
```

---

### Task 2: Update generate_image Tool Definition

**Files:**
- Modify: `src/tools/generate-image/definition.ts:18-22` (prompt parameter description)

- [ ] **Step 1: Append dynamic prompt guidance to the prompt description**

Add the following after the existing prompt description text (after the line ending with `POSITIVE phrasing only.`):

```
BATCH VARIATIONS: When numberOfVariations > 1, use Dynamic Prompt syntax to vary unspecified dimensions. Example: "4 images of a black cat" → "a black cat {lounging in a sunlit window|prowling through autumn leaves|sitting on a vintage bookshelf|curled up by a fireplace}". Vary setting, style, lighting, or composition — never override what the user specified.
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/generate-image/definition.ts
git commit -m "feat: add dynamic prompt guidance to generate_image definition"
```

---

### Task 3: Update generate_video Tool Definition

**Files:**
- Modify: `src/tools/generate-video/definition.ts:19-28` (prompt parameter description)

- [ ] **Step 1: Append dynamic prompt guidance to the prompt description**

Add the following after the existing prompt description text (after the line about concrete sensory details):

```
BATCH VARIATIONS: When numberOfVariations > 1, use Dynamic Prompt syntax. Lock in any camera/subject/style the user specified, vary the rest. Example: "slow dolly in on a city street {at dawn with golden light|during a rainstorm|at night with neon reflections}".
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/generate-video/definition.ts
git commit -m "feat: add dynamic prompt guidance to generate_video definition"
```

---

### Task 4: Update edit_image Tool Definition

**Files:**
- Modify: `src/tools/edit-image/definition.ts:19-27` (prompt parameter description)

- [ ] **Step 1: Append dynamic prompt guidance to the prompt description**

Add the following after the existing prompt description text (after "Be specific about what to take from each reference image."):

```
BATCH VARIATIONS: When numberOfVariations > 1, use Dynamic Prompt syntax. For personas: vary scene, activity, or environment — never vary identity. Example: "[persona] at the beach {building a sandcastle|surfing a wave|reading under a palm tree}". For direct edits: vary the approach, e.g., "make the sky {a vibrant sunset|stormy and dramatic|clear blue}".
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/edit-image/definition.ts
git commit -m "feat: add dynamic prompt guidance to edit_image definition"
```

---

### Task 5: Update restore_photo Tool Definition

**Files:**
- Modify: `src/tools/restore-photo/definition.ts:19-27` (prompt parameter description)

- [ ] **Step 1: Append dynamic prompt guidance to the prompt description**

Add the following after the existing prompt description text (after "No keyword spam"):

```
BATCH VARIATIONS: Only use Dynamic Prompt syntax when the user explicitly requests multiple approaches to compare. Example: "restore with {warm vintage|cool modern|natural balanced} tones". Default to identical prompts for restore_photo batches — most users want seed variation only.
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/restore-photo/definition.ts
git commit -m "feat: add dynamic prompt guidance to restore_photo definition"
```

---

### Task 6: Update refine_result Tool Definition

**Files:**
- Modify: `src/tools/refine-result/definition.ts:19-26` (prompt parameter description)

- [ ] **Step 1: Append dynamic prompt guidance to the prompt description**

Add the following after the existing prompt description text (after "append identity preservation directive."):

```
BATCH VARIATIONS: Only use Dynamic Prompt syntax when the user explicitly asks to explore different refinement directions. Example: "refine with {more contrast|softer lighting|richer colors}". Default to identical prompts for refine_result batches.
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/refine-result/definition.ts
git commit -m "feat: add dynamic prompt guidance to refine_result definition"
```

---

### Task 7: Update animate_photo Tool Definition

**Files:**
- Modify: `src/tools/animate-photo/definition.ts:19-35` (prompt parameter description)

- [ ] **Step 1: Append dynamic prompt guidance to the prompt description**

Add the following after the existing prompt description text (after "Subtle, natural movements."):

```
BATCH VARIATIONS: When numberOfVariations > 1, use Dynamic Prompt syntax to vary motion, camera, or atmosphere while preserving the user's specified elements. Example: "{gentle sway with soft birdsong|dramatic zoom with rolling thunder|slow pan with ambient music}".
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/animate-photo/definition.ts
git commit -m "feat: add dynamic prompt guidance to animate_photo definition"
```

---

### Task 8: Update sound_to_video Tool Definition

**Files:**
- Modify: `src/tools/sound-to-video/definition.ts:19-24` (prompt parameter description)

- [ ] **Step 1: Append dynamic prompt guidance to the prompt description**

Add the following after the existing prompt description text (after "Describe motion as it relates to the audio."):

```
BATCH VARIATIONS: When numberOfVariations > 1, use Dynamic Prompt syntax to vary the visual interpretation while keeping audio sync intent consistent. Example: "{abstract neon visualization|nature scene with swaying trees|urban street with rain} synced to the beat".
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/sound-to-video/definition.ts
git commit -m "feat: add dynamic prompt guidance to sound_to_video definition"
```

---

### Task 9: Update video_to_video Tool Definition

**Files:**
- Modify: `src/tools/video-to-video/definition.ts:17-29` (prompt parameter description)

- [ ] **Step 1: Append dynamic prompt guidance to the prompt description**

Add the following after the existing prompt description text (after "Concrete visual details."):

```
BATCH VARIATIONS: When numberOfVariations > 1, use Dynamic Prompt syntax to vary the artistic treatment while keeping control mode and structural intent consistent. Example: "transform to {watercolor with soft edges|oil painting with bold strokes|anime with clean lines} style".
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/video-to-video/definition.ts
git commit -m "feat: add dynamic prompt guidance to video_to_video definition"
```

---

### Task 10: Validate Build and Lint

**Files:**
- None (validation only)

- [ ] **Step 1: Run TypeScript check**

Run: `npm run build`
Expected: Clean build, no type errors

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: Pass (max 16 warnings threshold)

- [ ] **Step 3: Measure token impact**

Check if `TOOL_SCHEMA_TOKENS` in `src/config/chat.ts:125` (currently 8,000) needs updating. The additions are ~60 words per tool across 8 tools (~480 words / ~600 tokens) plus ~130 words in system prompt (~170 tokens). Total impact: ~770 tokens. Current measured baseline is ~7,500 tokens, so new total would be ~8,270. Update `TOOL_SCHEMA_TOKENS` to 8,500 if needed.

- [ ] **Step 4: Update TOOL_SCHEMA_TOKENS if needed**

If the build and lint pass but token measurement suggests the budget needs updating:

```typescript
TOOL_SCHEMA_TOKENS: 8_500, // Budget for tool definitions sent to LLM. 16 tools with detailed param descriptions including dynamic prompt guidance. Measured at ~8,300 tokens.
```

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: update TOOL_SCHEMA_TOKENS budget for dynamic prompt additions"
```
