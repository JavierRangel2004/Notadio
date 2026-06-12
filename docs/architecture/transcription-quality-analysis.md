# Transcription Quality: Market Comparison and Local-First Roadmap

This document compares common commercial meeting-transcription and interview-copilot products with Notadio’s current implementation, explains why quality depends on the full pipeline (not a single model), and outlines what is missing to reach very good quality while staying local-first.

Related docs:

- `docs/architecture/overview.md` — batch + live pipelines
- `docs/architecture/live-session.md` — live windowing and mentions
- `docs/backend/configuration.md` — Whisper, diarization, live knobs
- `docs/architecture/checklists/STREAMPLAN_CHECKLIST.md` — live feature gaps

Last updated: 2026-06-11

---

## Executive summary

Commercial tools (Otter, Fathom, Fireflies, etc.) and interview copilots (Final Round AI, LockedIn, etc.) exist and are priced roughly **$0–$60+/month** depending on features. They typically combine:

- Clean or multi-track meeting audio
- Streaming or batch speech-to-text (STT)
- Diarization (who spoke when)
- Post-processing (punctuation, entity correction)
- Summaries and action items

Notadio already implements several patterns that good products use: **confirmed vs provisional live text**, **overlap windowing**, **mention detection with intent heuristics**, **batch VAD and hallucination guards**, and **non-trivial diarization post-processing**. The largest gaps for real dailies (bad mics, spanglish, brand names, 5–8 speakers) are:

1. **Speaker attribution strategy** — single mixed audio track vs per-participant tracks
2. **Transcript refinement** — no workspace glossary or constrained post-ASR correction layer
3. **Explicit “final transcript”** — live handoff to batch exists, but users may not see a reconciled high-quality final in the UI
4. **Evaluation** — no WER/CER/DER or name-accuracy benchmark on real audios

Quality is not solved by swapping to a cloud API alone. For local-first, invest in pipeline layers and measurement.

---

## Product landscape (what exists commercially)

### Meeting transcription (Zoom / Meet / Teams)

| Tool | What it does | Approx. pricing |
|------|----------------|-----------------|
| Otter.ai | Live transcription, summaries, minute limits on free tier | Free limited; paid for more minutes |
| Fathom | Record, transcribe, summarize; free individual tier | Free individuals; team ~$15–19/user/month |
| Fireflies.ai | Bot joins meetings, transcribe, search, CRM integrations | Free limited; Pro/Business ~$10–29+/month |
| tl;dv | Record, transcribe, summarize | Free tier + paid advanced features |

Typical flow: bot or desktop app captures meeting audio → cloud STT → diarization → summary and tasks.

### Interview copilots (live suggestions on screen)

| Tool | What it promises | Approx. pricing |
|------|------------------|-----------------|
| Final Round AI | Interview copilot, mock interviews, “stealth” modes | Free tier; paid from ~$25/month (annual) |
| LockedIn AI | Real-time answers, coding help, invisible desktop app | From ~$55/month |
| Interview Coder | LeetCode-style live coding help | Free limited; Pro ~$299/month |
| Verve AI | Live interview copilot, technical + behavioral | Free; Pro ~$35–60/month |

Typical flow: capture mic/system audio → detect question → LLM → show suggested answer (sometimes hidden from screen share).

**Ethics note:** Live answer copilots during real interviews may violate employer or platform rules. Tools marketed as “undetectable” are not necessarily ethical or permitted. Notadio’s grounded mention assistant is closer to **meeting assist** (“they asked you something”) than hidden interview cheating.

### How they achieve “good” transcripts

Almost always a **stack**, not one model:

```text
Audio input
  → preprocessing (resample, mono, light noise handling)
  → VAD (speech vs silence)
  → chunking with overlap
  → ASR (streaming or batch)
  → diarization (or per-participant tracks)
  → align ASR + speakers
  → post-process (names, brands, punctuation)
  → summary / action items
```

For **live**, strong products often show fast partial text and produce a **better final** transcript seconds or minutes later (re-diarization, formatting, vocabulary correction).

---

## Recommended pipeline for a daily (generic best practice)

### Live vs final outputs

| Output | Purpose | Typical quality |
|--------|---------|-----------------|
| **Live** | Assist during the call | Lower latency; provisional diarization and punctuation |
| **Final** | Documentation after the call | Full-file ASR, re-diarization, glossary correction |

Users should expect live text to **change** when the final pass completes.

