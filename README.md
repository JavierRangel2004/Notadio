# Notadio

Local-first transcription app for audio and video files.

Notadio is designed to run on your machine with free local tooling:

- Upload audio or video files
- Transcribe locally with `whisper.cpp`
- Optionally run local diarization (speaker labeling)
- Export artifacts as `TXT`, `SRT`, and `JSON`
- Optionally export an English translation variant

## Tech Stack

- Frontend: React + Vite
- Backend: Express + TypeScript
- Media pipeline: `ffmpeg`
- Transcription engine: `whisper.cpp` via CLI adapter

## Requirements

- Node.js `20+` (LTS recommended)
- npm (comes with Node.js)
- `ffmpeg` available in your `PATH`
- `whisper.cpp` binary (`whisper-cli`) available in your `PATH` (or configure executable path in `.env`)
- A local Whisper model file (for example `ggml-large-v3.bin`)

## 1) Clone and install

```bash
git clone <your-repo-url>
cd Notadio
npm install
```

## 2) Create your local environment file

Copy the template:

- Windows (PowerShell):

```powershell
Copy-Item .env.example .env
```

- macOS/Linux:

```bash
cp .env.example .env
```

Then open `.env` and set at least:

- `FFMPEG_PATH` (default: `ffmpeg`)
- `WHISPER_COMMAND` (default: `whisper-cli`)
- `WHISPER_MODEL_PATH` (absolute path to your `.bin` model file)
- Optional tuning:
  - `WHISPER_PERF_PROFILE=auto|speed|balanced|quality`
  - `WHISPER_THREADS=<number>`
  - `ENABLE_ENGLISH_TRANSLATION=true|false`
  - `JOB_LOG_LIMIT=300`

## 3) Install local dependencies (Windows + macOS)

### Install `ffmpeg`

- Windows (choose one):
  - `winget install Gyan.FFmpeg`
  - `choco install ffmpeg`
- macOS:
  - `brew install ffmpeg`

Verify:

```bash
ffmpeg -version
```

### Install `whisper.cpp`

You can either use a prebuilt binary or build from source.

#### Option A (recommended): prebuilt binary

1. Download a release binary for your OS from the official `whisper.cpp` releases.
2. Ensure the executable is named `whisper-cli` (or set its full path in `WHISPER_COMMAND`).
3. Add its directory to your `PATH`.

#### Option B: build from source

- Windows (PowerShell, using Visual Studio Build Tools + CMake):

```powershell
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
cmake -B build
cmake --build build --config Release
```

The binary is typically under `build/bin/Release/` or `build/bin/`.

- macOS:

```bash
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
cmake -B build
cmake --build build --config Release
```

The binary is typically under `build/bin/`.

### Download a Whisper model file

Download a GGML model (for example `ggml-large-v3.bin`) and store it locally.
Then set `WHISPER_MODEL_PATH` in `.env` to the absolute file path.

Example:

- Windows: `C:/models/ggml-large-v3.bin`
- macOS: `/Users/<you>/models/ggml-large-v3.bin`

