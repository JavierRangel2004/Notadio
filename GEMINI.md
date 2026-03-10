# Project Overview

Notadio is a local-first audio and video transcription web application powered by `whisper.cpp`. It allows users to upload media files, transcribe them locally without incurring API costs or requiring cloud services, translate output to English, identify speakers (diarization), and generate AI meeting summaries. It supports exporting results to `TXT`, `SRT`, and `JSON` formats.

The project is structured as a monorepo using npm workspaces:
- **Frontend:** Built with React and Vite.
- **Backend:** Built with Express and TypeScript.
- **Media Pipeline & AI:** Relies on `ffmpeg` for media normalization, `whisper.cpp` (CLI) for transcription/translation, local Python environment (`diarize`) for speaker diarization, and Ollama for AI summaries.

# Building and Running

The project leverages `npm-run-all` at the root directory to manage the workspaces.

**Prerequisites:**
- Node.js 20+
- `ffmpeg` available in PATH
- `whisper-cli` binary available in PATH
- A Whisper model file (e.g., `.bin` file)
- An appropriately configured `.env` file (copied from `.env.example`).
- (Optional) Python 3.9+ for diarization
- (Optional) Ollama for summaries

**Key Commands:**

- **Start Development Servers (Frontend & Backend):**
  ```bash
  npm run dev
  ```
  *Frontend runs at `http://localhost:5173` and backend API at `http://localhost:8787`.*

- **Build Production Assets:**
  ```bash
  npm run build
  ```
  *(This runs `build:backend` and `build:frontend` sequentially)*

- **Verify Runtime Environment:**
  ```bash
  npm run doctor
  ```
  *(Checks `.env` configuration, binaries, models, and Python/Ollama dependencies)*

- **Setup Local Diarization Environment:**
  ```bash
  npm run setup:diarization
  ```

# Development Conventions

- **Monorepo Structure:** The codebase is split into `frontend/` and `backend/` directories, managed via npm workspaces. Commands can be scoped using the `--workspace` flag (e.g., `npm --workspace frontend run ...`).
- **Language:** TypeScript is primarily used across both the frontend and backend. 
- **Styling:** The frontend employs a premium dark design system implemented through plain CSS (`styles.css`) leveraging strict base color hexes and modular, glassmorphic layout principles. Accessibility (focus states, visual hierarchy, ARIA tags) is heavily prioritized.
- **Local AI execution:** The app architecture heavily focuses on local inference scripts spawned from the Node.js backend. Paths to models, binaries, and local scripts are heavily configurable through `.env`.
- **Error Handling:** The backend spawns child processes for compute-heavy tasks (`whisper`, `ffmpeg`, python scripts) and streams telemetry back to the frontend.
