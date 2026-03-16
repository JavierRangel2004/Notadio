# Notadio on Windows with NVIDIA GPU

This guide is for a Windows machine that already has:

- Node.js and `npm`
- `ffmpeg`
- `whisper.cpp` built with CUDA
- A local Whisper model file
- An NVIDIA GPU visible to `nvidia-smi`

It covers everything required to make the full app work on Windows GPU:

- Fast CUDA transcription
- Whisper-based English translation
- Local speaker diarization
- Local AI summaries with Ollama

## What "fully working" means

`npm run doctor` should report:

- `.env`: `ok`
- `ffmpeg`: `ok`
- `whisper command`: `ok`
- `whisper model`: `ok`
- `Whisper CUDA support`: `ok`
- `Translation path`: `ok`
- `Diarization`: `ok`
- `Ollama`: `ok`

## Required Windows components

### 1. Whisper + CUDA

Your `.env` should point to a CUDA-enabled `whisper-cli.exe` and a local model:

```env
WHISPER_COMMAND=C:/Users/javar/GITHUB/whisper.cpp/build-cuda/bin/Release/whisper-cli.exe
WHISPER_MODEL_PATH=C:/Users/javar/GITHUB/whisper.cpp/ggml-large-v3.bin
WHISPER_ARGS=-m "{model}" -f "{input}" --output-json --output-srt --output-file "{outputBase}" --language auto
WHISPER_TRANSLATE_ARGS=-m "{model}" -f "{input}" --output-json --output-file "{outputBase}" --language auto --translate
ENABLE_ENGLISH_TRANSLATION=true
TRANSLATION_STRATEGY=whisper-first
```

That configuration gives you:

- Source transcription with Whisper on CUDA
- English translation with Whisper first
- Ollama used for summaries, not as the primary translation path

### 2. Ollama

Install Ollama, then pull the model used by the app:

```powershell
ollama serve
ollama pull llama3.2
```

If you want a different local summary model, update:

```env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
ENABLE_SUMMARY=true
```

### 3. Python diarization environment

On Windows, use the PowerShell setup script:

```powershell
npm run setup:diarization:windows
```

That creates:

- `./.local/diarize-venv`
- `./.local/diarize-venv/Scripts/python.exe`

And your `.env` should contain:

```env
DIARIZATION_COMMAND=./.local/diarize-venv/Scripts/python.exe
DIARIZATION_ARGS="{projectRoot}/scripts/diarize_audio.py" --input "{input}" --output "{outputFile}"
```

## End-to-end setup steps

Run these from the repo root:

```powershell
npm install
npm run build
npm run setup:diarization:windows
ollama serve
ollama pull llama3.2
npm run doctor
```

## Starting the app

In one terminal:

```powershell
npm run dev:backend
```

In another terminal:

```powershell
npm run dev:frontend
```

Or run both together:

```powershell
npm run dev
```

## What each subsystem does

### Transcription

- Uses `ffmpeg` to normalize media to mono 16 kHz WAV
- Uses your CUDA Whisper build for transcription
- Logs CUDA/CPU fallback state in the job processing view

### English translation

- Uses Whisper `--translate` first on Windows GPU
- Falls back to Ollama text translation only if Whisper translation fails

### Diarization

- Uses the Python `diarize` package through the venv Python
- Model weights may download on first real diarization run

### Summary generation

- Uses Ollama at `http://localhost:11434`
- Requires the configured model to be pulled locally

## Verification checklist

### Whisper runtime

```powershell
& "C:/Users/javar/GITHUB/whisper.cpp/build-cuda/bin/Release/whisper-cli.exe" -h
```

Expected:

- no command-not-found error
- output that mentions CUDA support on this machine

### Ollama

```powershell
ollama list
```

Expected:

- `llama3.2` appears in the installed model list

### Diarization

```powershell
& ".\.local\diarize-venv\Scripts\python.exe" -c "from diarize import diarize; print('diarize-ok')"
```

Expected:

- `diarize-ok`

### App readiness

```powershell
npm run doctor
```

Expected:

- no `fail` status

## Windows-specific troubleshooting

### `Ollama` is missing

Install Ollama, then start it:

```powershell
ollama serve
```

Then pull the model:

```powershell
ollama pull llama3.2
```

### `python.exe` exists but cannot run

This usually means the Microsoft Store app alias is present but Python itself is not installed correctly. Install a real Python 3.11 runtime and then re-run:

```powershell
npm run setup:diarization:windows
```

### Diarization still says disabled

Check:

- `DIARIZATION_COMMAND` points to `./.local/diarize-venv/Scripts/python.exe`
- `DIARIZATION_ARGS` includes `{projectRoot}/scripts/diarize_audio.py`

### Summary fails even after Ollama install

Check:

- `ollama serve` is running
- `ollama list` includes `llama3.2`
- `OLLAMA_BASE_URL` is `http://localhost:11434`

### Whisper falls back to CPU

Check:

- `WHISPER_COMMAND` points to your CUDA build
- `nvidia-smi` works
- the backend logs show CUDA backend initialization instead of CPU fallback
