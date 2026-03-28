# Live Session (Real-Time Transcription)

This document describes the live transcription feature as implemented in the repo (near real-time, windowed transcription).

Source of truth:

- `backend/src/routes/sessionWebSocket.ts`
- `backend/src/sessions/liveSessionOrchestrator.ts`
- `frontend/src/liveApi.ts`
- `frontend/src/useLiveSession.ts`
- `frontend/src/LiveSessionPanel.tsx`

## What “Live” Means Here

- Audio is streamed from the browser to the backend continuously.
- The backend transcribes sliding windows (not token-level streaming).
- The UI shows:
  - confirmed text (stable, older part of the window)
  - provisional text (newest portion, may change)

## Audio Format and Transport

- Transport: WebSocket (`/api/sessions/ws`)
- Audio: Int16 PCM, mono, 16 kHz
- Frontend capture: `AudioWorklet` converts Float32 → Int16 and sends binary frames.

## Windowing Strategy

On an interval (`LIVE_INTERVAL_MS`), the backend:

1. Pulls a rolling window (`LIVE_WINDOW_MS`) from the ring buffer.
2. Runs Whisper on that window.
3. Splits the resulting segments:
   - confirmed: any segment starting before the overlap cutoff (`windowEnd - LIVE_OVERLAP_MS`)
   - provisional: newer segments (within the overlap range)

Confirmed segments are appended; provisional segments are replaced every window.

## Mention Detection and Assistant Suggestions

Mentions are implemented as:

- Alias matching on confirmed transcript segments.
- A short “context window” (configurable) that captures nearby segments to classify intent and produce a mention event.

Assistant suggestions:

- If the session config has `enableAssistant=true` and `LIVE_ASSISTANT_ENABLED=true`, a grounded Ollama prompt is sent using recent transcript context.
- Suggestions are best-effort and can fail without breaking live transcription.

## Finalization Into Batch Job

Stopping a live session:

- Archives raw PCM audio to disk during the session.
- Converts the archived audio to WAV (`ffmpeg`).
- Creates a normal queued batch job using the same pipeline as uploads.
- Writes a `live_transcript.json` sidecar with confirmed segments and mention events.

## Current Limitations (Tracked)

- No VAD (voice activity detection) to avoid running Whisper on silence.
- Frontend does not currently auto-resume sessions on reconnect, even though the backend supports `resume_session`.
- No native OS/browser notification channel for mentions.

Implementation checklist:

- `docs/architecture/checklists/STREAMPLAN_CHECKLIST.md`
