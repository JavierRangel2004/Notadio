# Repository Inventory

Last generated: 2026-03-28

This inventory is grounded in `rg --files` (respects `.gitignore`), plus a short note about common local-only directories.

## Tracked Files

Counts (`rg --files`, `.gitignore`-aware):

- Files: 83
- Markdown files: 30

Tree (file paths from `rg --files`):

```txt
AGENTS.md
CLAUDE.md
GEMINI.md
README.md
.env.example
backend/package.json
backend/src/config.ts
backend/src/index.ts
backend/src/routes/sessionWebSocket.ts
backend/src/scripts/doctor.ts
backend/src/sessions/liveSessionOrchestrator.ts
backend/src/sessions/liveSessionStore.ts
backend/src/sessions/pcmRingBuffer.ts
backend/src/services/deviceProfileService.test.ts
backend/src/services/deviceProfileService.ts
backend/src/services/diarizationService.test.ts
backend/src/services/diarizationService.ts
backend/src/services/exportService.ts
backend/src/services/liveAssistantService.ts
backend/src/services/mediaService.ts
backend/src/services/mentionDetectionService.ts
backend/src/services/readinessService.test.ts
backend/src/services/readinessService.ts
backend/src/services/summaryService.test.ts
backend/src/services/summaryService.ts
backend/src/services/transcriptionService.test.ts
backend/src/services/transcriptionService.ts
backend/src/store/jobStore.ts
backend/src/types.test.ts
backend/src/types.ts
backend/src/utils/fs.ts
backend/src/utils/jobQueue.ts
backend/src/utils/process.ts
backend/tsconfig.json
docs/README.md
docs/REPO_INVENTORY.md
docs/api/http-api.md
docs/api/live-session-websocket.md
docs/architecture/SUMMARIZATION_LOCAL_IMPROVEMENT_PLAN.md
docs/architecture/checklists/STREAMPLAN_CHECKLIST.md
docs/architecture/checklists/SUMMARIZATION_LOCAL_IMPROVEMENT_PLAN_CHECKLIST.md
docs/architecture/live-session.md
docs/architecture/overview.md
docs/architecture/summarization.md
docs/backend/configuration.md
docs/deprecated/README.md
docs/deprecated/assets/Gemini_Generated_Image_16jjts16jjts16jj.png
docs/deprecated/assets/Gemini_Generated_Image_ghn692ghn692ghn6.png
docs/deprecated/gpu-run-evaluation-plan.md
docs/deprecated/streamplan.md
docs/deprecated/ui-redesign-plan.md
docs/frontend/ui-ux-design-guidelines.md
docs/frontend/ui-ux-evaluation-checklist.md
docs/infrastructure/windows-gpu.md
docs/tools/README.md
docs/tools/ruflo/README.md
docs/tools/ruflo/ruflo-claude-codex-prompt.md
docs/tools/ruflo/ruflo-claude-prompt.md
docs/tools/ruflo/ruflo-codex-prompt.md
frontend/index.html
frontend/package.json
frontend/src/App.tsx
frontend/src/LiveSessionPanel.tsx
frontend/src/api.ts
frontend/src/liveApi.ts
frontend/src/main.tsx
frontend/src/styles.css
frontend/src/useLiveSession.ts
frontend/src/vite-env.d.ts
frontend/tsconfig.json
frontend/vite.config.ts
package-lock.json
package.json
ruflo-claude-codex-prompt.md
ruflo-claude-prompt.md
ruflo-codex-prompt.md
scripts/diarize_audio.py
scripts/diagnose-git-auth.ps1
scripts/diagnose-whisper-runtime.ps1
scripts/generateDiff.ts
scripts/setup-diarization.ps1
scripts/setup-diarization.sh
unnamed.jpg
```

## Local-Only / Runtime Directories

These directories commonly exist in a working copy but are not part of the repo’s source of truth:

- `node_modules/`: installed dependencies
- `data/`: runtime job storage (`STORAGE_ROOT`, default `./data`)
- `backend/dist/`, `frontend/dist/`: build outputs
- `logs/`, `venv/`: local environment artifacts

If you need a complete filesystem inventory including these directories, generate it locally with `find` (it can be very large).
