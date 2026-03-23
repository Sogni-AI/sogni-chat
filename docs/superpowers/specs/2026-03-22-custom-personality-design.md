# Custom LLM Personality

## Summary

Allow users to customize the chat LLM's personality via a freeform text field. The instruction persists across sessions and is injected into the system prompt at runtime.

## Data Model

New `personality` string stored in IndexedDB (sogni_user_data store). Schema:

```typescript
interface PersonalityPreference {
  id: string;           // always 'default' (singleton)
  instruction: string;  // user's freeform text
  updatedAt: number;
}
```

When empty or absent, the default ROLE section in `CHAT_SYSTEM_PROMPT` applies unchanged.

## System Prompt Injection

In `chatService.ts`, after building persona and memory context, if a personality instruction exists, append:

```
PERSONALITY OVERRIDE: The user has requested you adopt the following personality: "{instruction}".
Maintain this personality while following all other instructions above.
```

This layers on top of the existing ROLE baseline. Tool behavior, priorities, output rules, and hard constraints remain intact.

## UI

### Menu Item

New "Personality" entry in `AuthStatus.tsx` dropdown, positioned near the existing Memories item. Uses a user/sparkles-style icon.

### Slide-Out Panel

New `PersonalityPanel.tsx` — a right-side slide-out panel (consistent with MemoryViewer and PersonaEditorPanel patterns):

- **Textarea**: freeform input for the personality instruction
- **Hint text**: "Describe how you'd like the AI to talk to you"
- **Save button**: persists to IndexedDB
- **Reset to Default button**: clears the stored personality, reverting to the hardcoded ROLE

## Files to Modify

| File | Change |
|------|--------|
| `src/types/userData.ts` | Add `PersonalityPreference` interface |
| `src/utils/userDataDB.ts` | Add `getPersonality()` / `savePersonality()` / `clearPersonality()` functions |
| `src/components/personality/PersonalityPanel.tsx` | New slide-out panel component |
| `src/components/auth/AuthStatus.tsx` | Add menu item + panel state |
| `src/services/chatService.ts` | Read personality from DB, inject into dynamic system prompt |

## Edge Cases

- **Empty string**: treated as "no personality set" — default ROLE applies
- **Very long input**: no hard limit enforced in UI, but token budget in context window will naturally constrain. Could add a soft character limit (e.g., 500 chars) with a warning.
- **Mid-conversation changes**: personality change takes effect on the next message sent (system prompt is rebuilt each message)
