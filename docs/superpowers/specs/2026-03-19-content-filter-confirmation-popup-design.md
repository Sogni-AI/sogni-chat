# Content Filter Confirmation Popup

**Date**: 2026-03-19
**Status**: Approved

## Overview

Add a confirmation popup when users attempt to disable the safe content filter. The popup requires age verification and terms acceptance before proceeding. Users can optionally choose to disable the filter permanently; otherwise, it is only disabled for the current browser session.

## Problem

Currently, disabling the safe content filter happens immediately with no confirmation, both via the AuthStatus dropdown toggle and via the LLM's `set_content_filter` tool call. There is no age verification gate, no terms acceptance, and no distinction between session-only and permanent disabling.

## Design

### Component: `DisableContentFilterPopup`

**File**: `src/components/content-filter/DisableContentFilterPopup.tsx`

**Props**:
```typescript
interface DisableContentFilterPopupProps {
  isOpen: boolean;
  onConfirm: (permanent: boolean) => void;
  onCancel: () => void;
}
```

**UI elements** (matching the reference screenshot):
- Title: "Disable Safe Content Filter"
- Warning text: "Please ensure that you are at least 18 years old and that you agree to Sogni Terms & Conditions." (link to terms)
- Additional warning: "Additionally, refrain from exposing unfiltered results to the public. Disabling the safe content filter may lead to the display of undesirable content that could be disturbing to viewers."
- Toggle 1: "I'm over 18 years old and have read and accepted Sogni's Terms & Conditions."
- Toggle 2 (new): "Leave Safe Content Filter off permanently"
- Continue button with eye icon — disabled until Toggle 1 is on
- X close button (top right)

**Behavior**:
- Escape key and click-outside dismiss the popup (calls `onCancel`)
- Continue button calls `onConfirm(permanent)` where `permanent` is the state of Toggle 2
- Toggle 2 defaults to off (session-only by default)

**Styling**: Dark modal with backdrop blur, consistent with existing popups (`OutOfCreditsPopup`). Uses `popupSlideIn` animation, z-index 100000, Tailwind + inline styles following project conventions.

### Storage: Session vs Permanent

**Files changed**: `src/config/contentFilterPreset.ts`

Current state:
- `localStorage` key `sogni:safeContentFilter` stores the filter state permanently

New behavior:
- **Permanent disable**: Writes `false` to `localStorage` key `sogni:safeContentFilter` (existing behavior)
- **Session-only disable**: Writes `false` to `sessionStorage` key `sogni:safeContentFilter:session`. Clears any `localStorage` override so it doesn't persist beyond the session.
- **Re-enabling**: Clears both `localStorage` and `sessionStorage` keys, reverting to default (enabled)

Updated functions:
```typescript
// Checks localStorage first, then sessionStorage. Default: true (enabled)
function getSavedContentFilter(): boolean

// When enabled=false: writes to localStorage (permanent=true) or sessionStorage (permanent=false/undefined)
// When enabled=true: clears both localStorage and sessionStorage keys, reverting to default (enabled)
function saveContentFilter(enabled: boolean, permanent?: boolean): void
```

**Re-enable semantics**: `saveContentFilter(true)` always clears both storage keys. The `permanent` parameter is only meaningful when disabling. This avoids ambiguity about what `saveContentFilter(true, false)` would mean.

`sessionStorage` persists across page refreshes within the same browser session but clears when the browser is fully closed — matching the desired "session-only" behavior.

### Shared Confirmation Flow

**Files changed**: `src/layouts/AppLayout.tsx`, `src/context/LayoutContext.tsx` (or wherever `LayoutContextValue` is defined)

`AppLayout` holds the popup state and exposes a confirmation function via layout context:

```typescript
// Added to LayoutContextValue
requestDisableContentFilter: () => Promise<boolean>;
```

**Implementation pattern** — uses a ref-held resolver to bridge the React popup with the Promise-based API:

