# Notadio Documentation

This `docs/` tree is the source of truth for developer documentation.

## Quick Links

- `docs/REPO_INVENTORY.md`: Inventory of repo files (gitignore-aware)
- `docs/DOCS_AUDIT.md`: Classification of all Markdown docs
- `docs/architecture/overview.md`: System overview (batch jobs + live sessions)
- `docs/architecture/summarization.md`: Local summarization behavior and presets
- `docs/architecture/live-session.md`: Real-time live session transcription architecture
- `docs/architecture/transcription-quality-analysis.md`: Market comparison, pipeline gaps, and local-first quality roadmap
- `docs/api/http-api.md`: HTTP API endpoints used by the frontend
- `docs/api/live-session-websocket.md`: Live session WebSocket protocol
- `docs/backend/configuration.md`: `.env` configuration reference (grounded in `backend/src/config.ts` and `.env.example`)
- `docs/infrastructure/windows-gpu.md`: Windows + NVIDIA GPU setup notes
- `docs/architecture/checklists/`: Implementation checklists tied to the repo
- `docs/deprecated/`: Old plans and historical notes (kept for context, not maintained)

## Ground Rules For Updating Docs

- Do not invent behavior. If the code does not implement something, mark it as `TODO` or `UNKNOWN`.
- Prefer deleting or deprecating misleading docs rather than keeping them.
- Keep docs short and developer-focused: what exists, where it is, how to run it.
