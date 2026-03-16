# Notadio

**Local-first audio and video transcription — powered by `whisper.cpp`.**

Notadio lets you upload audio or video files—or record directly from your microphone—to transcribe them locally with Whisper, optionally label speakers (diarization), and export results as `TXT`, `SRT`, or `JSON`. 

It also includes an advanced, fully local AI summarization pipeline powered by Ollama, capable of handling extremely long transcripts via chunking and MapReduce workflows.

🌐 **Live app:** `https://app.notadio.yourdomain.com` *(replace with your deployed URL)*  
📦 **Repo:** [github.com/JavierRangel2004/Notadio](https://github.com/JavierRangel2004/Notadio)

---

## Features

- **Upload & Record:** Upload audio/video files (any format `ffmpeg` can read) or record directly from your microphone in the browser.
- **Local Transcription:** Transcribe locally with `whisper.cpp` — no API key, no cloud costs.
- **Smart Summarization (Ollama):** Choose from presets (Meeting, WhatsApp Voice Note, Generic Media). Automatically chunks long transcripts, summarizes concurrently, and reduces them into a cohesive executive recap. Fallbacks to a smart extractive summary if the LLM is unavailable.
- **Speaker Diarization:** Optional speaker labeling to identify who said what.
- **English Translation:** Optional English translation output on top of the original language.
- **Post-processing Enhancements:** Base transcription runs first; you can optionally trigger Summarization, Diarization, or Translation later.
- **Workspace Management:** View, manage, and delete multiple transcription jobs in your local workspace.
- **Export Artifacts:** Download `TXT`, `SRT`, or `JSON` formats for source or translated variants.
- **Live Progress Telemetry:** View elapsed time, ETA, Whisper backend (CPU/GPU) usage, and advanced pipeline timings directly in the UI.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Backend | Express + TypeScript |
| Media pipeline | `ffmpeg` |
| Transcription | `whisper.cpp` via CLI |
| Summarization | `Ollama` |
| Diarization | Local Python environment |

---

## Local Development Setup

### Requirements

- **Node.js** `20+` (LTS recommended) — [nodejs.org](https://nodejs.org)
- **npm** (bundled with Node.js)
- **ffmpeg** available in your `PATH`
- **whisper-cli** (`whisper.cpp` binary) available in your `PATH` or configured via `.env`
- A local Whisper model file (e.g. `ggml-large-v3.bin`)
- A local Whisper VAD model file (recommended production path for long-form media)
- **Python 3.9+** (required only if you want to enable local speaker diarization)
- **Ollama** (required only if you want to enable local AI meeting summaries)

### 1) Clone and install

```bash
git clone git@github.com:JavierRangel2004/Notadio.git
cd Notadio
npm install
```

### 2) Create your environment file

**macOS/Linux:**
```bash
cp .env.example .env
```

**Windows (PowerShell):**
```powershell
Copy-Item .env.example .env
```

Open `.env` and set at minimum:

```env
WHISPER_MODEL_PATH=./.local/models/ggml-large-v3.bin
```

Relative paths in `.env` are resolved from the project root, so `./.local/...` works on macOS, Linux, and Windows.

Full config reference is at the end of this README.

### 3) Install system dependencies

#### Install `ffmpeg`

| OS | Command |
|---|---|
| macOS | `brew install ffmpeg` |
| Ubuntu/Debian | `sudo apt install -y ffmpeg` |
| Windows | `winget install Gyan.FFmpeg` or `choco install ffmpeg` |

Verify: `ffmpeg -version`

#### Install `whisper.cpp`

**Option A — Download a prebuilt binary (easiest):**

1. Go to [github.com/ggml-org/whisper.cpp/releases](https://github.com/ggml-org/whisper.cpp/releases)
2. Download the binary for your OS.
3. Rename it to `whisper-cli` and add to your `PATH` (or set full path in `WHISPER_COMMAND` in `.env`).

**Option B — Build from source:**

```bash
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --config Release
# Binary is at build/bin/whisper-cli (linux/mac) or build/bin/Release/whisper-cli.exe (windows)
```

#### Download a Whisper model file

Available models: [huggingface.co/ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp)

```bash
# large-v3 — best quality (~3 GB, needs ≥8 GB RAM)
wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin

# medium.en — faster, English-only (~1.5 GB)
wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.en.bin

# small — fastest (~500 MB, lower quality)
wget https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
```

Set `WHISPER_MODEL_PATH` in `.env` to the absolute path of the downloaded file.

#### Download the Whisper VAD model

For long recordings, Notadio uses Whisper VAD plus conservative decoder defaults to reduce trailing silence hallucinations and repeated end-of-file loops.

```powershell
C:\Users\javar\GITHUB\whisper.cpp\models\download-vad-model.cmd silero-v6.2.0 .\.local\models
```

Set `WHISPER_VAD_MODEL_PATH=./.local/models/ggml-silero-v6.2.0.bin` in `.env`.

### 4) (Optional) Enable Extensions

Notadio supports fully local speaker diarization and meeting summaries.

**Speaker Diarization:**
Run the setup script to create a local Python environment for the `diarize` package:
```bash
bash scripts/setup-diarization.sh
```
*(The script will tell you what to put in your `.env` for `DIARIZATION_COMMAND`)*

**AI Meeting Summaries:**
Install [Ollama](https://ollama.com) and pull a model:
```bash
ollama pull llama3.2
```
If Ollama is not already running as a background service on your machine, start it in another terminal:
```bash
ollama serve
```
*(Ensure `OLLAMA_MODEL=llama3.2` and `ENABLE_SUMMARY=true` are set in `.env`)*

### 5) Verify your runtime

Run the built-in runtime doctor before starting the app:
```bash
npm run doctor
```

It checks your resolved `.env`, storage path, `ffmpeg`, `whisper-cli`, Whisper model path, optional diarization Python env, and Ollama connectivity/model availability.
When `WHISPER_ENABLE_VAD=true`, doctor also checks for Whisper VAD support and a valid local VAD model path.

### 6) Run the app

```bash
npm run dev
```

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8787 |

---

## Configuration Reference (`.env`)

```env
# Server listen port
PORT=8787

# Allowed frontend origin (CORS). Set to your Netlify URL in production.
WEB_ORIGIN=http://localhost:5173

# Local storage root for job files and artifacts
STORAGE_ROOT=./data

# System binaries
FFMPEG_PATH=ffmpeg
WHISPER_COMMAND=whisper-cli

# Whisper GGML model file. Relative paths resolve from the project root.
WHISPER_MODEL_PATH=./.local/models/ggml-large-v3.bin

# Whisper CLI argument templates ({model}, {input}, {outputBase} are substituted at runtime)
WHISPER_ARGS=-m "{model}" -f "{input}" --output-json --output-srt --output-file "{outputBase}" --language auto
WHISPER_TRANSLATE_ARGS=-m "{model}" -f "{input}" --output-json --output-file "{outputBase}" --language auto --translate

# Whisper long-form quality guards
WHISPER_ENABLE_VAD=true
WHISPER_VAD_MODEL_PATH=./.local/models/ggml-silero-v6.2.0.bin
WHISPER_HALLUCINATION_GUARD=true
WHISPER_MAX_CONTEXT=0
WHISPER_MAX_LEN=160
WHISPER_SPLIT_ON_WORD=true
WHISPER_SUPPRESS_NST=true
WHISPER_NO_SPEECH_THOLD=0.72
WHISPER_VAD_THRESHOLD=0.5
WHISPER_VAD_MIN_SPEECH_MS=250
WHISPER_VAD_MIN_SILENCE_MS=350
WHISPER_VAD_SPEECH_PAD_MS=120

# Performance profile: auto | speed | balanced | quality
WHISPER_PERF_PROFILE=auto

# Number of CPU threads for Whisper (leave blank for auto)
WHISPER_THREADS=

# Whether to generate an English translation track in addition to source transcription
ENABLE_ENGLISH_TRANSLATION=true

# Max lines of process logs kept per job
JOB_LOG_LIMIT=300

# Optional diarization (speaker labeling) command
# Leave blank until you run `bash scripts/setup-diarization.sh`
DIARIZATION_COMMAND=
DIARIZATION_ARGS="{projectRoot}/scripts/diarize_audio.py" --input "{input}" --output "{outputFile}"

# Optional Ollama summary generation
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
ENABLE_SUMMARY=true
# How many chunks to process in parallel for long transcripts
SUMMARY_CHUNK_CONCURRENCY=2
# Minimum chunks needed to trigger a "Reduce" stage. If fewer chunks, it merges locally.
SUMMARY_REDUCE_MIN_PARTIALS=3

# Concurrency controls
WHISPER_PARALLEL=false
MAX_CONCURRENT_JOBS=1
```

---

## AI Summarization Workflow

Notadio features an advanced pipeline designed for transcripts of any length. 
- **Short transcripts:** Get a direct, single-pass executive summary from Ollama.
- **Long transcripts:** Split into chunks and summarized concurrently (`SUMMARY_CHUNK_CONCURRENCY`). Partial chunks are reduced into one final, cohesive summary. If fewer chunks are found than `SUMMARY_REDUCE_MIN_PARTIALS`, Notadio merges them locally without hitting Ollama again.
- **Failures / Sparse Context:** If Ollama goes down or fails to output a usable JSON schema, Notadio falls back to a locally generated, extractive summary that isolates key terms, queries, and decisions based on term frequency within the transcript. 
- **Summary Presets:** During the "Enhancements" phase, users can tailor the output style (Meeting Recap, Voice Note, Generic Media).

---

## Performance & Live Telemetry

The frontend shows per-job live telemetry:
- Overall weighted progress across pipeline stages (transcribe, translate, diarize, summarize).
- Elapsed time and ETA.
- Detected processing profile and thread recommendation.
- Live Whisper runtime backend: `cpu`, `gpu`, or `pending`.
- Pipeline timings and summary diagnostics (useful for debugging chunk lengths, LLM calls, and strategy fallbacks).

---

## Optional: Speaker Diarization

Notadio has built-in support for local speaker diarization using the `diarize` Python package. 
Run the setup script (`bash scripts/setup-diarization.sh`) which will configure your environment and provide the necessary `.env` variables:

```env
DIARIZATION_COMMAND=./.local/diarize-venv/bin/python
DIARIZATION_ARGS="{projectRoot}/scripts/diarize_audio.py" --input "{input}" --output "{outputFile}"
```

`DIARIZATION_COMMAND` and `WHISPER_MODEL_PATH` may be absolute paths or project-root-relative paths.
`{projectRoot}` in `DIARIZATION_ARGS` is replaced automatically by the backend.

If diarization is unavailable, transcription still succeeds and returns a warning.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ffmpeg: command not found` | Confirm installation, restart terminal, run `ffmpeg -version` |
| `whisper-cli: command not found` | Add binary directory to `PATH`, or set `WHISPER_COMMAND` to the full absolute path |
| Model file errors | Verify `WHISPER_MODEL_PATH` points to an existing `.bin` file |
| CORS errors / API unreachable | Confirm `WEB_ORIGIN` in `.env` matches your frontend URL |
| Job shows 100% but transcript is empty | Backend processing failure — check the live logs in the UI for the specific error |
| GPU detected but runtime shows `cpu` | Your `whisper-cli` binary was not compiled with CUDA/Metal support |
| AI Summary fails / skipped | Check Ollama is running (`ollama serve`). View "Summary Diagnostics" on the job page to check for JSON parsing or sparse output failures. Adjust `OLLAMA_MODEL`. |

### Whisper Runtime Diagnostic Script

```bash
# Windows only
powershell -ExecutionPolicy Bypass -File .\scripts\diagnose-whisper-runtime.ps1
```

Checks: resolved `WHISPER_COMMAND`, model path, `whisper-cli --help`, `nvidia-smi` GPU visibility.

---

## Deployment (Production)

For always-on deployment, see **[DEPLOYMENT_PLAN.md](./DEPLOYMENT_PLAN.md)**.

The plan covers:

- VPS provisioning (Hetzner ~$10/mo recommended)
- `whisper.cpp` installation on the server
- Netlify frontend deployment (free)
- Caddy reverse proxy with automatic HTTPS
- **Single-user HTTP Basic Auth** (password-protect the API so only you can access it)
- systemd service for auto-restart
- DNS configuration

---

## Project Structure

```
Notadio/
├── frontend/          # React + Vite app
│   └── src/
├── backend/           # Express + TypeScript API
│   └── src/
├── data/              # Runtime job storage (gitignored)
├── scripts/           # Diagnostic PowerShell scripts
├── .env.example       # Environment template
├── DEPLOYMENT_PLAN.md # Full VPS deployment guide
└── package.json       # Monorepo root (npm workspaces)
```

---

## Notes

- v1 is single-user; jobs are stored locally under `data/`.
- Backend and frontend are in separate npm workspaces for easy independent deployment.
- No external API keys required — all processing runs locally.
