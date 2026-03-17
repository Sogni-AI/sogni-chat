# Media Actions Menu (3-Dot Menu) Design Spec

## Overview

Add a 3-dot menu below each generated media result (image, video, audio) in chat messages. The menu provides two actions: "Branch in new chat" and "Retry" (with sub-options "Try Again" and model switching).

## Data Changes

### UIChatMessage Extensions (`src/types/chat.ts`)

Add two new optional fields:

```typescript
interface UIChatMessage {
  // ... existing fields ...
  toolArgs?: Record<string, unknown>;   // Original args passed to the tool
  toolModelKey?: string;                // Model key used (e.g., "z-turbo", "qwen-lightning")
}
```

These are populated in `useChat.ts` `onToolComplete` callback alongside existing `lastCompletedTool` and `modelName`.

### Capturing Tool Args

In `useChat.ts`, the `onToolCall` callback already receives the tool name and args. Store args on the message at that point so they're available when the tool completes.

## Model Registry (`src/tools/shared/modelRegistry.ts`)

A central lookup mapping tool names to their available models. Extracted from existing handler model configs.

```typescript
interface ModelOption {
  key: string;        // e.g., "z-turbo"
  displayName: string; // e.g., "Z-Image Turbo"
}

// Map from tool name to available models
const MODEL_OPTIONS: Record<string, ModelOption[]> = {
  generate_image: [
    { key: 'z-turbo', displayName: 'Z-Image Turbo' },
    { key: 'z-image', displayName: 'Z-Image' },
    { key: 'chroma-v46-flash', displayName: 'Chroma v.46 Flash' },
    { key: 'chroma-detail', displayName: 'Chroma Detail' },
    { key: 'flux1-krea', displayName: 'Flux.1 Krea' },
    { key: 'flux2', displayName: 'Flux.2 Dev' },
    { key: 'pony-v7', displayName: 'CyberRealistic Pony v7' },
  ],
  edit_image: [
    { key: 'qwen-lightning', displayName: 'Qwen Image Edit Lightning' },
    { key: 'qwen', displayName: 'Qwen Image Edit 2511' },
    { key: 'flux2', displayName: 'Flux.2 Dev' },
  ],
  restore_photo: [
    { key: 'qwen-lightning', displayName: 'Qwen Image Edit Lightning' },
    { key: 'qwen', displayName: 'Qwen Image Edit 2511' },
    { key: 'flux2', displayName: 'Flux.2 Dev' },
  ],
  apply_style: [
    { key: 'qwen-lightning', displayName: 'Qwen Image Edit Lightning' },
    { key: 'qwen', displayName: 'Qwen Image Edit 2511' },
    { key: 'flux2', displayName: 'Flux.2 Dev' },
  ],
  refine_result: [
    { key: 'qwen-lightning', displayName: 'Qwen Image Edit Lightning' },
    { key: 'qwen', displayName: 'Qwen Image Edit 2511' },
    { key: 'flux2', displayName: 'Flux.2 Dev' },
  ],
  change_angle: [
    { key: 'qwen-lightning', displayName: 'Qwen Image Edit Lightning' },
    { key: 'qwen', displayName: 'Qwen Image Edit 2511' },
    { key: 'flux2', displayName: 'Flux.2 Dev' },
  ],
  generate_video: [
    { key: 'ltx23', displayName: 'LTX 2.3 22B' },
    { key: 'wan22', displayName: 'WAN 2.2 14B' },
  ],
  animate_photo: [
    { key: 'ltx23', displayName: 'LTX 2.3 22B' },
    { key: 'wan22', displayName: 'WAN 2.2 14B' },
  ],
  video_to_video: [
    { key: 'ltx2-v2v', displayName: 'LTX-2 V2V ControlNet' },
    { key: 'wan22-animate', displayName: 'WAN 2.2 Animate' },
  ],
  sound_to_video: [
    { key: 'wan-s2v', displayName: 'WAN 2.2 S2V' },
    { key: 'ltx23-ia2v', displayName: 'LTX 2.3 Image+Audio' },
    { key: 'ltx23-a2v', displayName: 'LTX 2.3 Audio Only' },
  ],
  generate_music: [
    { key: 'turbo', displayName: 'ACE-Step 1.5 Turbo' },
    { key: 'sft', displayName: 'ACE-Step 1.5 SFT' },
  ],
};

function getAlternativeModels(toolName: string, currentModelKey: string): ModelOption[]
function getModelOptions(toolName: string): ModelOption[]
```

