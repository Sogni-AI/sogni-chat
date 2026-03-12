# Sogni Chat

AI-powered creative studio with a conversational interface. Generate images, edit photos, create videos, and compose music -- all through natural language.

Built with [Sogni SDK](https://sogni.ai), React, TypeScript, and Vite.

## Quick Start

```bash
# Install dependencies
npm install

# Set up local HTTPS (one-time)
./scripts/setup-local.sh

# Start development servers (run both in separate terminals)
npm run dev          # Frontend on port 5173
npm run server:dev   # Backend on port 3006

# Open https://chat-local.sogni.ai
```

## Features

Sogni Chat provides 11 AI tools accessible through natural conversation:

**Image**
- **Generate Image** -- Create images from text descriptions (Flux)
- **Edit Image** -- Instruction-based photo editing
- **Restore Photo** -- AI-powered photo restoration and damage repair
- **Apply Style** -- Artistic style transfer
- **Refine Result** -- Iterative refinement of previous results
- **Change Angle** -- Novel view synthesis from different camera angles (SV3D)

**Video**
- **Animate Photo** -- Bring photos to life as video clips (LTX-2)
- **Generate Video** -- Text-to-video generation (LTX-2)
- **Video to Video** -- Style transfer on existing videos with ControlNet
- **Sound to Video** -- Generate video synced to audio

**Audio**
- **Generate Music** -- Original music with lyrics, BPM, key signature, and genre control

## Architecture

The app uses a **tool registry pattern** where each AI capability is a self-contained module:

```
src/tools/
  restore-photo/
    definition.ts    # OpenAI-format schema (sent to the LLM)
    handler.ts       # Execution logic using Sogni SDK
    index.ts         # Self-registers with the registry
  generate-image/
  edit-image/
  ...
```

The LLM (Qwen3 via Sogni Chat API) receives all tool definitions and autonomously decides which tool to call based on the user's message. A tool calling loop handles multi-step workflows.

**Key architectural decisions:**
- Tool registry with self-registration -- adding a tool requires no changes to the chat service
- Dual-client authentication -- frontend handles user sessions, backend executes jobs
- Context window management -- sliding-window trimming keeps conversations within token limits
- Session persistence -- chat history stored in IndexedDB across browser sessions

## Adding a New Tool

1. Create `src/tools/my-tool/` with `definition.ts`, `handler.ts`, `index.ts`
2. Import it in `src/tools/index.ts`
3. Add the name to `ToolName` in `src/tools/types.ts`

See `CLAUDE.md` for detailed instructions and code templates.

## Development

```bash
npm run build        # TypeScript check + production build
npm run lint         # ESLint
npm run preview      # Preview production build
```

Local development requires HTTPS via nginx reverse proxy. Run `./scripts/setup-local.sh` for initial setup.

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **Backend**: Express.js
- **AI**: Sogni Client SDK (image generation, video, music, chat)
- **State**: React Context + custom hooks (no Redux/Zustand)
- **Storage**: IndexedDB for session persistence

## License

MIT
