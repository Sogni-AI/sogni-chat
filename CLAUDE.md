# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Sogni Creative Agent is a standalone AI creative studio powered by the Sogni Client SDK. It provides a conversational interface where users interact with 14 AI tools spanning image generation/editing, video creation, music composition, vision analysis, and settings control. The app uses a tool registry architecture where each AI capability is a self-contained module that self-registers at import time.

## Build & Development Commands

### Setup
```bash
npm install                    # Install frontend dependencies
npm run server:install         # Install backend dependencies (runs automatically via prepare hook)
./scripts/setup-local.sh       # One-time HTTPS setup for local development
```

### Development
```bash
npm run dev                    # Start frontend dev server (Vite on port 5173)
npm run server:dev             # Start backend dev server (Express on port 3006)
```

Run both servers concurrently. Access via `https://chat-local.sogni.ai` (not localhost).

### Build & Deploy
```bash
npm run build                  # TypeScript check + Vite build
npm run build:staging          # Build for staging environment
npm run preview                # Preview production build
npm run server:start           # Start backend in production mode
```

### Linting & Validation
```bash
npm run lint                   # ESLint (max 16 warnings allowed)
npm run validate:useeffect     # Custom useEffect dependency validator
```

## Architecture Overview

**Stack**: React 18 + TypeScript + Vite (frontend), Express (backend), Sogni SDK for AI operations, Tailwind CSS for styling.

### Tool Registry Pattern

The core architectural pattern. Each AI tool is a self-contained folder under `src/tools/`:

```
src/tools/
  registry.ts          # Singleton ToolRegistry class
  types.ts             # ToolHandler, ToolExecutionContext, ToolCallbacks interfaces
  index.ts             # Imports all tools (triggers self-registration)
  shared/              # Shared utilities (credit checks, progress, aspect ratio, etc.)
  restore-photo/       # Each tool is a folder with:
    definition.ts      #   OpenAI-format tool schema (passed to LLM)
    handler.ts         #   execute() function implementing the tool
    index.ts           #   Self-registers with toolRegistry.register()
```

**14 registered tools**:
- `restore_photo` — AI photo restoration (Qwen Image Edit)
- `apply_style` — Artistic style transfer
- `refine_result` — Iterative refinement of previous results
- `animate_photo` — Photo-to-video animation (LTX-2)
- `change_angle` — Novel view synthesis (SV3D)
- `generate_image` — Text-to-image generation (Flux)
- `edit_image` — Instruction-based image editing
- `generate_video` — Text-to-video generation (LTX-2)
- `sound_to_video` — Audio-synced video generation
- `video_to_video` — Video style transfer with ControlNet
- `generate_music` — Music generation with lyrics/BPM/key control (Sonic Logos)
- `analyze_image` — Vision analysis of uploaded images
- `set_content_filter` — Toggle safe content filter on/off
- `extract_metadata` — Extract metadata from generated results

### How to Add a New Tool

1. Create a new folder under `src/tools/` (e.g., `src/tools/my-new-tool/`)
2. Create three files:

**`definition.ts`** — OpenAI function calling schema:
```typescript
import type { ToolDefinition } from '@sogni-ai/sogni-client';
export const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'my_new_tool',
    description: 'What this tool does',
    parameters: {
      type: 'object',
      properties: { /* ... */ },
      required: ['prompt'],
    },
  },
};
```

**`handler.ts`** — Execution logic:
```typescript
import type { ToolExecutionContext, ToolCallbacks } from '../types';
export async function execute(
  args: Record<string, unknown>,
  context: ToolExecutionContext,
  callbacks: ToolCallbacks,
): Promise<string> {
  // Use context.sogniClient for SDK calls
  // Call callbacks.onToolProgress() for progress updates
  // Call callbacks.onToolComplete() when done
  return JSON.stringify({ success: true, urls: [...] });
}
```

**`index.ts`** — Self-registration:
```typescript
import { toolRegistry } from '../registry';
import { definition } from './definition';
import { execute } from './handler';
toolRegistry.register({ definition, execute, suggestions: [...] });
```

3. Add the import to `src/tools/index.ts`
4. Add the tool name to `ToolName` union in `src/tools/types.ts`
5. Add suggestion chips in the tool's `index.ts` (and optionally in `src/utils/chatSuggestions.ts`)

### Chat / LLM Architecture

- **LLM**: Qwen3 via Sogni Creative Agent API (`sogniClient.chat.completions.create()`)
- **Model**: `qwen3.5-35b-a3b-gguf-q4km` (abliterated variant available for refusals)
- **Tool calling**: OpenAI-compatible format. Tools are auto-discovered from the registry.
- **Streaming**: `for await (const chunk of stream)` then `stream.finalResult`
- **Tool calling loop**: Up to 5 rounds (tool call -> execution -> feed result back -> next response)
- **Context window management**: Sliding-window trimming in `src/services/contextWindow.ts`

**System Prompt Design** (critical for Qwen3):
- Keep the system prompt SHORT (~400 chars) — long prompts cause the model to narrate tool calls as text
- Put prompt engineering rules in tool parameter descriptions (in `definition.ts`), not the system prompt
- NEVER instruct the model to "describe" or "mention" what it's about to do

