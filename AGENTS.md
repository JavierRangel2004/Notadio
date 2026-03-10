# Repository Guidelines

## Project Structure & Module Organization
`Notadio` is an npm workspace with two apps: `frontend/` for the React + Vite UI and `backend/` for the Express + TypeScript API. Backend source lives under `backend/src/`, organized by `services/`, `store/`, `utils/`, and `scripts/`. Frontend code lives in `frontend/src/` with the main app in `App.tsx` and shared API calls in `api.ts`. Root `scripts/` holds setup helpers, `.env.example` documents runtime config, and `data/` is local job storage and should stay untracked.

## Build, Test, and Development Commands
Run `npm install` at the repo root once. Use `npm run dev` to start both workspaces, `npm run dev:frontend` for Vite only, and `npm run dev:backend` for the API only. Use `npm run build` to compile both apps, or `npm run build:frontend` / `npm run build:backend` when working in one area. Runtime checks live behind `npm run doctor`. Optional diarization setup uses `npm run setup:diarization`.

## Coding Style & Naming Conventions
The repo uses strict TypeScript in both workspaces. Follow the existing style: 2-space indentation, semicolons omitted, double-quoted imports/strings in TS, and descriptive camelCase for variables/functions. Use PascalCase for React components and types, and keep backend service files named by responsibility, such as `transcriptionService.ts`. No dedicated lint or Prettier config is checked in, so match the surrounding file style closely and keep changes minimal.

## Testing Guidelines
Automated tests currently live in the backend and run with Node’s built-in test runner via `npm --workspace backend test`. Add tests next to the code they cover using the `*.test.ts` suffix, following the existing `backend/src/services/transcriptionService.test.ts` pattern. Frontend changes do not yet have an automated test harness, so include manual verification steps for upload flow, progress updates, transcript rendering, and exports.

## Commit & Pull Request Guidelines
Recent history favors short, imperative subjects, sometimes with a scope prefix, for example `docs: update README...` or `Optimize performance: ...`. Keep commit titles focused on one change and avoid mixing frontend, backend, and docs churn without reason. PRs should explain the behavior change, list any `.env` or system dependency impact (`ffmpeg`, `whisper-cli`, Ollama, diarization), link related issues, and include screenshots for UI changes.

## Configuration & Runtime Notes
Copy `.env.example` to `.env` before local work. `ffmpeg`, `whisper-cli`, and a local Whisper model are required for full transcription runs; diarization and summaries are optional extensions. Keep secrets, local models, generated transcripts, and `data/` contents out of version control.
