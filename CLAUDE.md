# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Notadio is a local-first audio/video transcription app using whisper.cpp. No external API keys required—all processing happens locally. Optional features include speaker diarization (Python) and AI-powered meeting summaries (Ollama).

The repo also includes a real-time “Live Session” mode that streams microphone audio over WebSocket, shows confirmed/provisional transcript segments, detects alias mentions, and can optionally generate grounded reply suggestions via Ollama.

## Monorepo Structure

NPM workspaces: `frontend/` (React + Vite) and `backend/` (Express + TypeScript).

- **Backend services** (`backend/src/services/`): transcription (whisper-cli), media normalization (ffmpeg), export (TXT/SRT/JSON), diarization (Python), summaries, live assistant, live translation, mention detection, device profiling
- **LLM provider abstraction** (`backend/src/services/llm/`): pluggable providers (`ollama`, `openai-compatible`) consumed by summary, live assistant, and live translation services; per-service overrides via `LLM_<SERVICE>_*` env vars
- **Live sessions** (`backend/src/sessions/`): `liveSessionOrchestrator.ts` (rolling-window transcription loop), `liveSessionStore.ts` (in-memory session state), `pcmRingBuffer.ts`; WebSocket protocol handler in `backend/src/routes/sessionWebSocket.ts`
- **Backend store** (`backend/src/store/jobStore.ts`): in-memory job map with debounced disk persistence and SSE listener infrastructure
- **Backend utils** (`backend/src/utils/`): filesystem helpers, child process spawning, concurrency-limited job queue, disk space checks
- **Frontend** (`frontend/src/`): single-page app — `App.tsx` (main component), `api.ts` (fetch client + EventSource for SSE), `liveApi.ts` + `useLiveSession.ts` + `LiveSessionPanel.tsx` (live session WebSocket client and UI), `styles.css` (CSS variables design system)

## Commands

```bash
npm install                      # Install root + workspace dependencies
npm run dev                      # Start both workspaces (Vite :5173, Express :8787)
npm run dev:backend              # Backend only (tsx watch)
npm run dev:frontend             # Frontend only (Vite dev server)
npm run build                    # Production build both
npm run build:backend            # Backend only
npm run build:frontend           # Frontend only
npm run doctor                   # Pre-flight checks (ffmpeg, whisper-cli, model, etc.)
npm run setup:diarization          # Configure optional Python diarization env (macOS/Linux)
npm run setup:diarization:windows  # Same, for Windows (PowerShell)
npm --workspace backend test     # Run all backend tests (Node.js built-in test runner)
```

Run a single backend test file (from `backend/`):

```bash
node --import tsx --test src/services/summaryService.test.ts
```

There are no frontend tests and no lint command.

## Architecture

### Job Processing Pipeline

Upload → normalize (ffmpeg, 15%) → transcribe (whisper, 55%) → translate (whisper, 17%) → diarize (Python, 5%) → summarize (Ollama, 8%) → export artifacts (3%)

Jobs flow through states: `queued` → `processing` → `completed`/`failed`. Real-time progress is streamed to the frontend via SSE (`/api/jobs/:jobId/events`).

### Live Session Pipeline

Browser mic audio (Int16 PCM, mono, 16 kHz via AudioWorklet) streams over WebSocket (`/api/sessions/ws`) into a per-session ring buffer. On an interval (`LIVE_INTERVAL_MS`), the orchestrator runs whisper on a rolling window (`LIVE_WINDOW_MS`): segments before the overlap cutoff (`windowEnd - LIVE_OVERLAP_MS`) are appended as confirmed; newer ones are provisional and replaced each window. Optional layers: alias mention detection, Ollama reply suggestions (`LIVE_ASSISTANT_ENABLED`), and subtitle translation of confirmed segments (`LIVE_TRANSLATION_ENABLED`, never alters the original transcript). Sessions are in-memory with a reconnect grace period; stopping a session archives the PCM, converts to WAV, and enqueues a normal batch job through the upload pipeline. Protocol spec: `docs/api/live-session-websocket.md`; architecture: `docs/architecture/live-session.md`.

### Key API Endpoints