### Single mixed audio vs per-participant tracks

**Case A — one track per participant (best for dailies in your own app)**

```text
Juan track → ASR → Speaker: Juan
Ana track  → ASR → Speaker: Ana
```

Diarization becomes mostly unnecessary; overlap and crosstalk are the hard parts.

**Case B — one mixed mono stream (uploads, room mic, tab capture)**

```text
Mixed audio → VAD → diarization → align → speaker labels
```

Hard with: crosstalk, bad mics, similar voices, short utterances (“sí”, “ok”).

If the webapp hosts the meeting, **multi-track capture** is the highest-leverage quality improvement.

### Diarization stabilization

Live diarization often flips labels (`Speaker 0` → `Speaker 2` for the same person). Common pattern:

- Provisional diarization on short windows (10–30 s)
- Periodic re-diarization on longer windows (2–5 min)
- Reconcile labels backward in the UI

Notadio does **batch-only** diarization today; live has no speaker labels.

### Spanglish, brands, and names

Usually requires **two mechanisms**:

1. **Before/during ASR** — vocabulary biasing (keyterms, initial prompt)
2. **After ASR** — constrained correction against an allowlist (do not free-rewrite with an LLM)

Example workspace context:

```json
{
  "language_hint": "es-MX + en-US",
  "participants": ["Juan Pérez", "Ana Gómez"],
  "project_terms": ["Stripe", "Kubernetes", "Sentry", "Vercel", "Next.js"],
  "internal_terms": ["Proyecto Atlas", "Sprint 34"]
}
```

### Punctuation and “readable” vs “literal” transcript

Store both when possible:

```json
{
  "raw_text": "eh sí o sea yo creo que el bug viene de stripe...",
  "clean_text": "Sí, creo que el bug viene de Stripe...",
  "speaker": "Juan",
  "start": 12.4,
  "end": 18.9
}
```

Readable text is default for meetings; literal text matters for compliance or legal use.

### Mention alerts (say my name)

Layers that help:

1. Exact alias match
2. Fuzzy match (Juam → Juan)
3. Intent classification (direct question vs “what Juan said yesterday”)

Notadio implements (1) and heuristic intent; fuzzy and speaker-aware addressing are gaps.

### Evaluation metrics

| Metric | Measures |
|--------|----------|
| **WER** | Word error rate (transcription) |
| **CER** | Character error rate (names/brands) |
| **DER** | Diarization error rate |
| **Latency** | Time to partial/final segment in live |
| **Name accuracy** | Custom metric on glossary terms |

Build a fixed set of real dailies (good/bad mic, spanglish, 2/5/8 speakers) and re-run on every model or config change.

---

## Notadio today: comparison matrix

| Recommendation | Notadio implementation | Status |
|----------------|------------------------|--------|
| Partial vs final transcript | Confirmed + provisional live segments; overlap cutoff | **Strong** |
| Live fast + final slow | Live windowed Whisper; stop → WAV → batch pipeline | **Partial** — final pass exists; UI may not reconcile live vs batch |
| VAD before ASR | Silero VAD in batch Whisper (`WHISPER_ENABLE_VAD`) | **Batch only** — live runs on full windows |
| Diarization + alignment | Python `diarize` → overlap align + collapse + smooth + optional LLM names | **Good batch engineering** — not live |
| Audio per participant | Single mixed stream (mic and/or system tab) | **Major gap** for multi-speaker dailies |
| Workspace vocabulary | Static `--prompt` in `WHISPER_ARGS` | **Minimal** |
| Post-ASR correction | None dedicated | **Missing** |
| Mention alerts | Regex + intent + context window | **Good v1** — no fuzzy aliases |
| STT provider abstraction | Fixed `whisper-cli` | LLM is pluggable; STT is not |
| Benchmark suite | None | **Missing** |
| Interview stealth copilot | Grounded assistant on mentions (manual “Ask AI”) | **Different product** — meeting assist |

---

## What Notadio already does well

### Live architecture

On each `LIVE_INTERVAL_MS`, the orchestrator pulls `LIVE_WINDOW_MS` from the ring buffer, runs Whisper, and splits:

- **Confirmed** — segments before `windowEnd - LIVE_OVERLAP_MS`
- **Provisional** — newer overlap region, replaced each window

See `docs/architecture/live-session.md` and `backend/src/sessions/liveSessionOrchestrator.ts`.

Duplicate suppression uses timing proximity and word overlap (including re-segmentation cases)—more mature than naive append-only live STT.

