# Dynamic Prompts for Batch Generation

**Date**: 2026-03-19
**Status**: Approved
**Scope**: System prompt + tool definition prompt engineering (no code logic changes)

## Problem

When users request batch generation (numberOfVariations > 1), every variation uses the identical prompt — the only difference is the random seed. This produces near-identical outputs that don't meaningfully explore the creative space.

## Solution

Teach the LLM to use Sogni's Dynamic Prompt syntax when constructing batch prompts, so the server expands each variation into a meaningfully different result. The server already parses and expands dynamic prompt syntax — no client-side logic is needed.

## Dynamic Prompt Syntax Reference

Three operators, all expanded server-side in sogni-socket:

| Operator | Syntax | Behavior |
|----------|--------|----------|
| Combinatorial | `{a\|b\|c}` | Produces one output per option in sequence; loops back to start when jobs exceed the number of options |
| Cyclical | `{~a\|b\|c}` | Locks multiple groups in parallel — group1[i] always pairs with group2[i], cycling in lockstep |
| Random | `{@a\|b\|c}` | Picks one option at random per job |
| Weighted Random | `{@75::a\|25::b}` | Random with probability weights; omitted weights default to 1 |

**Combinatorial multiplication**: Multiple independent groups multiply: `{a|b} {c|d}` = 4 combinations. When using multiple groups, the total product of options across all groups determines the combination count — not the individual group sizes. For N variations, keep the total product equal to N (e.g., 2 groups of 2 for 4 variations), or prefer a single group to keep it simple.

**Negative prompts**: Only use dynamic prompt syntax in the primary `prompt` parameter. Keep `negativePrompt` static — varying what to avoid across jobs adds complexity without clear creative benefit.

## Changes Required

### 1. System Prompt Addition (`src/config/chat.ts`)

Add a concise section to the system prompt teaching the LLM:

- The three dynamic prompt operators and their syntax
- When generating multiple variations, use dynamic prompts to make each result meaningfully different
- Briefly tell the user what's being varied (e.g., "Generating 4 variations exploring different lighting and compositions") but don't expose the raw syntax
- Core behavior rules (see below)

**Token budget**: Keep each per-tool definition addition under 60 words and the system prompt addition under 150 words. The current tool schema budget has limited headroom (~500 tokens). Measure total token impact after implementation and update `TOOL_SCHEMA_TOKENS` in `src/config/chat.ts` if needed.

### 2. Tool Definition Updates (8 files)

Update the `prompt` parameter description in each batch-capable tool's `definition.ts` to include:

- Per-tool guidance on what dimensions to vary
- A brief example
- The "preserve user intent" rule

#### Per-Tool Variation Guidance

**generate_image** (`src/tools/generate-image/definition.ts`):
- Vary: subject details, art styles, settings/environments, lighting, color palettes, compositions
- Example: User asks for "4 images of a black cat" → `a black cat {lounging in a sunlit window|prowling through autumn leaves|sitting on a vintage bookshelf|curled up by a fireplace}`
- Cyclical example: For coordinated variation: `a black cat {~in a garden|on a rooftop} during {~sunset|night}` → garden+sunset, rooftop+night (paired, not all 4 combos)

**generate_video** (`src/tools/generate-video/definition.ts`):
- Vary: scene elements, camera movements, mood/atmosphere, time of day
- Example: User asks for "3 videos of a city" with specific camera → lock camera, vary scene: `slow dolly in on a city street {at dawn with golden light|during a rainstorm|at night with neon reflections}`

**edit_image** (`src/tools/edit-image/definition.ts`):
- Vary: scene composition, activity, environment (for persona/reference-photo use), or editing approach, color treatment (for direct edits)
- Persona example: User asks for "4 images of my persona at the beach" → `[persona] at the beach {building a sandcastle|surfing a wave|reading under a palm tree|watching the sunset}`
- Direct edit example: `make the sky {a vibrant sunset|stormy and dramatic|clear blue}`

**restore_photo** (`src/tools/restore-photo/definition.ts`):
- Vary: restoration tone/feel, enhancement style
- Example: `restore with {warm vintage|cool modern|natural balanced} tones`
- Note: Default to NOT using dynamic prompts for restore_photo unless the user explicitly requests multiple variations to compare approaches. Most restoration calls are iterative toward a specific outcome.

