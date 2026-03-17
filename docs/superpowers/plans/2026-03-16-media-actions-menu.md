# Media Actions Menu Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3-dot menu below each generated media result (image/video/audio) with "Branch in new chat" and "Retry > Try Again / Switch Model" options.

**Architecture:** New `MediaActionsMenu` component renders a popover menu. A central `modelRegistry.ts` maps tool names to available models. `useChat.ts` gets two new handlers (`handleBranchChat`, `handleRetryWithModel`) that are threaded through ChatPanel → ChatMessage → media result components. Tool args and model keys are captured on `UIChatMessage` during execution for replay.

**Tech Stack:** React 18, TypeScript, inline styles (matching existing pattern), existing tool registry for execution.

---

## File Structure

### New Files
- `src/tools/shared/modelRegistry.ts` — Central model lookup: tool name → available models
- `src/components/chat/MediaActionsMenu.tsx` — 3-dot popover menu component

### Modified Files
- `src/types/chat.ts` — Add `toolArgs`, `toolModelKey` fields to `UIChatMessage`
- `src/hooks/useChat.ts` — Capture tool args on messages; expose `retryToolExecution` handler
- `src/components/chat/ChatMessage.tsx` — Pass menu handlers to media result components; render `MediaActionsMenu`
- `src/components/chat/ChatPanel.tsx` — Wire up `onBranchChat` + `onRetry` from ChatPage; pass to ChatMessage
- `src/pages/ChatPage.tsx` — Implement `handleBranchChat` (session creation) and pass to ChatPanel

---

## Chunk 1: Data Layer

### Task 1: Add `toolArgs` and `toolModelKey` to UIChatMessage

**Files:**
- Modify: `src/types/chat.ts:10-37`

- [ ] **Step 1: Add new fields to UIChatMessage**

In `src/types/chat.ts`, add two new optional fields after `modelName` (line 34):

