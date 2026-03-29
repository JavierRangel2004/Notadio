# Live Session WebSocket Protocol

Source of truth:

- Backend: `backend/src/routes/sessionWebSocket.ts`
- Frontend: `frontend/src/liveApi.ts`

WebSocket URL in development:

- `ws://localhost:8787/api/sessions/ws`

## Client → Server Messages (JSON)

### Start session

```json
{ "type": "start_session", "config": { "aliases": ["Name"], "enableAssistant": false, "assistantContextWindowSegments": 10 } }
```

### Resume session

```json
{ "type": "resume_session", "sessionId": "uuid" }
```

### Stop session

```json
{ "type": "stop_session" }
```

### Ping

```json
{ "type": "ping" }
```

## Client → Server Messages (Binary)

Binary frames are Int16 PCM audio at 16 kHz, mono.

Implementation details:

- Frontend uses an `AudioWorklet` to capture Float32 PCM and convert to Int16 (`frontend/src/liveApi.ts`).
- Backend interprets each binary message as Int16 PCM (`backend/src/sessions/liveSessionOrchestrator.ts`).

## Server → Client Messages (JSON)

### `session_created`

```json
{ "type": "session_created", "sessionId": "uuid" }
```

### `session_resumed`

```json
{ "type": "session_resumed", "sessionId": "uuid", "confirmed": [], "mentions": [] }
```

### `transcript`

```json
{ "type": "transcript", "confirmed": [], "provisional": [] }
```

### `mention_detected`

```json
{ "type": "mention_detected", "mention": { "id": "uuid", "mentionedAlias": "Name", "intent": "question", "...": "..." } }
```

### `mention_updated`

```json
{ "type": "mention_updated", "mentionId": "uuid", "assistantStatus": "generating", "assistantResponse": "..." }
```

### `translated_segments`

Sent when live translation is enabled. Contains translated text for confirmed segments. Keyed by `segmentId` (matches original `LiveTranscriptSegment.id`).

```json
{ "type": "translated_segments", "segments": [{ "segmentId": "uuid", "text": "Texto traducido", "targetLang": "es" }] }
```

### `session_stopped`

```json
{ "type": "session_stopped", "jobId": "uuid" }
```

### `error`

```json
{ "type": "error", "message": "..." }
```

### `pong`

```json
{ "type": "pong" }
```

### `log`

```json
{ "type": "log", "message": "..." }
```

## Feature Flags

If `LIVE_TRANSCRIPTION_ENABLED=false`, the backend does not attach the WebSocket handler.

If `LIVE_ASSISTANT_ENABLED=false`, the backend still emits mention events but skips assistant suggestions.

If `LIVE_TRANSLATION_ENABLED=true`, the backend sends `translated_segments` messages for newly confirmed segments.
