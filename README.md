# Notadio

Local-first transcription for audio and video using `whisper.cpp`, with optional diarization (Python) and optional structured summarization (Ollama).

Primary documentation lives in:

- `docs/README.md`

## Monorepo Layout

- `backend/`: Express + TypeScript API
- `frontend/`: React + Vite UI
- `scripts/`: setup + diagnostics helpers
- `data/`: runtime job storage (should stay untracked)

## Quick Start (Local)

1. Install dependencies:

```bash
npm install
```

2. Create `.env`:

```bash
cp .env.example .env
```

3. Set required variables in `.env`:

- `WHISPER_MODEL_PATH` (path to a local whisper.cpp model `.bin`)
- Ensure `FFMPEG_PATH` and `WHISPER_COMMAND` resolve on your machine

4. Run readiness checks:

```bash
npm run doctor
```

5. Start dev servers:

```bash
npm run dev
```

Frontend: `http://localhost:5173`  
Backend: `http://localhost:8787`

## Optional Features

- Summarization (Ollama): set `ENABLE_SUMMARY=true` and configure `OLLAMA_*` in `.env.example`.
- Diarization: run `npm run setup:diarization` (macOS/Linux) or `npm run setup:diarization:windows` (Windows), then set `DIARIZATION_COMMAND`.
- Live sessions (real-time): enabled by default in `.env.example` (`LIVE_TRANSCRIPTION_ENABLED=true`).

## Key Docs

- `docs/api/http-api.md`
- `docs/api/live-session-websocket.md`
- `docs/backend/configuration.md`
- `docs/architecture/overview.md`
- `docs/architecture/live-session.md`
- `docs/architecture/summarization.md`
