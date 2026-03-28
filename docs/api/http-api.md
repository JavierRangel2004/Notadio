# HTTP API

This document describes the HTTP endpoints implemented by the backend and used by the frontend.

Source of truth: `backend/src/index.ts`.

Base URL in development:

- Backend: `http://localhost:8787`
- API base: `http://localhost:8787/api`

## Uploads and Jobs

### `POST /api/uploads`

Upload a media file and enqueue a batch job.

- Content-Type: `multipart/form-data`
- Form fields:
  - `media`: file (required)
  - `sourceOrigin`: `"upload" | "recording"` (optional)

Response:

```json
{ "jobId": "uuid" }
```

### `GET /api/jobs`

List jobs. Supports optional filtering by `status`.

- Query params:
  - `status`: `queued | processing | completed | failed` (optional)

### `GET /api/jobs/:jobId`

Get job status, progress, logs, and artifact pointers.

### `DELETE /api/jobs/:jobId`

Delete a job and its persisted data.

## Transcript and Derived Data

### `GET /api/jobs/:jobId/events`

Server-Sent Events stream with real-time job updates.

### `GET /api/jobs/:jobId/transcript`

Returns the transcript payload (source, optional english, optional summary).

### `GET /api/jobs/:jobId/summary`

Returns the saved summary JSON for a job. If summarization was skipped or not ready, returns `404`.

### `GET /api/jobs/:jobId/audio`

Returns the normalized WAV audio for the job (if available).

### `GET /api/jobs/:jobId/export`

Downloads exported artifacts.

- Query params:
  - `format`: `txt | srt | json`
  - `variant`: `source | english`

## Enhancements (Post-Processing)

### `POST /api/jobs/:jobId/enhancements`

Submit enhancement stages to run after base transcription.

Request body:

```json
{
  "stages": ["translate", "diarize", "summarize"],
  "summaryPreset": "meeting | whatsappVoiceNote | genericMedia | contentCreation | analysisEssay",
  "translationLanguage": "en"
}
```

Notes:

- `summaryPreset` is optional; if omitted, the backend will heuristically classify content for summarization.

## Retry Endpoints

Retries use the cached transcript and do not re-run base transcription.

- `POST /api/jobs/:jobId/retry/summarize`
- `POST /api/jobs/:jobId/retry/diarize`
- `POST /api/jobs/:jobId/retry/translate`

## System

### `GET /api/system/readiness`

Runs local readiness checks (binaries, models, optional features) and returns a report.

## Live Sessions (HTTP)

These endpoints expose the in-memory live session store for debugging/inspection.

- `GET /api/sessions`
- `GET /api/sessions/:sessionId`

The live streaming protocol itself is WebSocket-based; see `docs/api/live-session-websocket.md`.
