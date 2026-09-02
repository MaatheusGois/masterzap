# MasterWhats

WhatsApp-like web viewer for browsing WhatsApp messages. Built with vanilla JS + Vite.

## Quick Start

```bash
npm install
npm run split-data    # Generate chunked data in public/data/
npm run dev           # Start dev server
```

## Architecture

- **Vanilla JS + Vite** — no framework, static data viewer
- **Data**: two sources, 66,387 messages across 24 conversations
  - 65,772 messages from DV ↔ Martha Graeff (2024-02-10 to 2025-08-13), in `data/messages.json`
  - 615 messages from the Federal Police report IPJ-A 3298613/2026 (23 conversations, including DV ↔ Alexandre de Moraes) — see `data/ipj-3298613/README.md`
- **Chunking**: `scripts/split_data.py` splits every source conversation into per-date JSON files in `public/data/`
- **Lazy loading**: Only loads day-chunks as user scrolls, with LRU cache

## Directory Structure

- `src/` — application source (styles, lib, components)
- `public/data/` — generated chunked data (gitignored, rebuild with `npm run split-data`)
- `public/assets/` — static assets (favicon, background, SVGs)
- `data/` — source data (messages.json, index.json)
- `data/ipj-3298613/` — transcription of the IPJ-A police report (JSONL, one line per message)
- `data/conversations/` — conversations built from that transcription by `scripts/build_ipj_data.py`
- `data/source/` — original source PDFs the transcriptions came from
- `ref/` — reference files (WDS style.css, WhatsApp desktop HTML, branding)
- `scripts/` — build scripts
- `tests/unit/` — Vitest unit tests
- `tests/e2e/` — Playwright E2E tests

## Key Conventions

- **Language**: All UI text in Brazilian Portuguese (pt-BR)
- **Styling**: WDS (WhatsApp Design System) CSS custom properties in `wds-tokens.css`
- **Message types**: text, image, video, audio, sticker, document, deleted, call, system
- **Outgoing messages**: `sender === "DV"` (right-aligned, green bubble)
- **Conversation ID**: slugified participant name (e.g., `martha-graeff`)

## Commands

```bash
npm run dev           # Vite dev server
npm run build         # Production build
npm run preview       # Preview production build
npm run split-data    # Regenerate data chunks (all conversations)
npm run test          # Run unit tests (Vitest)
npm run test:watch    # Unit tests in watch mode
npm run test:e2e      # E2E tests (Playwright; starts its own dev server)
npm run test:coverage # Unit tests with coverage
npm run verify        # Everything, in deploy order: data → unit → build → E2E
```

## Before deploying

Vercel deploys on push, so the gate is a `pre-push` hook. Enable it once per
clone:

```bash
git config core.hooksPath .githooks
npx playwright install chromium   # first time only
```

It runs `npm run verify` (~5 min, mostly E2E across desktop and mobile).
`git push --no-verify` skips it.

E2E covers what jsdom cannot see: list scrolling, hover on touch, avatars that
actually load, and the read/unread wiring. Keep `test:e2e` pointed at
`tests/e2e/playwright.config.js` — without `--config` Playwright scans `tests/`,
picks up the Vitest files and dies on a matcher clash.

## Data Format

Each message in `messages.json`:
```json
{
  "id": 1,
  "timestamp": "2024-02-10T11:12:08",
  "date": "2024-02-10",
  "time": "11:12:08",
  "sender": "DV" | "Martha Graeff",
  "content": "...",
  "type": "text" | "image" | "video" | "audio" | "sticker" | "document" | "deleted" | "call" | "system",
  "is_edited": false,
  "attachment": null | "filename",
  "urls": []
}
```

## Reference Files

- `ref/style/style.css` — WDS tokens (500+ CSS vars)
- `ref/style/whatsapp-desktop-ref.html` — WhatsApp Web DOM structure
- `ref/style/whatsapp-background.webp` — Chat doodle wallpaper
- `ref/style/whatsapp-loading.png` — Loading screen reference
- `ref/branding-design-components/01_Digital/02_SVG/Green/Digital_Glyph_Green.svg` — WhatsApp glyph