## 4) Run the app

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8787`

## Configuration reference (`.env`)

Default template:

```env
PORT=8787
WEB_ORIGIN=http://localhost:5173
STORAGE_ROOT=./data
FFMPEG_PATH=ffmpeg
WHISPER_COMMAND=whisper-cli
WHISPER_MODEL_PATH=C:/models/ggml-large-v3.bin
WHISPER_ARGS=-m "{model}" -f "{input}" --output-json --output-srt --output-file "{outputBase}" --language auto
WHISPER_TRANSLATE_ARGS=-m "{model}" -f "{input}" --output-json --output-file "{outputBase}" --language auto --translate
WHISPER_PERF_PROFILE=auto
WHISPER_THREADS=
ENABLE_ENGLISH_TRANSLATION=true
JOB_LOG_LIMIT=300
DIARIZATION_COMMAND=
DIARIZATION_ARGS=--input "{input}" --output "{outputFile}"
```

## Performance and progress telemetry

- Jobs now expose live telemetry through the existing `GET /api/jobs/:id` payload.
- The frontend shows:
  - weighted overall progress
  - elapsed time and ETA
  - detected processing profile and thread recommendation
  - actual Whisper runtime backend (`cpu`, `gpu`, or `pending`) inferred from runtime logs
  - bounded live process logs from `ffmpeg`, `whisper-cli`, and diarization
- Translation can be disabled for long runs with `ENABLE_ENGLISH_TRANSLATION=false`.

## First-run success criteria

A healthy first run means all of the following are true:

- the job reaches `Transcript ready`
- `GET /api/jobs/:id/transcript` returns non-empty `source.text` and `source.segments`
- the UI shows transcript content, not an empty transcript warning
- downloaded TXT/SRT/JSON source artifacts contain transcript content

If the UI says the transcript output is empty, treat that as a failed run even if progress reached 100%.

## Optional diarization

Speaker labeling is optional and best-effort in v1.

If you have a local diarization command, set:

- `DIARIZATION_COMMAND`
- `DIARIZATION_ARGS`

Your command must write JSON to the `{outputFile}` path.

Accepted output formats:

```json
{
  "segments": [
    { "start": 0.0, "end": 4.2, "speaker": "Speaker 1" }
  ]
}
```

or:

```json
[
  { "start": 0.0, "end": 4.2, "speaker": "Speaker 1" }
]
```

## Troubleshooting

- `ffmpeg: command not found`
  - Confirm installation, then restart terminal and run `ffmpeg -version`.
- `whisper-cli: command not found`
  - Add binary location to `PATH` or set full executable path in `WHISPER_COMMAND`.
- Model file errors
  - Verify `WHISPER_MODEL_PATH` points to an existing `.bin` file.
- CORS or frontend/backend mismatch
  - Confirm `WEB_ORIGIN` and app ports match your local setup.
- Job says complete but transcript is empty
  - This should now be treated as a backend failure. Check the live logs and confirm the Whisper JSON shape is being parsed.
- Host GPU detected but runtime says `cpu`
  - Your machine has an NVIDIA GPU, but the configured `whisper-cli` binary is not using a working GPU backend.

## Whisper runtime diagnostics

Run the first-run Whisper diagnostic script from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\diagnose-whisper-runtime.ps1
```

The script checks:

- resolved `WHISPER_COMMAND`
- configured model path
- basic `whisper-cli --help` command execution
- host-level NVIDIA visibility through `nvidia-smi`

Important: `nvidia-smi` only proves that Windows can see the GPU. The app reports actual runtime backend from Whisper logs, which is the authoritative signal for whether transcription used CPU or GPU.

## Windows Git auth remediation

Repeated GitHub account prompts in Windows are usually caused by local Git credential state, not this app.

Run the included diagnostic script from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\diagnose-git-auth.ps1
```

The script reports:

- detected `git.exe` locations in `PATH`
- `credential.helper` values with config origins
- saved GitHub-related Windows Credential Manager entries
- current `origin` remote URL and whether it is `https` or `ssh`

Recommended one-time remediation:

1. Standardize Git Credential Manager:

```powershell
git config --global credential.helper manager-core
```

2. Remove stale GitHub credentials from Windows Credential Manager:

```powershell
cmdkey /list | Select-String github
```

Delete outdated `git:https://github.com` entries from Credential Manager, then sign in once when prompted.

3. If you intentionally use multiple GitHub accounts over HTTPS, scope credentials by path:

```powershell
git config --global credential.useHttpPath true
```

4. If prompts persist, move the repo to SSH and use host aliases per account in `%USERPROFILE%\.ssh\config`.

## Notes

- v1 is single-user and stores jobs locally under `data/`.
- If diarization is unavailable, transcription still succeeds and returns a warning.
- Backend and frontend are separated to simplify future Docker/VPS deployment.