```typescript
const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);

const requestDisableContentFilter = useCallback(() => {
  // Guard against concurrent requests — reuse existing popup
  if (resolverRef.current) {
    return new Promise<boolean>(() => {}); // wait for existing popup
  }
  return new Promise<boolean>((resolve) => {
    resolverRef.current = resolve;
    setShowDisableFilterPopup(true);
  });
}, []);

const handleFilterConfirm = (permanent: boolean) => {
  saveContentFilter(false, permanent);
  setSafeContentFilterState(false);
  setShowDisableFilterPopup(false);
  resolverRef.current?.(true);
  resolverRef.current = null;
};

const handleFilterCancel = () => {
  setShowDisableFilterPopup(false);
  resolverRef.current?.(false);
  resolverRef.current = null;
};
```

**Key detail**: `requestDisableContentFilter` handles all side effects internally (storage write + React state update). Callers only need to check the returned boolean to know if the filter was successfully disabled. The tool handler should NOT also call `saveContentFilter` when disabling — the popup flow already did it.

Both trigger paths call this single function.

**Concurrent requests**: If a second request arrives while the popup is already open, it returns a pending Promise that never resolves (the existing popup handles the first request). This prevents duplicate popups.

**Popup re-display**: Every time the user attempts to disable the filter, the popup is shown — even if they previously confirmed permanently. The permanent flag only controls persistence across browser sessions, not whether the popup is skipped. This ensures age verification is always gated.

### AuthStatus Toggle Integration

**File changed**: `src/components/auth/AuthStatus.tsx`

Current behavior: Toggle directly calls `setSafeContentFilter(!safeContentFilter)`.

New behavior:
- **Enabling the filter** (turning it back on): Calls `setSafeContentFilter(true)` directly (no popup needed)
- **Disabling the filter** (turning it off): Calls `requestDisableContentFilter()` from layout context. If the promise resolves `false`, the toggle stays in the "on" position.

### Tool Handler Integration

**Files changed**: `src/tools/set-content-filter/handler.ts`, `src/tools/types.ts`

Add `requestDisableContentFilter` to `ToolExecutionContext`:
```typescript
interface ToolExecutionContext {
  // ... existing fields
  requestDisableContentFilter?: () => Promise<boolean>;
}
```

Updated handler logic:
1. If `args.enabled === true` (re-enabling filter): proceed as before, no popup needed
2. If `args.enabled === false` (disabling filter):
   - Call `context.requestDisableContentFilter?.()`
   - If returns `false` or function not available: return `{success: false, message: "User declined to disable the content filter"}`
   - If returns `true`: skip the existing `saveContentFilter` and `onContentFilterChange` calls (the popup flow already handled storage + state). Only mutate `context.safeContentFilter = false` for subsequent tool calls in the same loop.

The tool handler `await`s the Promise, so the LLM tool calling loop pauses until the user interacts with the popup.

### Passing Context Through

**File changed**: `src/hooks/useChat.ts` (or `src/components/chat/ChatPanel.tsx`)

When constructing `ToolExecutionContext`, include `requestDisableContentFilter` from the layout context so it's available to the tool handler.

## Files Summary

| File | Change |
|------|--------|
| `src/components/content-filter/DisableContentFilterPopup.tsx` | **New** — Popup component |
| `src/config/contentFilterPreset.ts` | Update — Add sessionStorage logic |
| `src/layouts/AppLayout.tsx` | Update — Add popup state, `requestDisableContentFilter`, render popup |
| `src/tools/types.ts` | Update — Add `requestDisableContentFilter` to context |
| `src/tools/set-content-filter/handler.ts` | Update — Await confirmation before disabling |
| `src/components/auth/AuthStatus.tsx` | Update — Use `requestDisableContentFilter` instead of direct toggle |
| `src/hooks/useChat.ts` or `src/components/chat/ChatPanel.tsx` | Update — Pass `requestDisableContentFilter` in tool context |

## Out of Scope

- Re-enabling confirmation (turning the filter back on requires no popup)
- Changing the popup for the LLM's `set_content_filter` enable path
- Any changes to how the filter value is consumed by tool handlers (they continue reading `context.safeContentFilter`)