## UI Component: `MediaActionsMenu`

**File:** `src/components/chat/MediaActionsMenu.tsx`

### Props

```typescript
interface MediaActionsMenuProps {
  message: UIChatMessage;
  onBranchChat: (message: UIChatMessage) => void;
  onRetry: (message: UIChatMessage, modelKey?: string) => void;
}
```

### Behavior

- Renders a 3-dot icon button (using `EllipsisHorizontalIcon` from Heroicons)
- On click, opens a popover/dropdown menu
- Menu items:
  1. **Branch in new chat** — icon: arrow-branch. Calls `onBranchChat(message)`
  2. **Retry** — expandable section:
     - **Try Again** — icon: refresh. Calls `onRetry(message)` (no model override)
     - **Divider line with "Switch Model" label**
     - **[Model Name]** for each alternative model. Current model shown with checkmark. Others call `onRetry(message, modelKey)`
- Clicking outside or pressing Escape closes the menu
- Menu positioned to avoid viewport overflow (prefer bottom-right, flip if needed)

### Styling

- Dark background popover matching existing app theme (`bg-[var(--color-surface)]`)
- Rounded corners, subtle shadow
- Hover states on menu items
- 3-dot button appears on hover over media, or always visible on mobile
- Consistent with existing download/favorite button styling

### Placement in Existing Components

The `MediaActionsMenu` is rendered inside:
- `ChatImageResults.tsx` — below the image grid, alongside download/favorite buttons
- `ChatVideoResults.tsx` — below the video player, alongside download button
- `ChatAudioResults.tsx` — below the audio player, alongside download button

## Action: Branch in New Chat

### Flow

1. User clicks "Branch in new chat"
2. Collect all `uiMessages` from the current session up to and including the clicked message
3. Collect corresponding `conversation` entries (LLM context)
4. Create a new session via `createNewSession()`
5. Build a `ChatSession` with the collected messages and conversation
6. Save via `saveCurrentSession(newId, session)`
7. Switch to the new session via `switchSession(newId)`

### Implementation Location

Handler in `useChat.ts` or `ChatPanel.tsx`, passed down as `onBranchChat` callback.

## Action: Retry / Try Again / Switch Model

### Flow

1. User clicks "Try Again" or selects a model
2. Retrieve `toolArgs` and `lastCompletedTool` from the message
3. If a model key was selected, override `toolArgs.model` (or `toolArgs.videoModel` for video tools) with the new key
4. Directly invoke `toolRegistry.execute()` with the modified args
5. Create a new assistant message for the result (appended after current messages)
6. Show progress via existing `toolProgress` mechanism

### Implementation Location

Handler in `useChat.ts`, passed down as `onRetry` callback. Reuses existing tool execution infrastructure (`executeToolDirectly` or similar).

### Model Arg Key Mapping

Different tools use different arg names for model selection:
- Image tools: `args.model`
- Video tools: `args.videoModel`
- Music tools: `args.model`

The retry handler maps based on tool name.

## Edge Cases

- **No tool data**: If `lastCompletedTool` or `toolArgs` are missing (e.g., old history messages), hide the Retry option. Branch in new chat still works.
- **Single model tools**: If a tool only has one model, don't show the "Switch Model" section.
- **Tool in progress**: Don't show the menu while a tool is currently executing.
- **Error results**: Show menu even on error results so user can retry.

## Files to Create/Modify

### New Files
- `src/tools/shared/modelRegistry.ts` — Model options lookup
- `src/components/chat/MediaActionsMenu.tsx` — 3-dot menu component

### Modified Files
- `src/types/chat.ts` — Add `toolArgs`, `toolModelKey` to `UIChatMessage`
- `src/hooks/useChat.ts` — Store tool args on message, implement `onBranchChat` and `onRetry` handlers
- `src/components/chat/ChatImageResults.tsx` — Render `MediaActionsMenu`
- `src/components/chat/ChatVideoResults.tsx` — Render `MediaActionsMenu`
- `src/components/chat/ChatAudioResults.tsx` — Render `MediaActionsMenu`
- `src/components/chat/ChatMessage.tsx` — Pass handlers down to media result components
- `src/components/chat/ChatPanel.tsx` — Wire up handlers from useChat