- `POST /api/uploads` — file upload, returns `{ jobId }`
- `GET /api/jobs/:jobId` — job status + progress
- `GET /api/jobs/:jobId/events` — SSE real-time updates
- `GET /api/jobs/:jobId/transcript` — transcript (cached in-memory)
- `GET /api/jobs/:jobId/summary` — AI summary
- `GET /api/jobs/:jobId/export?format={txt|srt|json}&variant={source|english}` — download artifacts
- `GET /api/system/readiness` — readiness report
- `POST /api/jobs/:jobId/retry/{summarize|diarize|translate}` — retry individual stages

Live sessions:

- `GET /api/sessions` — list active in-memory live sessions (debug)
- `GET /api/sessions/:sessionId` — get one live session (debug)
- WebSocket: `/api/sessions/ws` — live session streaming protocol

### Performance Patterns

- Debounced disk I/O (5s) for progress; immediate persist for state transitions
- In-memory transcript cache avoids repeated disk reads
- Job queue limits concurrent Whisper processes (`MAX_CONCURRENT_JOBS`)
- Optional parallel transcription + translation (`WHISPER_PARALLEL` config)
- Bounded live logs per job (`JOB_LOG_LIMIT`)

## Coding Conventions

- 2-space indentation, semicolons omitted, double-quoted strings
- camelCase for variables/functions, PascalCase for components/types
- Strict TypeScript in both workspaces, no `any`
- Backend service files named by responsibility: `{thing}Service.ts`
- Tests use `*.test.ts` suffix, colocated with source files
- No lint/Prettier config — match surrounding file style

## Environment Setup

Copy `.env.example` to `.env`. Required system dependencies: Node.js 20+, ffmpeg, whisper-cli, and a local Whisper model file (`WHISPER_MODEL_PATH`). Optional: Python 3.9+ (diarization), Ollama (summaries, live assistant, live translation).

LLM features default to the global `OLLAMA_BASE_URL`/`OLLAMA_MODEL` but can be overridden per service (SUMMARY, LIVE_ASSISTANT, LIVE_TRANSLATION, ...) with `LLM_<SERVICE>_PROVIDER` / `_BASE_URL` / `_API_KEY` / `_MODEL`, where provider is `ollama` or `openai-compatible`. Full config reference: `docs/backend/configuration.md`.

## Documentation

Primary docs live under `docs/` (start at `docs/README.md`): `docs/api/http-api.md`, `docs/api/live-session-websocket.md`, `docs/backend/configuration.md`, `docs/architecture/{overview,live-session,summarization}.md`. Update the relevant doc when changing API surfaces or configuration.

## Commit Style

Short imperative subjects, optionally scope-prefixed (e.g., `docs: ...`, `fix: ...`). One concern per commit. PRs should note any `.env` or system dependency changes.

## Ruflo / Claude-Flow Orchestration

Ruflo (claude-flow v3.5.17) is configured for this repo. The MCP server is registered in `.mcp.json` and starts via stdio on session load.

### MCP tools (call inside Claude sessions)

```txt
mcp__claude-flow__memory_search(...)
mcp__claude-flow__swarm_init(...)
mcp__claude-flow__agent_spawn(...)
mcp__claude-flow__memory_store(...)
mcp__claude-flow__memory_retrieve(...)
```

### Orchestration quick-start

```bash
# Tier 1 — quick fix (single agent)
claude-flow orchestrate "fix null-check in parser" --agents 1

# Tier 2 — medium feature (mesh, 3 agents)
claude-flow hive init --topology mesh --agents 3
claude-flow orchestrate "add email verification" --parallel

# Tier 3 — architecture (hierarchical, 5+ agents)
claude-flow hive init --topology hierarchical --agents 5
claude-flow sparc run dev "build complete feature"
claude-flow hive monitor --live
```

### SPARC modes

```bash
claude-flow sparc run dev      "..."   # full dev cycle
claude-flow sparc run tdd      "..."   # TDD workflow
claude-flow sparc run refactor "..."   # refactor existing code
claude-flow sparc run ui       "..."   # React component work
```

### Useful commands

```bash
claude-flow mcp status                   # check MCP server
claude-flow mcp tools                    # list available tools
claude-flow health check --verbose       # system health
claude-flow performance report --format summary
claude-flow memory store "key" "value"   # persist context
```
