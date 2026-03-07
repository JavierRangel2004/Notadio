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
DIARIZATION_COMMAND=
DIARIZATION_ARGS=--input "{input}" --output "{outputFile}"
```

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

## Notes

- v1 is single-user and stores jobs locally under `data/`.
- If diarization is unavailable, transcription still succeeds and returns a warning.
- Backend and frontend are separated to simplify future Docker/VPS deployment.