### Batch Whisper tuning

`backend/src/services/transcriptionService.ts` and `backend/src/config.ts` support:

- Silero VAD (`WHISPER_ENABLE_VAD`, thresholds, pad/min speech/silence)
- Hallucination loop trimming (`WHISPER_HALLUCINATION_GUARD`)
- `no_speech_thold`, `max_len`, `split_on_word`, `suppress_nst`
- Device-aware threading via `deviceProfileService`

### Diarization post-processing

`backend/src/services/diarizationService.ts`:

- Normalize and merge speaker slices
- Collapse to `DIARIZATION_MAX_SPEAKERS`
- Smooth isolated one-off speaker flips
- Assign speakers by segment overlap (fallback: nearest slice)
- Optional LLM inference of real names from transcript; fallback `SPEAKER_A` labels

### Mentions

`backend/src/services/mentionDetectionService.ts`:

- Accent-normalized alias regex
- Intent: `question`, `task_assignment`, `information_request`, `greeting`, `unknown`
- Trigger sentence extraction for mention cards
- Optional grounded assistant (`liveAssistantService`) on user action

### Local-first stack

- **STT:** whisper.cpp (`whisper-cli`)
- **Media:** ffmpeg normalization to mono 16 kHz WAV
- **Diarization:** optional Python `diarize` package via `scripts/diarize_audio.py`
- **LLM:** Ollama or OpenAI-compatible for summary, live assistant, live translation, diarization name inference

### Live → batch handoff

On stop: archive PCM → ffmpeg WAV → queued job (`sourceOrigin: "recording"`) + `live_transcript.json` sidecar. See `finalizeSession()` in `liveSessionOrchestrator.ts`.

---

## Where quality suffers (root causes)

### 1. Single mixed audio track

`frontend/src/liveApi.ts` mixes mic and/or system capture into one PCM stream at 16 kHz. For Zoom/Meet exports or one room mic, diarization is required and fragile. For a native daily in the app, **per-participant tracks** would remove most speaker attribution pain.

### 2. Diarization is batch-only and segment-aligned

Flow: transcribe full file → diarize full file → align by time overlap (not word-level). Short utterances and crosstalk hurt overlap assignment. Live sessions have **no speaker labels**.

Upstream uses the `diarize` Python package (see `scripts/setup-diarization.sh`), not a documented pyannote pipeline in-repo.

### 3. No transcript refinement layer

Final text is essentially Whisper output (+ optional speakers). Spanglish, brand names (Vercel, Sentry, Jira), and punctuation are not corrected by a constrained second pass. Only a **static** initial prompt helps:

```text
--prompt "Sentry, sprint, daily, frontend, backend, webhook, API, ..."
```

(config default in `backend/src/config.ts`; customizable via `WHISPER_ARGS`.)

### 4. Live path skips some batch optimizations

Docs note **no VAD in live** to skip silent windows (`docs/architecture/live-session.md`). Live re-transcribes overlapping windows; dedup mitigates duplication but not wasted inference on silence.

### 5. No measurement

Without WER/CER/DER on fixed audios, tuning tends to chase the wrong lever (model vs prompt vs diarization vs capture).

---

## Mapping pain points to solutions

| Pain point | Primary levers (local-first) |
|------------|------------------------------|
| Bad microphones | UI level meter; optional AGC; user guidance; final full-file pass |
| Diarization unstable | Multi-track OR WhisperX-style word alignment + keep postProcessDiarization |
| Spanglish | `language auto` + mixed glossary prompt + constrained LLM formatter |
| Brand / tool names | Workspace vocabulary + allowlist correction (not free rewrite) |
| Punctuation / readability | LLM formatter by segment blocks; keep `raw_text` |
| Live worse than upload | Smaller live model + VAD gating + final merge into UI |

---

## Local-first roadmap (prioritized)

### Tier 1 — Highest impact

**A. Workspace vocabulary**

- UI: team members, clients, stack, projects, acronyms
- Inject dynamically into Whisper `--prompt` (batch + live)
- Same list for constrained local LLM formatter: fix allowlisted terms + punctuation only; do not change meaning
- Store `raw_text` and `clean_text` on segments

**B. Explicit dual-quality transcript**

- **Live:** fast model or smaller windows (latency)
- **Final:** full-file `large-v3` + VAD after stop
- UI: show “Final transcript ready” and merge/replace with correction events

**C. Evaluation harness**

