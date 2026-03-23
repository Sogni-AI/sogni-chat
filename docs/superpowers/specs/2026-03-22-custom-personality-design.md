# Custom LLM Personality

## Summary

Allow users to customize the chat LLM's personality via a freeform text field. The instruction persists across sessions and is injected into the system prompt at runtime.

## Data Model

New `personality` object store in IndexedDB. Requires bumping `DB_VERSION` from 1 to 2 with `onupgradeneeded` migration that creates the new store (existing stores are unaffected).

```typescript
interface PersonalityPreference {
  id: string;           // always 'default' (singleton)
  instruction: string;  // user's freeform text
  updatedAt: number;
}
```

When empty or absent, the default ROLE section in `CHAT_SYSTEM_PROMPT` applies unchanged.

## System Prompt Injection

New `buildPersonalityContext()` async helper in `chatService.ts`, called alongside `buildPersonaContext()` and `buildMemoryContext()`. If a personality instruction exists, append to the dynamic system prompt:

```
USER PERSONALITY PREFERENCE: The user has customized your personality as follows: "{instruction}".
Adopt this personality while following all other instructions above.
```

Note: This is user-authored freeform text injected into the system prompt. Since this is a consumer creative tool where the user controls their own experience, prompt injection risk is accepted. The softer "USER PERSONALITY PREFERENCE" label (vs "OVERRIDE") reduces the chance of the LLM treating it as superseding hard constraints.

Token budget impact: a 500-character personality instruction adds ~125-150 tokens, well within the existing 2,048-token safety margin. No adjustment to `TOOL_SCHEMA_TOKENS` needed.

## React Hook

New `src/hooks/usePersonality.ts` following the `useMemories` pattern:
- Loads personality from IndexedDB on mount
- Exposes `personality`, `savePersonality(instruction)`, `clearPersonality()`
- Syncs via custom event `sogni-personality-updated` (same-tab) and `BroadcastChannel` (cross-tab)

## UI

### Menu Item

New "Personality" entry in `AuthStatus.tsx` dropdown, positioned immediately below the existing Memories item. Only accessible from the menu (no external event trigger needed).

### Slide-Out Panel

New `PersonalityPanel.tsx` — a right-side slide-out panel (consistent with MemoryViewer pattern):

- **Textarea**: freeform input for the personality instruction
- **Character counter**: "42 / 500" below the textarea, soft limit with warning styling past 500
- **Hint text**: "Describe how you'd like the AI to talk to you"
- **Save button**: persists to IndexedDB
- **Reset to Default button**: clears the stored personality, reverting to the hardcoded ROLE

## Files to Modify

| File | Change |
|------|--------|
| `src/types/userData.ts` | Add `PersonalityPreference` interface |
| `src/utils/userDataDB.ts` | Bump `DB_VERSION` to 2, add `personality` store in `onupgradeneeded`, add `getPersonality()` / `savePersonality()` / `clearPersonality()` |
| `src/hooks/usePersonality.ts` | New hook: load, save, clear, sync |
| `src/components/personality/PersonalityPanel.tsx` | New slide-out panel component |
| `src/components/auth/AuthStatus.tsx` | Add menu item immediately below Memories + panel state |
| `src/services/chatService.ts` | Add `buildPersonalityContext()`, call it alongside persona/memory context builders |

## Edge Cases

- **Empty string**: treated as "no personality set" — default ROLE applies
- **Soft character limit**: 500 chars with visual warning; no hard block
- **Mid-conversation changes**: personality change takes effect on the next message sent (system prompt is rebuilt each message)
- **Prompt injection**: accepted risk — user controls their own experience