**refine_result** (`src/tools/refine-result/definition.ts`):
- Vary: refinement direction, enhancement focus
- Example: `refine with {more contrast|softer lighting|richer colors}`
- Note: Default to NOT using dynamic prompts for refine_result unless the user explicitly asks to explore different refinement directions. Most refinement calls are iterative.

**animate_photo** (`src/tools/animate-photo/definition.ts`):
- Vary: motion style, animation approach
- Example: `{gentle sway|dramatic zoom|slow pan} animation`

**sound_to_video** (`src/tools/sound-to-video/definition.ts`):
- Vary: visual interpretation of audio, scene type
- Example: `{abstract visualization|nature scene|urban landscape} synced to music`

**video_to_video** (`src/tools/video-to-video/definition.ts`):
- Vary: style transfer approach, artistic treatment
- Example: `transform to {watercolor|oil painting|anime} style`

## Behavior Rules

### Core Principle: Respect User Intent

**Vary only what the user left unspecified. Lock in everything they specified.**

- "4 images of a black cat" → subject (black cat) locked, vary setting/style
- "4 images of a black cat in a garden" → subject + setting locked, vary within garden (flowers, fountain, trees, butterflies)
- "4 slow dolly in shots of a black cat" → camera + subject locked, vary the scene/environment

### Operator Selection

- **`{a|b|c}` (combinatorial)**: Default choice. Use for most batch requests. Match the number of options to `numberOfVariations` so every result is unique. If you cannot think of enough distinct options to match `numberOfVariations`, use the random `{@...}` operator with extra options instead — this avoids duplicate results from looping.
- **`{@a|b|c}` (random)**: Use when there are significantly more good options than `numberOfVariations`, or when the user says "surprise me" / "random variations."
- **`{@75::a|25::b}` (weighted random)**: Use when the user expresses a preference but wants variety. E.g., "mostly warm tones" → `{@75::warm golden|25::cool blue} lighting`
- **`{~a|b}` (cyclical)**: Use when multiple variable groups should stay paired. E.g., `{~indoor|outdoor} scene with {~warm|cool} lighting` → indoor+warm, outdoor+cool.

### Seed + Prompt Variation

Dynamic prompts provide semantic variation (different content per job), while different seeds provide stochastic variation (different rendering of the same content). Both apply together by default. When the user wants ONLY seed variation (subtle differences in the same scene), skip dynamic prompts.

### When NOT to Use Dynamic Prompts

Even with numberOfVariations > 1, skip dynamic prompts when:

- **User wants consistency**: "Generate 4 of the exact same style" — let seed alone create subtle variation
- **numberOfVariations = 1**: No batch, no need
- **User's prompt is fully specified**: Every detail is locked down, nothing left to vary
- **User provides their own dynamic prompt syntax**: Pass it through as-is, don't layer more on top
- **User is iterating on a specific result**: Refinement/restoration where they want to see seed variation, not prompt variation

### Communication Style

When using dynamic prompts, briefly tell the user what's being varied:

- "Generating 4 variations exploring different environments and lighting"
- "Creating 3 versions with different restoration approaches"
- "Producing 4 takes with varied camera angles and atmospheres"

Do NOT show the raw `{a|b|c}` syntax to the user.

## Files to Modify

| File | Change |
|------|--------|
| `src/config/chat.ts` | Add dynamic prompt section to system prompt |
| `src/tools/generate-image/definition.ts` | Add dynamic prompt guidance to prompt parameter |
| `src/tools/generate-video/definition.ts` | Add dynamic prompt guidance to prompt parameter |
| `src/tools/edit-image/definition.ts` | Add dynamic prompt guidance to prompt parameter |
| `src/tools/restore-photo/definition.ts` | Add dynamic prompt guidance to prompt parameter |
| `src/tools/refine-result/definition.ts` | Add dynamic prompt guidance to prompt parameter |
| `src/tools/animate-photo/definition.ts` | Add dynamic prompt guidance to prompt parameter |
| `src/tools/sound-to-video/definition.ts` | Add dynamic prompt guidance to prompt parameter |
| `src/tools/video-to-video/definition.ts` | Add dynamic prompt guidance to prompt parameter |

## What Does NOT Change

- No handler logic changes — prompts pass through to the server as-is
- No SDK changes — server already expands dynamic prompt syntax
- No UI changes — results display the same way
- No new dependencies
- `apply_style`, `change_angle`, and `generate_music` are excluded because they do not support batch generation (no `numberOfVariations` parameter)