### Dual-Client Authentication

Both frontend and backend maintain separate Sogni SDK clients:

1. **Frontend Client** (`src/services/sogniAuth.ts`): User auth, session state, wallet balances
2. **Backend Client** (`server/services/sogni.js`): Stateless server-side job execution

### Local HTTPS Setup

Required for Sogni SDK authentication:
- **Domain**: `chat-local.sogni.ai` (mapped in `/etc/hosts`)
- **Nginx**: Reverse proxy handling SSL termination
- **Routing**: `/` -> Vite (5173), `/api/*` -> Express (3006)
- **Setup**: `./scripts/setup-local.sh` automates hosts entry, SSL certs, nginx config

## State Management

No global state library. Uses React Context + Custom Hooks:
- `src/services/sogniAuth.ts` — Central auth manager (SogniAuthManager singleton)
- `src/context/ToastContext.tsx` — Toast notifications
- `src/hooks/useChat.ts` — Chat state, streaming, tool execution orchestration
- `src/hooks/useChatSessions.ts` — Multi-session management with IndexedDB persistence
- `src/hooks/useWallet.ts` — Wallet balance tracking via SDK's useEntity
- `src/hooks/useMediaUpload.ts` — Multi-file upload (image, audio, video)

## Key Files by Feature

### Core
- `src/App.tsx` — Slim entry (~16 lines): ToastProvider -> HelmetProvider -> RouterProvider
- `src/router.tsx` — React Router v6 with lazy-loaded ChatPage and HistoryPage
- `src/layouts/AppLayout.tsx` — Layout with Header, global modals, layout context

### Chat
- `src/pages/ChatPage.tsx` — Main chat page with session management
- `src/services/chatService.ts` — LLM conversation manager with tool calling loop
- `src/config/chat.ts` — System prompt, model config, refusal detection, context window constants
- `src/hooks/useChat.ts` — React hook managing chat UI state, streaming, tool dispatch
- `src/components/chat/` — ChatPanel, ChatMessage, ChatInput, SuggestionChips, etc.
- `src/utils/chatSuggestions.ts` — Context-aware suggestion chips per tool

### Tools
- `src/tools/` — All 14 tool modules (see Tool Registry Pattern above)
- `src/tools/shared/` — Shared utilities: creditCheck, progress, aspectRatio, sourceImage, llmHelpers, billing

### Authentication
- `src/components/auth/LoginModal/` — Multi-step signup/login
- `src/services/sogniAuth.ts` — Frontend auth manager
- `server/routes/auth.js` — Backend auth routes

### Billing & Wallet
- `src/hooks/useWallet.ts` — Balance tracking
- `src/hooks/useCredits.ts` — Cost estimation
- `src/services/creditsService.ts` — Credit calculations
- `src/services/billingHistoryService.ts` — Transaction history
- `src/components/billing/` — OutOfCreditsPopup, DailyCreditsPopup

### Media
- `src/hooks/useMediaUpload.ts` — Multi-file upload with type detection
- `src/hooks/useVideo.ts` — Video playback state
- `src/services/fileUpload.ts` — File processing, image/audio/video extraction
- `src/utils/imageProcessing.ts` — Image conversion and dimension extraction

## SDK Quirks & Gotchas

- **Auth typo**: Use `isAuthenicated` (missing 't'), NOT `isAuthenticated`
- **Progress normalization**: SDK sends progress as 0-1 OR 0-100 — always normalize
- **WebSocket**: Check `socket?.connected` (property, not method)
- **HTTPS required**: Authentication fails without proper HTTPS setup
- **Dual servers**: Both frontend AND backend must run during development
- **max_tokens**: Use 4096, not 1024 — tool call JSON generation needs headroom
- **Chat tool calling + thinking**: Qwen3 produces `<think>` blocks before tool calls. The vLLM worker needs `reasoningParser: "qwen3"` in the API model config, otherwise tool calls appear as plain text. `stripThinkBlocks()` in chatService.ts is a safety net.
- **System prompt length**: Keep under ~400 chars for Qwen3 — long prompts with detailed rules cause text narration instead of structured tool calls

## Environment Variables

Backend requires `server/.env`:
```
SOGNI_USERNAME=your_username
SOGNI_PASSWORD=your_password
SOGNI_ENV=production
PORT=3006
CLIENT_ORIGIN=https://chat-local.sogni.ai
```

## Code Conventions

- **Path alias**: Use `@/*` for src imports (e.g., `@/services/sogniAuth`)
- **Console logs**: Prefix with context `[CHAT]`, `[TOOL REGISTRY]`, `[AUTH]`, etc.
- **TypeScript**: Strict mode enforced, `noUnusedLocals` and `noUnusedParameters` enabled
- **Components**: PascalCase (.tsx), Services: camelCase (.ts)
- **Tools**: kebab-case folders, snake_case function names (matching OpenAI convention)
- **Styling**: Tailwind CSS + CSS custom properties (`--color-primary`, `--color-accent`, etc.)
- **Fonts**: Lora (serif display) + Inter (body)
