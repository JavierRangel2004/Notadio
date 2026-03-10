# Notadio

**Local-first audio and video transcription — powered by `whisper.cpp`.**

Notadio lets you upload audio or video files, transcribe them locally with Whisper, optionally label speakers (diarization), and export results as `TXT`, `SRT`, or `JSON`.

🌐 **Live app:** `https://app.notadio.yourdomain.com` *(replace with your deployed URL)*  
📦 **Repo:** [github.com/JavierRangel2004/Notadio](https://github.com/JavierRangel2004/Notadio)

---

## Features

- Upload audio or video files (any format `ffmpeg` can read)
- Transcribe locally with `whisper.cpp` — no API key, no cloud costs
- Optional English translation output
- Optional speaker diarization (speaker labeling)
- Export `TXT`, `SRT`, `JSON` artifacts
- Live progress telemetry: elapsed time, ETA, Whisper backend (CPU/GPU)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite |
| Backend | Express + TypeScript |
| Media pipeline | `ffmpeg` |
| Transcription | `whisper.cpp` via CLI |

---

## Local Development Setup

### Requirements

- **Node.js** `20+` (LTS recommended) — [nodejs.org](https://nodejs.org)
- **npm** (bundled with Node.js)
- **ffmpeg** available in your `PATH`
- **whisper-cli** (`whisper.cpp` binary) available in your `PATH` or configured via `.env`
- A local Whisper model file (e.g. `ggml-large-v3.bin`)
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

### 6) Run the app

```bash
npm run dev
```

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8787 |

---

## First-Run Success Criteria

A successful first run means **all** of the following are true:

- The job reaches `Transcript ready`
- `GET /api/jobs/:id/transcript` returns non-empty `source.text` and `source.segments`
- The UI shows transcript content (not an empty transcript warning)
- Downloaded TXT/SRT/JSON artifacts contain real text

> If the UI shows an empty transcript but the job shows 100% complete, treat this as a backend failure and check the live process logs.

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

# Performance profile: auto | speed | balanced | quality
WHISPER_PERF_PROFILE=auto

# Number of CPU threads for Whisper (leave blank for auto)
WHISPER_THREADS=

# Whether to generate an English translation track in addition to source transcription
ENABLE_ENGLISH_TRANSLATION=true

# Max lines of process logs kept per job
JOB_LOG_LIMIT=300

# Optional diarization (speaker labeling) command
DIARIZATION_COMMAND=
DIARIZATION_ARGS="{projectRoot}/scripts/diarize_audio.py" --input "{input}" --output "{outputFile}"

# Optional Ollama summary generation
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
ENABLE_SUMMARY=true

# Concurrency controls
WHISPER_PARALLEL=false
MAX_CONCURRENT_JOBS=1
```

---

## Performance & Live Telemetry

The frontend shows per-job live telemetry:

- Overall weighted progress
- Elapsed time and ETA
- Detected processing profile and thread recommendation
- Actual Whisper runtime backend: `cpu`, `gpu`, or `pending` (inferred from Whisper logs)
- Bounded live logs from `ffmpeg`, `whisper-cli`, and diarization

To disable translation for long jobs (saves ~50% of processing time):

```env
ENABLE_ENGLISH_TRANSLATION=false
```

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

The command must write JSON to `{outputFile}` in one of these formats:

```json
{ "segments": [{ "start": 0.0, "end": 4.2, "speaker": "Speaker 1" }] }
```
or
```json
[{ "start": 0.0, "end": 4.2, "speaker": "Speaker 1" }]
```

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
- No external API keys required — all transcription runs locally.
