# Dialogue Duration Fitting for Video Prompts

**Date:** 2026-03-26
**Status:** Approved

## Problem

When the LLM generates video prompts containing dialogue, there is no validation that the spoken lines fit within the clip's duration. A 5-second clip could receive 30 seconds of dialogue, resulting in compressed/unintelligible speech or truncated audio in the generated video.

## Solution

A two-layer approach: the system prompt teaches the LLM to plan dialogue duration up front, and the video prompt refinement layer validates and corrects mismatches after refinement.

### Design Decisions

- **Speaking rate:** 2.5 words/second (slower, cinematic pace with room for pauses and acting beats)
- **Extend-vs-trim heuristic:** If the user didn't specify a duration (LLM omitted the `duration` arg, falling back to the default 5s), extend the duration to fit the dialogue (capped at 20s). If the user explicitly specified a duration, trim/condense the dialogue to fit.
- **Beat buffer:** Each acting beat described between dialogue lines adds ~1 second to the estimated duration.

## Changes

### 1. System Prompt (`src/config/chat.ts`)

Add a **Dialogue Duration** rule to the video-related directives in `CHAT_SYSTEM_PROMPT`:

- Establish the 2.5 words/second speaking rate as a hard rule
- Teach the extend-vs-trim heuristic:
  - No explicit duration (default 5s) -> extend duration to fit dialogue (max 20s)
  - Explicit duration -> condense dialogue to fit
- Include a worked example: "A line like 'I've been waiting for you. I didn't think you'd come back after what happened last time.' is 17 words = 7 seconds minimum. For a 5s default clip, extend to 7s. For a user-requested 5s clip, condense to ~12 words."
- Remind the LLM to account for pauses and acting beats (add ~1s buffer per beat between dialogue lines)

### 2. Dialogue Duration Estimation (`src/tools/shared/videoPromptRefinement.ts`)

#### New utility: `estimateDialogueDuration(prompt: string)`

- Extract all quoted strings from the refined prompt (text between double quotes)
- Count total words across all quoted segments
- Count acting beats between dialogue lines (phrases like "pauses", "looks away", "takes a breath" — simple regex patterns)
- Calculate: `requiredSeconds = (totalWords / 2.5) + (beatCount * 1.0)`
- Return: `{ totalWords, beatCount, requiredSeconds, dialogueSegments: string[] }`

#### New utility: `wasExplicitDuration(args: Record<string, unknown>)`

- Returns `true` if the LLM passed a `duration` argument in the tool call
- Returns `false` if `duration` is absent from args (handler falls back to default 5s)
- When `true`, the duration is treated as intentional and the system trims dialogue to fit
- When `false`, the duration is treated as flexible and the system extends it to fit dialogue

### 3. Post-Refinement Validation (`src/tools/shared/videoPromptRefinement.ts`)

Added to `refineVideoPrompt()` after the thinking-mode LLM returns the refined prompt:

1. Call `estimateDialogueDuration()` on the refined prompt
2. If `requiredSeconds <= requestedDuration` -> no action needed, dialogue fits
3. If `requiredSeconds > requestedDuration`:
   a. **Duration is flexible** (default was used): set `suggestedDuration = Math.min(Math.ceil(requiredSeconds), 20)`. If `requiredSeconds > 20`, fall through to trimming.
   b. **Duration is explicit** (user specified) OR exceeds 20s cap: send the refined prompt back through the thinking-mode LLM with instruction: "The dialogue requires ~Xs but the clip is Ys. Condense the dialogue to fit within Ys at 2.5 words/second while preserving meaning. Keep acting beats minimal."
4. Return `{ refinedPrompt, suggestedDuration }` (suggestedDuration is undefined when no adjustment needed)

#### Return type change

`refineVideoPrompt()` currently returns `string`. Change to return `{ refinedPrompt: string, suggestedDuration?: number }`.

### 4. Handler Integration

In `generate-video/handler.ts` and `animate-photo/handler.ts`:

- Destructure `{ refinedPrompt, suggestedDuration }` from `refineVideoPrompt()`
- Use `suggestedDuration ?? duration` for frame calculation
- No changes to `sound-to-video` (audio track drives duration, no prompt refinement layer)
- No changes to `video-to-video` (transforms existing video, no dialogue generation)
- No changes to `stitch-video` (concatenation only)
- No changes to frame calculation logic (already accepts duration as input)
- No changes to tool definition schemas (duration param stays 2-20s with default 5)

### 5. Logging

Console logs with `[VIDEO REFINEMENT]` prefix:

- `Dialogue estimated at X.Xs for Ys clip (W words, B beats)` — always logged when dialogue detected
- `Extending duration from Ys to Xs (default duration, flexible)` — when extending
- `Trimming dialogue to fit Ys clip (explicit duration)` — when triggering trim pass
- `Dialogue fits within Ys clip — no adjustment needed` — when no mismatch

No user-facing messages. Adjustments happen transparently inside the refinement layer.

## Files Modified

| File | Change |
|------|--------|
| `src/config/chat.ts` | Add dialogue duration rules to system prompt |
| `src/tools/shared/videoPromptRefinement.ts` | Add `estimateDialogueDuration()`, `wasExplicitDuration()`, post-refinement validation, change return type |
| `src/tools/generate-video/handler.ts` | Destructure `suggestedDuration`, use for frame calc |
| `src/tools/animate-photo/handler.ts` | Destructure `suggestedDuration`, use for frame calc |

## Not Changed

- Tool definition schemas (duration parameter unchanged)
- Frame calculation logic (already takes duration as input)
- `video-to-video` and `stitch-video` handlers (no dialogue generation)
- User-facing UI (adjustments are transparent)