- 15–25 real recordings (good/bad mic, spanglish, 2/5/8 speakers)
- Track WER, CER on names, DER (if diarizing), live latency p50/p95
- Run on every config or model change

### Tier 2 — Speakers and diarization

**D. Better alignment (single-track)**

Benchmark on your audio:

- WhisperX (word timestamps + alignment)
- Keep existing collapse / smooth / LLM naming in `postProcessDiarization`

**E. Multi-track live (if app hosts the meeting)**

Each participant sends PCM with `participantId` → ASR per track → speaker known; diarization only for overlap.

**F. Live speaker labels (optional)**

Provisional labels in live; reconcile on final pass—do not promise stable live diarization on mono mix.

### Tier 3 — Audio and live efficiency

**G. Live VAD / silence gating** — tracked in `STREAMPLAN_CHECKLIST.md`

**H. Browser audio constraints** — experiment with `echoCancellation`, `noiseSuppression`, `autoGainControl` in `getUserMedia` (currently defaults in `liveApi.ts`)

**I. Audio level meter in live UI**

### Tier 4 — Mentions and polish

**J. Fuzzy alias matching** (edit distance on tokens)

**K. Direct-address detection** — reduce false positives when name appears in narrative context

**L. Browser / system notifications** for high-intent mentions

### Tier 5 — Model strategy (local)

| Use case | Suggestion |
|----------|------------|
| Batch accuracy | `ggml-large-v3` (default in `.env.example`) |
| Live latency | `LIVE_WHISPER_MODEL_PATH` smaller model + final large pass |
| Spanglish | `language auto` + glossary + correction pass |
| Brands | Vocabulary + correction beats model swap alone |

Cloud STT (Deepgram Nova, AssemblyAI, OpenAI transcribe) can win on raw WER in hard conditions; with multi-track + glossary + final pass, local can be **good enough for internal dailies** without API cost or data leaving the machine.

---

## Suggested pipeline evolution

### Upload mode (target)

```text
1. Extract / normalize audio (ffmpeg)
2. Separate channels if present
3. VAD
4. High-accuracy ASR (large model, VAD-enabled)
5. Diarization (or skip if multi-track)
6. Align words/speakers
7. Glossary-guided correction (constrained LLM)
8. Punctuation / format (constrained LLM)
9. Summarize, export TXT/SRT/JSON
```

### Live mode (target)

```text
1. Capture per participant if possible; else mixed mono
2. ASR streaming / windowed per track or mix
3. Show partials; finalize segments on overlap cutoff
4. Mention detection on confirmed segments
5. Light correction in live (optional)
6. On stop: full-file high-quality pass + reconcile UI
7. Batch job for diarize / summarize as today
```

### Current vs target (summary)

```text
Now:
  upload → ffmpeg → whisper+VAD → optional diarize → summarize
  live → windowed whisper → mentions → finalize → batch job

Next milestones:
  1) Workspace glossary + dynamic prompt + constrained formatter (batch)
  2) Final transcript reconciliation in UI + eval suite
  3) Multi-track live OR WhisperX/alignment benchmark on real audios
```

---

## Code references

| Area | Location |
|------|----------|
| Live orchestration | `backend/src/sessions/liveSessionOrchestrator.ts` |
| Live capture | `frontend/src/liveApi.ts` |
| Whisper args / VAD | `backend/src/config.ts`, `backend/src/services/transcriptionService.ts` |
| Diarization | `backend/src/services/diarizationService.ts`, `scripts/diarize_audio.py` |
| Mentions | `backend/src/services/mentionDetectionService.ts` |
| Live gaps checklist | `docs/architecture/checklists/STREAMPLAN_CHECKLIST.md` |
| Config reference | `docs/backend/configuration.md` |

---

## Bottom line

Commercial meeting tools and interview copilots are real; they charge subscription fees and rely on cloud STT plus layered post-processing. Notadio’s direction—**local whisper.cpp, optional diarization, Ollama summaries, live sessions with mention alerts**—is differentiated and viable.

To reach **very good** quality for real dailies without abandoning local-first:

1. Solve **speaker attribution** (multi-track in-app or stronger alignment on mono)
2. Add **transcript refinement** (workspace glossary + constrained correction)
3. Make **final transcript** explicit and trustworthy in the product
4. **Measure** on real audio so improvements are objective

Swapping only the Whisper model is insufficient; the pipeline and capture strategy matter more than a single “magic” ASR endpoint.
