# Backend Configuration (`.env`)

Source of truth:

- `.env.example`
- `backend/src/config.ts`

The backend loads configuration from (in order):

1. `<projectRoot>/.env`
2. `<backendRoot>/.env`
3. process environment

## Required Dependencies

These are required for the core transcription flow:

- Node.js (see `package.json` `engines.node`)
- `ffmpeg` (`FFMPEG_PATH`)
- `whisper-cli` (`WHISPER_COMMAND`)
- a local Whisper model file (`WHISPER_MODEL_PATH`)

## Storage

- `STORAGE_ROOT`: root directory where job files and artifacts are stored (default `./data`)

## Whisper / Transcription

- `WHISPER_COMMAND`: path or name of `whisper-cli`
- `WHISPER_MODEL_PATH`: path to `.bin` model file
- `WHISPER_ARGS`: CLI args template for source transcription
- `WHISPER_TRANSLATE_ARGS`: CLI args template for Whisper translation

Quality/long-form guards (used by the transcription service):

- `WHISPER_ENABLE_VAD`
- `WHISPER_VAD_MODEL_PATH`
- `WHISPER_HALLUCINATION_GUARD`
- `WHISPER_MAX_CONTEXT`
- `WHISPER_MAX_LEN`
- `WHISPER_SPLIT_ON_WORD`
- `WHISPER_SUPPRESS_NST`
- `WHISPER_NO_SPEECH_THOLD`
- `WHISPER_VAD_THRESHOLD`
- `WHISPER_VAD_MIN_SPEECH_MS`
- `WHISPER_VAD_MIN_SILENCE_MS`
- `WHISPER_VAD_SPEECH_PAD_MS`

## Translation

- `ENABLE_ENGLISH_TRANSLATION`
- `TRANSLATION_STRATEGY`: `whisper-first | hybrid | ollama-first`

## Summarization (Ollama)

- `ENABLE_SUMMARY`
- `OLLAMA_BASE_URL`
- `OLLAMA_MODEL`

Summary runtime tuning:

- `SUMMARY_CHUNK_CONCURRENCY`
- `SUMMARY_REDUCE_MIN_PARTIALS`
- `SUMMARY_DIRECT_CHAR_LIMIT`
- `SUMMARY_CHUNK_CHAR_LIMIT`
- `SUMMARY_MAX_INPUT_CHARS`
- `SUMMARY_BLOCK_MAX_CHARS`
- `SUMMARY_OLLAMA_NUM_PREDICT` (optional)
- `SUMMARY_OLLAMA_NUM_CTX` (optional)
- `SUMMARY_OLLAMA_KEEP_ALIVE` (optional)

## Diarization (Optional, Python)

Diarization is enabled only if `DIARIZATION_COMMAND` is set.

- `DIARIZATION_COMMAND`: python executable path
- `DIARIZATION_ARGS`: args template (default points at `scripts/diarize_audio.py`)

Setup:

- `npm run setup:diarization` (macOS/Linux)
- `npm run setup:diarization:windows` (Windows)

## Concurrency

- `MAX_CONCURRENT_JOBS`: limits concurrent batch jobs
- `WHISPER_PARALLEL`: controls parallelism within Whisper + translation paths (see code)

## Live Sessions (Real-Time Transcription)

Feature flags:

- `LIVE_TRANSCRIPTION_ENABLED`
- `LIVE_ASSISTANT_ENABLED`

Windowing and performance:

- `LIVE_WINDOW_MS`
- `LIVE_INTERVAL_MS`
- `LIVE_OVERLAP_MS`
- `LIVE_WHISPER_THREADS`
- `LIVE_MAX_CONCURRENT_WINDOWS`
- `LIVE_MIN_WINDOW_MS`

Mentions and resilience:

- `LIVE_MENTION_CONTEXT_WINDOW_MS`
- `LIVE_SESSION_GRACE_PERIOD_MS`