```typescript
  /** Original tool arguments used for this result (for retry/switch model) */
  toolArgs?: Record<string, unknown>;
  /** Model key used for this result (e.g. "z-turbo", "qwen-lightning") */
  toolModelKey?: string;
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS (new optional fields don't break anything)

- [ ] **Step 3: Commit**

```bash
git add src/types/chat.ts
git commit -m "feat: add toolArgs and toolModelKey fields to UIChatMessage"
```

### Task 2: Capture tool args in useChat.ts

**Files:**
- Modify: `src/hooks/useChat.ts:505-524` (onToolCall callback)
- Modify: `src/hooks/useChat.ts:614-725` (onToolComplete callback)

The `onToolCall` callback receives `toolName` and `_args` but currently discards `_args`. We need to:
1. Store args on the streaming message when the tool is called
2. Extract the model key from args and store it on the message when the tool completes

- [ ] **Step 1: Store tool args in onToolCall**

In `src/hooks/useChat.ts`, the `onToolCall` callback (around line 505) currently stores toolProgress but not the args. Change:

```typescript
onToolCall: (toolName: ToolName, _args: Record<string, unknown>) => {
```

to:

```typescript
onToolCall: (toolName: ToolName, toolCallArgs: Record<string, unknown>) => {
```

And in the `setUIMessages` updater inside that callback, add `toolArgs` to the message:

```typescript
? {
    ...msg,
    toolArgs: toolCallArgs,
    toolProgress: {
      type: 'started',
      toolName,
      totalCount: 0,
    },
  }
```

- [ ] **Step 2: Extract model key in onToolComplete**

In the `onToolComplete` callback (around line 674), where it already extracts `srcUrl`, `vidAR`, `mdlName` from `toolProgress`, also extract the model key from `toolArgs`. Add after the `mdlName` extraction:

```typescript
const toolModelKey = msg.toolArgs?.model as string
  || msg.toolArgs?.videoModel as string
  || undefined;
```

And include it in the returned object:

```typescript
return {
  ...msg,
  imageResults: !isAudioTool && uniqueUrls.length > 0 ? uniqueUrls : undefined,
  videoResults: uniqueVideoUrls.length > 0 ? uniqueVideoUrls : undefined,
  audioResults: isAudioTool && uniqueUrls.length > 0 ? uniqueUrls : undefined,
  toolProgress: null,
  sourceImageUrl: srcUrl || undefined,
  videoAspectRatio: vidAR || undefined,
  modelName: mdlName || undefined,
  toolModelKey,
};
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useChat.ts
git commit -m "feat: capture tool args and model key on chat messages"
```

### Task 3: Create model registry

**Files:**
- Create: `src/tools/shared/modelRegistry.ts`
- Modify: `src/tools/shared/index.ts` (re-export)

- [ ] **Step 1: Create modelRegistry.ts**

Create `src/tools/shared/modelRegistry.ts` with model options extracted from each tool's handler:

```typescript
/**
 * Central model registry — maps tool names to their available generation models.
 * Used by the MediaActionsMenu to show alternative model options for retry.
 *
 * Model keys and display names are extracted from each tool handler's model configs.
 * When a handler adds/removes models, update this registry to match.
 */

export interface ModelOption {
  key: string;
  displayName: string;
}

/**
 * Map of tool names to their available generation models.
 * Tools not listed here (or with only 1 model) won't show "Switch Model" in the menu.
 */
const TOOL_MODELS: Record<string, ModelOption[]> = {
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
  generate_video: [
    { key: 'ltx23', displayName: 'LTX 2.3 22B' },
    { key: 'wan22', displayName: 'WAN 2.2 14B' },
  ],
  animate_photo: [
    { key: 'ltx23', displayName: 'LTX 2.3 22B' },
    { key: 'wan22', displayName: 'WAN 2.2 14B' },
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

/** Get the model arg key name used by a given tool ("model" or "videoModel") */
export function getModelArgKey(toolName: string): string {
  const videoModelTools = ['generate_video', 'animate_photo', 'sound_to_video'];
  return videoModelTools.includes(toolName) ? 'videoModel' : 'model';
}

/** Get all available models for a tool. Returns empty array if tool has no model options. */
export function getModelOptions(toolName: string): ModelOption[] {
  return TOOL_MODELS[toolName] ?? [];
}

/** Get alternative models (excludes the currently used model). */
export function getAlternativeModels(toolName: string, currentModelKey?: string): ModelOption[] {
  const all = getModelOptions(toolName);
  if (!currentModelKey) return all;
  return all.filter(m => m.key !== currentModelKey);
}
```

- [ ] **Step 2: Re-export from shared/index.ts**

Add to `src/tools/shared/index.ts`:

```typescript
export { getModelOptions, getAlternativeModels, getModelArgKey } from './modelRegistry';
export type { ModelOption } from './modelRegistry';
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/tools/shared/modelRegistry.ts src/tools/shared/index.ts
git commit -m "feat: add central model registry for media actions menu"
```

---

## Chunk 2: UI Component

### Task 4: Create MediaActionsMenu component

**Files:**
- Create: `src/components/chat/MediaActionsMenu.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/chat/MediaActionsMenu.tsx`:

```typescript
/**
 * 3-dot actions menu for generated media results.
 * Shows "Branch in new chat" and "Retry" options with model switching.
 */
import { memo, useState, useCallback, useEffect, useRef } from 'react';
import type { UIChatMessage } from '@/types/chat';
import { getModelOptions, getAlternativeModels, getModelArgKey } from '@/tools/shared/modelRegistry';
import type { ModelOption } from '@/tools/shared/modelRegistry';

interface MediaActionsMenuProps {
  message: UIChatMessage;
  onBranchChat: (message: UIChatMessage) => void;
  onRetry: (message: UIChatMessage, modelKey?: string) => void;
}

export const MediaActionsMenu = memo(function MediaActionsMenu({
  message,
  onBranchChat,
  onRetry,
}: MediaActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [showRetrySubmenu, setShowRetrySubmenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const toolName = message.lastCompletedTool;
  const currentModelKey = message.toolModelKey;

  // Get model options for the tool
  const allModels = toolName ? getModelOptions(toolName) : [];
  const alternativeModels = toolName ? getAlternativeModels(toolName, currentModelKey) : [];
  const hasModelOptions = allModels.length > 1;
  const hasToolArgs = !!message.toolArgs && !!toolName;

  // Close menu on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowRetrySubmenu(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setShowRetrySubmenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(prev => !prev);
    setShowRetrySubmenu(false);
  }, []);

  const handleBranch = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    onBranchChat(message);
  }, [message, onBranchChat]);

  const handleTryAgain = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    setShowRetrySubmenu(false);
    onRetry(message);
  }, [message, onRetry]);

  const handleSwitchModel = useCallback((e: React.MouseEvent, modelKey: string) => {
    e.stopPropagation();
    setOpen(false);
    setShowRetrySubmenu(false);
    onRetry(message, modelKey);
  }, [message, onRetry]);

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'inline-flex' }}>
      {/* 3-dot trigger button */}
      <button
        ref={buttonRef}
        onClick={handleToggle}
        aria-label="Media actions"
        aria-expanded={open}
        style={{
          background: 'none',
          border: 'none',
          padding: '4px',
          cursor: 'pointer',
          color: 'var(--color-text-tertiary)',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'color 0.15s, background 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = '#ececec';
          e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
        }}
        onMouseLeave={(e) => {
          if (!open) {
            e.currentTarget.style.color = 'var(--color-text-tertiary)';
            e.currentTarget.style.background = 'none';
          }
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {open && (
        <div
          style={{
            position: 'absolute',
            bottom: 'calc(100% + 4px)',
            left: 0,
            background: '#2a2a2a',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '0.5rem',
            boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
            zIndex: 50,
            minWidth: '200px',
            overflow: 'visible',
            padding: '4px 0',
          }}
        >
          {/* Branch in new chat */}
          <MenuItem
            icon={<BranchIcon />}
            label="Branch in new chat"
            onClick={handleBranch}
          />

          {/* Retry section — only if we have tool args */}
          {hasToolArgs && (
            <>
              <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />

              {hasModelOptions ? (
                /* Retry with submenu */
                <div
                  style={{ position: 'relative' }}
                  onMouseEnter={() => setShowRetrySubmenu(true)}
                  onMouseLeave={() => setShowRetrySubmenu(false)}
                >
                  <MenuItem
                    icon={<RetryIcon />}
                    label="Retry"
                    hasSubmenu
                    onClick={(e) => { e.stopPropagation(); setShowRetrySubmenu(prev => !prev); }}
                  />

                  {/* Retry submenu */}
                  {showRetrySubmenu && (
                    <div
                      style={{
                        position: 'absolute',
                        left: 'calc(100% + 4px)',
                        top: 0,
                        background: '#2a2a2a',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: '0.5rem',
                        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                        zIndex: 51,
                        minWidth: '200px',
                        padding: '4px 0',
                      }}
                    >
                      {/* Try Again */}
                      <MenuItem
                        icon={<RetryIcon />}
                        label="Try again"
                        onClick={handleTryAgain}
                      />

                      <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />

                      {/* Model label */}
                      <div style={{
                        padding: '4px 12px',
                        fontSize: '0.6875rem',
                        color: '#666',
                        fontWeight: 500,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}>
                        Switch model
                      </div>

                      {/* Model options */}
                      {allModels.map((model) => (
                        <ModelMenuItem
                          key={model.key}
                          model={model}
                          isCurrent={model.key === currentModelKey}
                          onClick={handleSwitchModel}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* Simple retry (no model options) */
                <MenuItem
                  icon={<RetryIcon />}
                  label="Try again"
                  onClick={handleTryAgain}
                />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MenuItem({ icon, label, onClick, hasSubmenu }: {
  icon: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent) => void;
  hasSubmenu?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '8px 12px',
        background: 'transparent',
        border: 'none',
        color: '#d4d4d4',
        fontSize: '0.8125rem',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 0.1s',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      <span style={{ display: 'flex', flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {hasSubmenu && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.5 }}>
          <polyline points="9 18 15 12 9 6" />
        </svg>
      )}
    </button>
  );
}

function ModelMenuItem({ model, isCurrent, onClick }: {
  model: ModelOption;
  isCurrent: boolean;
  onClick: (e: React.MouseEvent, key: string) => void;
}) {
  return (
    <button
      onClick={(e) => onClick(e, model.key)}
      disabled={isCurrent}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '8px 12px',
        background: 'transparent',
        border: 'none',
        color: isCurrent ? 'var(--color-accent)' : '#d4d4d4',
        fontSize: '0.8125rem',
        cursor: isCurrent ? 'default' : 'pointer',
        textAlign: 'left',
        transition: 'background 0.1s',
        opacity: isCurrent ? 0.8 : 1,
      }}
      onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
    >
      {isCurrent ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <span style={{ width: 14, flexShrink: 0 }} />
      )}
      <span>{model.displayName}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function BranchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/MediaActionsMenu.tsx
git commit -m "feat: add MediaActionsMenu component with retry and branch actions"
```

---

## Chunk 3: Integration

### Task 5: Integrate MediaActionsMenu into ChatMessage

**Files:**
- Modify: `src/components/chat/ChatMessage.tsx:17-30` (props interface)
- Modify: `src/components/chat/ChatMessage.tsx:259-304` (media result rendering)

- [ ] **Step 1: Add new props to ChatMessage**

In `src/components/chat/ChatMessage.tsx`, add to the `ChatMessageProps` interface:

```typescript
interface ChatMessageProps {
  message: UIChatMessage;
  imageUrl?: string | null;
  onImageClick?: (url: string, index: number) => void;
  onCancelTool?: () => void;
  onAcceptModelSwitch?: () => void;
  onDeclineModelSwitch?: () => void;
  downloadSlug?: string;
  /** Called when user clicks "Branch in new chat" from media actions menu */
  onBranchChat?: (message: UIChatMessage) => void;
  /** Called when user clicks "Try again" or selects a model from media actions menu */
  onRetry?: (message: UIChatMessage, modelKey?: string) => void;
}
```

Update the destructuring in the component function signature to include `onBranchChat` and `onRetry`.

- [ ] **Step 2: Import and render MediaActionsMenu**

Add import at the top of `ChatMessage.tsx`:

```typescript
import { MediaActionsMenu } from './MediaActionsMenu';
```

For each media result section (images, videos, audio), add the `MediaActionsMenu` **below** the media and below the modelName label. The menu should appear in the same wrapper div that contains the media results. It replaces the standalone `modelName` display with a row containing both.

Replace the three media sections (image results ~lines 260-277, video results ~lines 281-290, audio results ~lines 293-304) to include the menu. Each section should follow this pattern — here's the image results section as example:

```tsx
{/* Image results */}
{message.imageResults && message.imageResults.length > 0 && (
  <div style={{ maxWidth: '85%', width: '100%' }}>
    <LazyMedia enabled={!!message.isFromHistory} placeholderHeight={200}>
      <ChatImageResults
        urls={message.imageResults}
        sourceImageUrl={message.sourceImageUrl || imageUrl || undefined}
        onImageClick={onImageClick}
        galleryImageIds={message.galleryImageIds}
        downloadSlug={downloadSlug}
      />
    </LazyMedia>
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
      {onBranchChat && onRetry && (
        <MediaActionsMenu message={message} onBranchChat={onBranchChat} onRetry={onRetry} />
      )}
      {message.modelName && (
        <span style={{ fontSize: '0.625rem', color: 'var(--color-text-tertiary)', opacity: 0.6 }}>
          {message.modelName}
        </span>
      )}
    </div>
  </div>
)}
```

Apply the same pattern to video and audio results. For video, be careful to keep the `!message.toolProgress` guard on the outer conditional.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ChatMessage.tsx
git commit -m "feat: integrate MediaActionsMenu into ChatMessage media sections"
```

### Task 6: Wire up ChatPanel to pass handlers

**Files:**
- Modify: `src/components/chat/ChatPanel.tsx:28-72` (ChatPanelProps interface)
- Modify: `src/components/chat/ChatPanel.tsx:728-745` (ChatMessage rendering)

- [ ] **Step 1: Add props to ChatPanelProps**

In `src/components/chat/ChatPanel.tsx`, add to the `ChatPanelProps` interface:

```typescript
/** Called when user clicks "Branch in new chat" in media actions menu */
onBranchChat?: (message: UIChatMessage) => void;
/** Called when user clicks "Try again" or switches model in media actions menu */
onRetry?: (message: UIChatMessage, modelKey?: string) => void;
```

Add them to the destructured props in the `ChatPanel` function.

- [ ] **Step 2: Pass handlers to ChatMessage**

In the `paginatedMessages.map()` rendering (around line 734), add the new props to the `ChatMessage` component:

```tsx
<ChatMessage
  key={msg.id}
  message={msg}
  imageUrl={imageUrl}
  onImageClick={handleImageClick}
  onCancelTool={msg.toolProgress ? chat.cancelToolExecution : undefined}
  onAcceptModelSwitch={msg.modelRefusal ? handleAcceptModelSwitch : undefined}
  onDeclineModelSwitch={msg.modelRefusal ? chat.declineModelSwitch : undefined}
  downloadSlug={downloadSlug}
  onBranchChat={onBranchChat}
  onRetry={onRetry}
/>
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/ChatPanel.tsx
git commit -m "feat: thread media action handlers through ChatPanel to ChatMessage"
```

### Task 7: Implement handleBranchChat in ChatPage

**Files:**
- Modify: `src/pages/ChatPage.tsx`

- [ ] **Step 1: Implement handleBranchChat**

In `ChatPage.tsx`, add a `handleBranchChat` callback. This function:
1. Finds the index of the target message in current messages
2. Copies all messages up to and including that message
3. Creates a new session with those messages
4. Saves and switches to the new session

```typescript
const handleBranchChat = useCallback(async (message: UIChatMessage) => {
  const currentMessages = chat.messages;
  const messageIndex = currentMessages.findIndex(m => m.id === message.id);
  if (messageIndex < 0) return;

  // Copy messages up to and including the target
  const branchedMessages = currentMessages.slice(0, messageIndex + 1);

  // Get conversation state from chat hook
  const sessionState = chat.getSessionState();
  // Trim conversation to match message count (approximate — conversation entries
  // don't 1:1 match UI messages, but we need some context)
  const branchedConversation = sessionState.conversation;

  // Collect result URLs from branched messages
  const branchedResultUrls: string[] = [];
  for (const msg of branchedMessages) {
    if (msg.imageResults) branchedResultUrls.push(...msg.imageResults);
    if (msg.videoResults) branchedResultUrls.push(...msg.videoResults);
    if (msg.audioResults) branchedResultUrls.push(...msg.audioResults);
  }

  // Create session
  const newId = createNewSession();
  const newSession: ChatSession = {
    id: newId,
    title: sessionTitleRef.current || 'Branched Chat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    uiMessages: branchedMessages,
    conversation: branchedConversation,
    allResultUrls: [...new Set(branchedResultUrls)],
    analysisSuggestions: [],
  };

  await saveCurrentSession(newId, newSession);
  await switchSession(newId);
}, [chat, createNewSession, saveCurrentSession, switchSession]);
```

- [ ] **Step 2: Pass handleBranchChat to ChatPanel**

Add `onBranchChat={handleBranchChat}` to the `<ChatPanel>` JSX in ChatPage.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/pages/ChatPage.tsx
git commit -m "feat: implement branch-in-new-chat handler in ChatPage"
```

### Task 8: Implement handleRetry in ChatPage

**Files:**
- Modify: `src/pages/ChatPage.tsx`
- Modify: `src/hooks/useChat.ts` (add `retryToolExecution` to UseChatResult)

The retry action needs to directly invoke a tool with the stored args. This requires access to the tool execution infrastructure in `useChat.ts`.

- [ ] **Step 1: Add retryToolExecution to useChat**

In `src/hooks/useChat.ts`, add a new function to `UseChatResult` interface:

```typescript
/** Retry a tool execution with optional model override */
retryToolExecution: (
  message: UIChatMessage,
  context: {
    sogniClient: SogniClient;
    imageData: Uint8Array | null;
    width: number;
    height: number;
    tokenType: TokenType;
    balances: Balances | null;
    qualityTier?: 'fast' | 'hq';
    safeContentFilter?: boolean;
    onContentFilterChange?: (enabled: boolean) => void;
    uploadedFiles?: UploadedFile[];
    onTokenSwitch?: (newType: TokenType) => void;
    onInsufficientCredits?: () => void;
    modelVariantId?: string;
  },
  modelKeyOverride?: string,
) => Promise<void>;
```

Then implement it inside the `useChat` hook. The function should:
1. Build a synthetic user message: "Retry [tool_name]" (or "Retry with [model_name]")
2. Build tool args from `message.toolArgs`, overriding the model key if specified
3. Call `sendMessage` with the content, which triggers the LLM — but since we want to bypass the LLM and directly call the tool, we need a simpler approach.

**Simpler approach:** Instead of bypassing the LLM, send a natural language message asking the LLM to use the specific tool with the specific model. The LLM is designed to call tools. For "Try Again", send the same prompt. For "Switch Model", tell the LLM to use the specific model.

Actually, the most reliable approach is to directly execute the tool using `toolRegistry.execute()` and wire the results into the message stream, reusing the existing `onToolCall`, `onToolProgress`, `onToolComplete` patterns.

Let me use a pragmatic middle ground: add a `retryToolExecution` that creates a user message, a streaming assistant message, calls the tool directly via `toolRegistry.execute()`, and handles the result.

```typescript
const retryToolExecution = useCallback(
  async (
    targetMessage: UIChatMessage,
    context: {
      sogniClient: SogniClient;
      imageData: Uint8Array | null;
      width: number;
      height: number;
      tokenType: TokenType;
      balances: Balances | null;
      qualityTier?: 'fast' | 'hq';
      safeContentFilter?: boolean;
      onContentFilterChange?: (enabled: boolean) => void;
      uploadedFiles?: UploadedFile[];
      onTokenSwitch?: (newType: TokenType) => void;
      onInsufficientCredits?: () => void;
      modelVariantId?: string;
    },
    modelKeyOverride?: string,
  ) => {
    const toolName = targetMessage.lastCompletedTool as ToolName;
    const toolArgs = targetMessage.toolArgs;
    if (!toolName || !toolArgs) return;

    // Build modified args with model override
    const modifiedArgs = { ...toolArgs };
    if (modelKeyOverride) {
      const videoModelTools = ['generate_video', 'animate_photo', 'sound_to_video'];
      const argKey = videoModelTools.includes(toolName) ? 'videoModel' : 'model';
      modifiedArgs[argKey] = modelKeyOverride;
    }

    // Import toolRegistry dynamically to avoid circular dependency
    const { toolRegistry } = await import('@/tools/registry');

    setError(null);
    setIsLoading(true);
    setIsSending(true);

    // Add user message
    const userMsgId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const modelLabel = modelKeyOverride
      ? `Retry with different model`
      : 'Retry generation';
    const userMsg: UIChatMessage = {
      id: userMsgId,
      role: 'user',
      content: modelLabel,
      timestamp: Date.now(),
    };

    // Add streaming assistant message
    const assistantMsgId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const assistantMsg: UIChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      isStreaming: true,
      toolArgs: modifiedArgs,
      toolProgress: { type: 'started', toolName, totalCount: 0 },
    };

    setUIMessages(prev => [...prev, userMsg, assistantMsg]);

    const variant = context.modelVariantId ? getVariantById(context.modelVariantId) : undefined;
    const effectiveModel = sessionModelRef.current || (variant ? variant.modelId : undefined);
    const effectiveThink = variant?.think;

    const toolAbortController = new AbortController();
    const controllersSet = toolAbortControllersRef.current;
    controllersSet.add(toolAbortController);

    const executionContext: ToolExecutionContext = {
      sogniClient: context.sogniClient,
      imageData: context.imageData,
      width: context.width,
      height: context.height,
      tokenType: context.tokenType,
      uploadedFiles: context.uploadedFiles || [],
      get resultUrls() { return allResultUrlsRef.current; },
      get audioResultUrls() { return audioResultUrlsRef.current; },
      balances: context.balances,
      qualityTier: context.qualityTier,
      safeContentFilter: context.safeContentFilter,
      onContentFilterChange: context.onContentFilterChange,
      onTokenSwitch: context.onTokenSwitch,
      onInsufficientCredits: context.onInsufficientCredits,
      signal: toolAbortController.signal,
      model: effectiveModel,
      think: effectiveThink,
    };

    let retryResultUrls: string[] = [];
    let retryVideoUrls: string[] = [];

    const callbacks: ToolCallbacks = {
      onToolProgress: (progress) => {
        if (progress.resultUrls) {
          retryResultUrls = [...new Set([...retryResultUrls, ...progress.resultUrls])];
        }
        if (progress.videoResultUrls) {
          retryVideoUrls = [...new Set([...retryVideoUrls, ...progress.videoResultUrls])];
        }
        setUIMessages(prev => prev.map(msg => {
          if (msg.id !== assistantMsgId) return msg;
          const prev = msg.toolProgress;
          const merged: ToolExecutionProgress = progress.type === 'started'
            ? progress
            : {
                ...prev,
                ...progress,
                progress: progress.progress ?? prev?.progress,
                etaSeconds: progress.etaSeconds ?? prev?.etaSeconds,
                estimatedCost: progress.estimatedCost ?? prev?.estimatedCost,
                sourceImageUrl: progress.sourceImageUrl ?? prev?.sourceImageUrl,
                videoAspectRatio: progress.videoAspectRatio ?? prev?.videoAspectRatio,
                modelName: progress.modelName ?? prev?.modelName,
              };
          const videoResults = retryVideoUrls.length > 0 ? [...retryVideoUrls] : msg.videoResults;
          return { ...msg, toolProgress: merged, videoResults };
        }));
      },
      onToolComplete: (completedToolName, resultUrls, videoResultUrls) => {
        retryResultUrls = [...new Set([...retryResultUrls, ...resultUrls])];
        if (videoResultUrls) {
          retryVideoUrls = [...new Set([...retryVideoUrls, ...videoResultUrls])];
        }

        const isAudioTool = completedToolName === 'generate_music';
        setUIMessages(prev => prev.map(msg => {
          if (msg.id !== assistantMsgId) return msg;
          const srcUrl = msg.toolProgress?.sourceImageUrl;
          const vidAR = msg.toolProgress?.videoAspectRatio;
          const mdlName = msg.toolProgress?.modelName;
          const toolModelKey = modifiedArgs.model as string || modifiedArgs.videoModel as string || undefined;
          return {
            ...msg,
            imageResults: !isAudioTool && retryResultUrls.length > 0 ? retryResultUrls : undefined,
            videoResults: retryVideoUrls.length > 0 ? retryVideoUrls : undefined,
            audioResults: isAudioTool && retryResultUrls.length > 0 ? retryResultUrls : undefined,
            toolProgress: null,
            isStreaming: false,
            lastCompletedTool: completedToolName,
            sourceImageUrl: srcUrl || undefined,
            videoAspectRatio: vidAR || undefined,
            modelName: mdlName || undefined,
            toolModelKey,
            content: '',
          };
        }));

        // Update result URLs
        if (retryResultUrls.length > 0) {
          const combined = [...new Set([...allResultUrlsRef.current, ...retryResultUrls])];
          allResultUrlsRef.current = combined;
          setAllResultUrls(combined);
        }
        if (isAudioTool && retryResultUrls.length > 0) {
          audioResultUrlsRef.current = [...new Set([...audioResultUrlsRef.current, ...retryResultUrls])];
        }
      },
      onGallerySaved: (galleryImageIds, galleryVideoIds) => {
        setUIMessages(prev => applyGalleryIdsToMessages(prev, galleryImageIds, galleryVideoIds));
        const effectiveSessionId = sessionIdRef.current;
        if (effectiveSessionId) {
          onBackgroundGallerySavedRef.current?.(effectiveSessionId, galleryImageIds, galleryVideoIds);
        }
      },
    };

    try {
      const result = await toolRegistry.execute(toolName, modifiedArgs, executionContext, callbacks);
      // If the tool returned an error result and onToolComplete wasn't called, clean up
      try {
        const parsed = JSON.parse(result);
        if (parsed.error) {
          setUIMessages(prev => prev.map(msg =>
            msg.id === assistantMsgId
              ? { ...msg, content: `Error: ${parsed.error}`, isStreaming: false, toolProgress: null }
              : msg,
          ));
        }
      } catch { /* not JSON, ignore */ }
    } catch (err: any) {
      setError(err.message || 'Retry failed');
      setUIMessages(prev => prev.map(msg =>
        msg.id === assistantMsgId
          ? { ...msg, content: 'Retry failed', isStreaming: false, toolProgress: null }
          : msg,
      ));
    } finally {
      controllersSet.delete(toolAbortController);
      setIsLoading(false);
      setIsSending(false);
    }
  },
  [],
);
```

Add `retryToolExecution` to the returned object from `useChat`.

- [ ] **Step 2: Create handleRetry in ChatPage**

In `ChatPage.tsx`, add:

```typescript
const handleRetry = useCallback(async (message: UIChatMessage, modelKey?: string) => {
  if (!sogniClient) return;
  await chat.retryToolExecution(message, {
    sogniClient,
    imageData,
    width,
    height,
    tokenType,
    balances,
    qualityTier,
    safeContentFilter,
    onContentFilterChange: setSafeContentFilter,
    uploadedFiles,
    onTokenSwitch: handleTokenSwitch,
    onInsufficientCredits: handleInsufficientCredits,
    modelVariantId: selectedModelVariant,
  }, modelKey);
}, [chat, sogniClient, imageData, width, height, tokenType, balances, qualityTier, safeContentFilter, setSafeContentFilter, uploadedFiles, handleTokenSwitch, handleInsufficientCredits, selectedModelVariant]);
```

Pass to ChatPanel: `onRetry={handleRetry}`.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useChat.ts src/pages/ChatPage.tsx
git commit -m "feat: implement retry tool execution with model switching"
```

---

## Chunk 4: Polish & Edge Cases

### Task 9: Handle edge cases and cleanup

**Files:**
- Modify: `src/hooks/useChat.ts:126-137` (cleanForStorage — preserve toolArgs/toolModelKey)

- [ ] **Step 1: Preserve toolArgs and toolModelKey in storage**

In `useChat.ts`, the `cleanForStorage` function strips transient fields. `toolArgs` and `toolModelKey` should NOT be stripped — they're needed for retry after session restore. Verify they're not listed in the cleanup. Currently the function strips: `toolProgress`, `isStreaming`, `streamingStatus`, `chatModelLabel`, `uploadedImageUrl`, `uploadedImageUrls`, `isFromHistory`. `toolArgs` and `toolModelKey` are not stripped, so no change needed here — just verify.

- [ ] **Step 2: Verify dev server**

Run: `npm run dev` (in one terminal)
Run: `npm run server:dev` (in another terminal)
Manually test: generate an image, check that 3-dot menu appears below it.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: PASS (or at most 16 warnings, the allowed maximum)

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: media actions menu with branch/retry/switch model for generated media"
```
