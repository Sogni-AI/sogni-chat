## v1.1.0 (2026-03-21)

### Features

- Fullscreen media viewer with batch navigation
- Pro quality tier using Flux.2 Dev for all image tools
- Content filter confirmation popup with memory context injection
- Stop button for chat generation and redesigned referral popup
- Dynamic prompt guidance for batch variation across all tools
- Changelog system with "What's New" modal and version tracking

### Bug Fixes

- Batch image rendering — correct slot images and eliminate completion flicker
- Prevent LLM from putting multiple subjects in batch variation prompts
- Preserve Enter-to-send on desktop, newline-only on mobile
- Enforce resolve_personas before image generation of known personas
- Mobile drawer "New Chat" button now creates a new session

### Improvements

- Improved markdown spacing and redesigned welcome screen with token buffering
- Increased Flux.2 Dev steps to 40 and added batch prompt sanitization for edit-image
