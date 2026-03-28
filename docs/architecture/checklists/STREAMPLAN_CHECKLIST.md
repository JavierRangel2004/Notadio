# Checklist: `streamplan.md`

Last audited against repo state: 2026-03-28

Status legend:
- `[x]` Implemented
- `[-]` Partial
- `[ ]` Missing

## Summary

- [x] Live transcription uses WebSocket transport rather than repeated HTTP polling.
- [x] Frontend captures microphone audio continuously and streams PCM frames to the backend.
- [x] Backend maintains a per-session ring buffer and runs sliding-window Whisper transcription.
- [x] UI distinguishes confirmed transcript text from provisional transcript text.
- [x] Full session audio is archived and converted into a batch job at stop time.
- [x] Mention detection for aliases exists and produces live mention cards.
- [x] Optional assistant response suggestions exist for mentions.
- [-] Reconnection support exists on the backend protocol, but the main frontend hook does not currently drive resume flows.
- [ ] VAD is not implemented.
- [ ] There is no native browser/system notification path for mentions yet.

## Core Live Architecture

- [x] WebSocket upgrade endpoint exists at `/api/sessions/ws` in `backend/src/routes/sessionWebSocket.ts`.
- [x] Frontend WebSocket client exists in `frontend/src/liveApi.ts`.
- [x] Sessions can be started, stopped, and resumed at the protocol level.
- [x] Session-level server-side orchestration exists in `backend/src/sessions/liveSessionOrchestrator.ts`.
- [x] Live feature flags and runtime knobs exist in `backend/src/config.ts`.

## Frontend Capture Pipeline

- [x] Browser requests microphone access.
- [x] Audio capture uses `AudioContext` at 16 kHz in `frontend/src/liveApi.ts`.
- [x] An `AudioWorklet` converts Float32 samples to Int16 PCM before streaming.
- [x] Frames are sent over WebSocket as binary messages.
- [x] UI exposes a dedicated live-session panel in `frontend/src/LiveSessionPanel.tsx`.
- [x] UI shows elapsed session time and frame count.
- [-] There is no waveform or audio-level meter yet.
- [ ] No client-side VAD or silence gating exists.

## Backend Streaming / Transcription Pipeline

- [x] Backend receives PCM audio frames via binary WebSocket messages.
- [x] Per-session PCM ring buffer exists via `PcmRingBuffer` in `backend/src/sessions/pcmRingBuffer.ts`.
- [x] Backend archives raw PCM to disk during the session.
- [x] Sliding-window transcription runs on an interval in `runWindowTranscription()`.
- [x] Live window size, overlap, and min-window thresholds are configurable.
- [x] Whisper invocation is throttled by a global max-concurrent-windows limit.
- [x] A final live window pass is attempted during session finalization.
- [-] Whisper streaming is still simulated through windowed reprocessing rather than native streaming hypotheses.
- [ ] No VAD stage exists to reduce unnecessary inference.

## Confirmed vs Provisional Transcript UX

- [x] Backend splits window output into confirmed and provisional segments based on overlap cutoff.
- [x] Confirmed segments are appended incrementally.
- [x] Provisional segments are replaced on each window.
- [x] Frontend renders confirmed and provisional transcript rows separately.
- [x] Live transcript auto-scrolls as new content arrives.
- [-] Reconciliation is based on overlap cutoff plus duplicate suppression, not a richer diff/commit model.
- [ ] No explicit user-facing notion of “commit confidence” or stabilization rules beyond the overlap strategy.

## Mention Detection / “Say My Name” Workflow

- [x] Alias configuration exists in the live-session UI.
- [x] Backend builds alias regex patterns from configured names.
- [x] Mention detection scans confirmed live segments.
- [x] Mention capture windows include prior context and a short future context window.
- [x] Mention events are classified heuristically as:
  - `question`
  - `task_assignment`
  - `information_request`
  - `greeting`
  - `unknown`
