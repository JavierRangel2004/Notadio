# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Notadio is a local-first audio/video transcription app using whisper.cpp. No external API keys required—all processing happens locally. Optional features include speaker diarization (Python) and AI-powered meeting summaries (Ollama).

## Monorepo Structure

NPM workspaces: `frontend/` (React + Vite) and `backend/` (Express + TypeScript).

- **Backend services** (`backend/src/services/`): transcription (whisper-cli), media normalization (ffmpeg), export (TXT/SRT/JSON), diarization (Python), summaries (Ollama), device profiling
- **Backend store** (`backend/src/store/jobStore.ts`): in-memory job map with debounced disk persistence and SSE listener infrastructure
- **Backend utils** (`backend/src/utils/`): filesystem helpers, child process spawning, concurrency-limited job queue
- **Frontend** (`frontend/src/`): single-page app — `App.tsx` (main component), `api.ts` (fetch client + EventSource for SSE), `styles.css` (CSS variables design system)

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
npm run setup:diarization        # Configure optional Python diarization env
npm --workspace backend test     # Run backend tests (Node.js built-in test runner)
```

## Architecture

### Job Processing Pipeline

Upload → normalize (ffmpeg, 15%) → transcribe (whisper, 55%) → translate (whisper, 17%) → diarize (Python, 5%) → summarize (Ollama, 8%) → export artifacts (3%)

Jobs flow through states: `queued` → `processing` → `completed`/`failed`. Real-time progress is streamed to the frontend via SSE (`/api/jobs/:jobId/events`).

### Key API Endpoints

- `POST /api/uploads` — file upload, returns `{ jobId }`
- `GET /api/jobs/:jobId` — job status + progress
- `GET /api/jobs/:jobId/events` — SSE real-time updates
- `GET /api/jobs/:jobId/transcript` — transcript (cached in-memory)
- `GET /api/jobs/:jobId/summary` — AI summary
- `GET /api/jobs/:jobId/export?format={txt|srt|json}&variant={source|english}` — download artifacts
- `POST /api/jobs/:jobId/retry/{summarize|diarize}` — retry individual stages

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

Copy `.env.example` to `.env`. Required system dependencies: Node.js 20+, ffmpeg, whisper-cli, and a local Whisper model file. Optional: Python 3.9+ (diarization), Ollama (summaries).

## Commit Style

Short imperative subjects, optionally scope-prefixed (e.g., `docs: ...`, `fix: ...`). One concern per commit. PRs should note any `.env` or system dependency changes.
