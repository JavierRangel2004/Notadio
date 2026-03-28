# Architecture Overview

Notadio is a local-first transcription app with two modes:

1. Batch jobs: upload or record a file, then run a pipeline (normalize → transcribe → optional enhancements → export).
2. Live sessions: stream microphone audio over WebSocket, show near real-time transcript (confirmed + provisional), then finalize into a normal batch job.

Code locations:

- Backend entrypoint: `backend/src/index.ts`
- Batch services: `backend/src/services/*`
- Live sessions: `backend/src/sessions/*` and `backend/src/routes/sessionWebSocket.ts`
- Frontend UI: `frontend/src/App.tsx` and live UI in `frontend/src/LiveSessionPanel.tsx`

## Batch Job Pipeline (Upload/Recording)

High-level stages (see `backend/src/index.ts`):

- Normalize: `backend/src/services/mediaService.ts` uses `ffmpeg` to produce mono 16 kHz WAV
- Transcribe: `backend/src/services/transcriptionService.ts` invokes `whisper-cli` and parses JSON output
- Enhancements (optional, user-selected):
  - Translate: Whisper or Ollama depending on config
  - Diarize: Python diarization script (if configured)
  - Summarize: Ollama structured JSON summary (with chunking + reduce and fallbacks)
- Export: `backend/src/services/exportService.ts` writes `TXT`, `SRT`, and `JSON` artifacts

Progress and logs are streamed to the frontend via SSE:

- `GET /api/jobs/:jobId/events` (see `docs/api/http-api.md`)

## Live Session Pipeline (Real-Time)

High-level stages (see `backend/src/sessions/liveSessionOrchestrator.ts`):

- Frontend captures microphone audio at 16 kHz and streams Int16 PCM frames over WebSocket
- Backend stores frames in a per-session ring buffer and archives raw PCM to disk
- On an interval, backend transcribes a sliding window with Whisper
- Backend emits:
  - confirmed segments: stable text (older part of the window)
  - provisional segments: newest text (may change)
- Mentions: alias matching runs on confirmed segments and emits mention events; optional assistant suggestions use Ollama
- Stop: backend converts archived audio to WAV and creates a normal batch job

Details:

- `docs/architecture/live-session.md`
- `docs/api/live-session-websocket.md`

## Storage Model

All job artifacts are stored under `STORAGE_ROOT` (default `./data`), in per-job folders.

Note: the `data/` directory is runtime storage and should not be committed.