- [x] Mention cards are rendered live in the frontend.
- [x] Mention-trigger segments are visually highlighted in the transcript.
- [-] Mention detection is alias-occurrence based and can still overfire on non-address uses of a name.
- [ ] No speaker-aware addressee detection exists.

## Assistant Suggestion Pipeline

- [x] Optional assistant suggestions can be enabled from the live-session UI.
- [x] Assistant suggestions are feature-flagged server-side.
- [x] Prompting is grounded strictly in recent transcript context.
- [x] Assistant status transitions are reflected in live mention cards.
- [-] Suggestions are generated after mention capture windows finalize, not instantaneously at the first name hit.
- [ ] No push notification mechanism exists for assistant-ready results.
- [ ] No dedicated model/configuration split exists between live assistant and batch summarization models.

## Persistence and Batch Handoff

- [x] Live audio is archived to disk as raw PCM during the session.
- [x] Raw PCM is converted to WAV during finalization.
- [x] Finalization creates a normal queued batch job in the existing job pipeline.
- [x] Live sessions are marked as `sourceOrigin: "recording"` in the created batch job.
- [x] A `live_transcript.json` sidecar is written with confirmed segments and mention events.
- [x] Stop flow returns a `jobId` to the frontend for the normal post-processing path.
- [-] The sidecar is written, but there is no dedicated frontend surfacing of that archived live transcript sidecar outside the current handoff flow.

## Reconnection / Session Resilience

- [x] Backend tracks disconnected sessions and keeps a grace-period timer before auto-finalization.
- [x] Backend supports `resume_session` and sends a catch-up packet with confirmed segments and mentions.
- [x] WebSocket heartbeat ping/pong exists server-side.
- [-] Frontend hook currently handles disconnect by stopping local capture, but does not automatically reconnect or offer resume UX.
- [ ] No explicit reconnect UI exists.
- [ ] No offline buffering exists for temporary network interruptions.

## Configurability / Runtime Controls

- [x] Live transcription can be enabled/disabled by config.
- [x] Live assistant can be enabled/disabled by config.
- [x] Window size is configurable.
- [x] Overlap is configurable.
- [x] Whisper live thread count is configurable.
- [x] Max concurrent live windows is configurable.
- [x] Mention context window duration is configurable.
- [x] Minimum window duration is configurable.
- [x] Session grace period is configurable.

## What `streamplan.md` Asked For vs Repo Status

### Near Real-Time Streaming

- [x] WebSocket transport
- [x] Small continuous frontend chunks
- [x] Backend session buffer
- [x] Sliding-window transcription
- [x] Confirmed + provisional UI
- [x] Final pass on stop

### Mention + Alerting Extension

- [x] Name/alias matching
- [x] Highlight mention segments
- [x] Summarize context around the mention via a structured mention event
- [x] Optional AI answer suggestion
- [ ] User notification channel beyond in-app UI

### Long Session Support

- [x] Continuous raw audio persistence
- [x] Batch-job handoff after stop
- [x] Global concurrency throttling
- [-] Basic disconnect grace period exists
- [ ] No deeper performance profiling or long-session retention policy is visible in repo

## Tests / Verification State

- [-] The live-session feature appears integrated and wired through backend/frontend, but there is little or no automated test coverage visible for the live stack.
- [x] The repo includes live-session types, routes, orchestration, and UI components.
- [ ] No dedicated tests found for:
  - WebSocket session lifecycle
  - ring buffer behavior in live orchestration
  - mention capture timing windows
  - live assistant response flow
  - resume/disconnect handling

## Remaining Gaps Worth Tracking

- [ ] Add VAD to reduce useless inference and improve segmentation.
- [ ] Add reconnect/resume UX on the frontend.
- [ ] Add browser/system notifications for mentions and assistant replies.
- [ ] Add tests for live orchestration, mention detection, and session finalization.
- [ ] Add optional waveform/level indicator during live recording.
- [ ] Consider speaker-aware mention detection to reduce false positives.
