# Windows + NVIDIA GPU Setup

This guide documents how to run Notadio on Windows with a CUDA-capable `whisper-cli.exe`.

Source of truth:

- `.env.example`
- `backend/src/config.ts`
- `scripts/setup-diarization.ps1` (optional diarization)

## Prerequisites

- Node.js (see `package.json` `engines.node`)
- `ffmpeg` installed and accessible
- `whisper.cpp` built with CUDA, providing `whisper-cli.exe`
- A Whisper model file (`.bin`)
- (Optional) Ollama for summaries
- (Optional) Python environment for diarization via the repo scripts

## Minimal `.env`

Start from `.env.example` and set at least:

```env
WHISPER_COMMAND=C:\\path\\to\\whisper-cli.exe
WHISPER_MODEL_PATH=C:\\path\\to\\ggml-large-v3.bin
```

If you also want translation:

```env
ENABLE_ENGLISH_TRANSLATION=true
TRANSLATION_STRATEGY=whisper-first
```

## Install and Run

From the repo root:

```powershell
npm install
npm run doctor
npm run dev
```

Backend: `http://localhost:8787`  
Frontend: `http://localhost:5173`

## Optional: Ollama Summaries

```powershell
ollama serve
ollama pull llama3.2
```

Set in `.env`:

```env
ENABLE_SUMMARY=true
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

## Optional: Diarization

Run the Windows setup script (defined in root `package.json`):

```powershell
npm run setup:diarization:windows
```

Then set:

```env
DIARIZATION_COMMAND=./.local/diarize-venv/Scripts/python.exe
DIARIZATION_ARGS="{projectRoot}/scripts/diarize_audio.py" --input "{input}" --output "{outputFile}"
```

## Notes / Unknowns

- `whisper.cpp` CUDA builds differ by machine. If `npm run doctor` reports a CPU fallback when you expect GPU, verify that `WHISPER_COMMAND` points to the CUDA-enabled binary.
