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
- `WHISPER_ARGS`: CLI args template for source transcription (supports `{model}`, `{input}`, `{outputBase}`, `{vocabulary}` placeholders)
- `WHISPER_TRANSLATE_ARGS`: CLI args template for Whisper translation
- `WHISPER_VOCABULARY`: comma-separated brand/company names, technical terms, and Spanglish words injected wherever `{vocabulary}` appears in the args templates (batch + live). Biases Whisper's initial prompt toward correct spelling. Live sessions also append the session's aliases.

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
- `SUMMARY_MAX_OUTPUT_TOKENS` (OpenCode / OpenAI-compatible; default `8192`)
- `SUMMARY_OLLAMA_NUM_PREDICT` (optional; local Ollama output cap)
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

## Upload / Disk Safeguards

- `UPLOAD_MAX_BYTES`: maximum upload size accepted by multer (default 12 GiB)
- `MIN_FREE_DISK_BYTES`: minimum free space that must remain on `STORAGE_ROOT` after reserving job space (default 10 GiB)
- `DISK_SPACE_JOB_MULTIPLIER`: multiplier applied to source file size when estimating per-job disk needs (default `2.2`)
- `DISK_SPACE_FIXED_HEADROOM_BYTES`: fixed bytes added to each job estimate for WAV/JSON/artifacts (default 512 MiB)

Uploads and job processing fail fast with HTTP `507` when the storage volume does not have enough free space.

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
- `LIVE_WHISPER_MODEL_PATH`: smaller/faster model for live windows (final batch pass still uses `WHISPER_MODEL_PATH`)
- `LIVE_WHISPER_LANGUAGE`: pin the language for live windows (e.g. `es`); leave unset to inherit `--language auto`. Stabilizes Spanglish output by avoiding per-window language flip-flop

Live windows reuse the same VAD / hallucination / `max-len` guards as batch
(`applyWhisperQualityArgs`) and run through `trimTrailingHallucinatedLoop`.

Mentions and resilience:

- `LIVE_MENTION_CONTEXT_WINDOW_MS`
- `LIVE_SESSION_GRACE_PERIOD_MS`

Live translation:

- `LIVE_TRANSLATION_ENABLED`
- `LIVE_TRANSLATION_SOURCE_LANG`
- `LIVE_TRANSLATION_TARGET_LANG`
- `LIVE_TRANSLATION_MAX_BATCH`

## LLM Provider Abstraction

By default all LLM features use `OLLAMA_BASE_URL` / `OLLAMA_MODEL`. Resolution order for each setting is **per-service → global → Ollama default** (first non-empty wins).

Service keys: `SUMMARY`, `LIVE_ASSISTANT`, `LIVE_TRANSLATION`, `TRANSLATION`, `DIARIZATION`

Global provider switch (route every LLM feature through one OpenAI-compatible gateway — OpenCode, OpenAI, OpenRouter, Groq, ... — with an API key):

- `LLM_PROVIDER`: `ollama` (default) or `openai-compatible`
- `LLM_BASE_URL`: endpoint (e.g. `https://your-endpoint/v1`)
- `LLM_API_KEY`: API key
- `LLM_MODEL`: model identifier

Per-service overrides (take priority over the globals):

- `LLM_{SERVICE}_PROVIDER`: `ollama` (default) or `openai-compatible`
- `LLM_{SERVICE}_MODEL`: model identifier override
- `LLM_{SERVICE}_BASE_URL`: endpoint override
- `LLM_{SERVICE}_API_KEY`: API key (for openai-compatible providers)

Legacy global fallback for openai-compatible (still honored; prefer `LLM_BASE_URL` / `LLM_API_KEY`):

- `LLM_OPENAI_BASE_URL`
- `LLM_OPENAI_API_KEY`
