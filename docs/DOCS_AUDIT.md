# Documentation Audit

Last audited: 2026-03-28

This file classifies every `.md` document currently present in the working tree and explains what it covers and how it relates to the codebase.

Status legend:

- **Valid & Up-to-date**: matches current codebase, safe to rely on
- **Needs Update**: partially correct but contains gaps or unclear claims; update before relying on it
- **Deprecated**: not maintained; may be inaccurate

## Current Documentation Structure (Target)

The repo’s “single source of truth” docs live under:

```txt
docs/
  README.md
  REPO_INVENTORY.md
  DOCS_AUDIT.md
  api/
  architecture/
  backend/
  frontend/
  infrastructure/
  tools/
  deprecated/
```

## Markdown File Classification

### Root

- `README.md`: **Valid & Up-to-date**
  - Documents: repo purpose, how to run locally, links into `docs/`
  - Notes: intentionally concise; detailed configuration moved to `docs/backend/configuration.md`
- `AGENTS.md`: **Valid & Up-to-date**
  - Documents: repo working conventions and commands
- `CLAUDE.md`: **Valid & Up-to-date**
  - Documents: guidance for Claude Code, includes accurate endpoints and live session mention
- `GEMINI.md`: **Valid & Up-to-date**
  - Documents: short project overview for Gemini tooling
- `ruflo-claude-codex-prompt.md`: **Deprecated**
  - Documents: redirect stub to `docs/tools/ruflo/`
- `ruflo-claude-prompt.md`: **Deprecated**
  - Documents: redirect stub to `docs/tools/ruflo/`
- `ruflo-codex-prompt.md`: **Deprecated**
  - Documents: redirect stub to `docs/tools/ruflo/`

### `docs/`

- `docs/README.md`: **Valid & Up-to-date**
  - Documents: docs index and update rules
- `docs/REPO_INVENTORY.md`: **Valid & Up-to-date**
  - Documents: inventory of files via `rg --files` (gitignore-aware)
- `docs/DOCS_AUDIT.md`: **Valid & Up-to-date**
  - Documents: this audit and classification

### `docs/api/`

- `docs/api/http-api.md`: **Valid & Up-to-date**
  - Documents: HTTP endpoints implemented in `backend/src/index.ts`
- `docs/api/live-session-websocket.md`: **Valid & Up-to-date**
  - Documents: live session WebSocket protocol as implemented in backend/frontend

### `docs/architecture/`

- `docs/architecture/overview.md`: **Valid & Up-to-date**
  - Documents: batch job pipeline + live session pipeline at a high level
- `docs/architecture/live-session.md`: **Valid & Up-to-date**
  - Documents: live transcription windowing strategy, confirmed/provisional segments, mention flow, batch handoff
- `docs/architecture/summarization.md`: **Valid & Up-to-date**
  - Documents: presets, chunk/reduce behavior, fallback behavior, and output shape
- `docs/architecture/SUMMARIZATION_LOCAL_IMPROVEMENT_PLAN.md`: **Needs Update**
  - Documents: original diagnosis + phased plan; now partially implemented
  - Notes: updated with “implemented/partial” markers, but still contains plan language and historical framing
- `docs/architecture/checklists/SUMMARIZATION_LOCAL_IMPROVEMENT_PLAN_CHECKLIST.md`: **Valid & Up-to-date**
  - Documents: itemized status checklist for summarization improvements
- `docs/architecture/checklists/STREAMPLAN_CHECKLIST.md`: **Valid & Up-to-date**
  - Documents: itemized status checklist for the live session stream plan

### `docs/backend/`

- `docs/backend/configuration.md`: **Valid & Up-to-date**
  - Documents: `.env` configuration grounded in `.env.example` and `backend/src/config.ts`

### `docs/frontend/`

- `docs/frontend/ui-ux-design-guidelines.md`: **Valid & Up-to-date**
  - Documents: frontend design guidelines (general; not code-specific)
- `docs/frontend/ui-ux-evaluation-checklist.md`: **Valid & Up-to-date**
  - Documents: checklist template; avoids asserting implementation details without verification

### `docs/infrastructure/`

- `docs/infrastructure/windows-gpu.md`: **Valid & Up-to-date**
  - Documents: Windows + NVIDIA GPU setup notes grounded in `.env.example` and scripts

### `docs/tools/`

- `docs/tools/README.md`: **Valid & Up-to-date**
  - Documents: tooling docs index
- `docs/tools/ruflo/README.md`: **Valid & Up-to-date**
  - Documents: Ruflo prompt pack context
- `docs/tools/ruflo/ruflo-claude-codex-prompt.md`: **Needs Update**
  - Documents: Ruflo prompt pack; not tied to Notadio code directly
  - Notes: kept as-is; update only if your tooling workflow changes
- `docs/tools/ruflo/ruflo-claude-prompt.md`: **Needs Update**
- `docs/tools/ruflo/ruflo-codex-prompt.md`: **Needs Update**

### `docs/deprecated/`

- `docs/deprecated/README.md`: **Valid & Up-to-date**
  - Documents: what deprecated means in this repo
- `docs/deprecated/ui-redesign-plan.md`: **Deprecated**
  - Documents: historical UI redesign plan; not guaranteed to match current UI
- `docs/deprecated/gpu-run-evaluation-plan.md`: **Deprecated**
  - Documents: historical log-based evaluation; references local logs that may not exist
- `docs/deprecated/streamplan.md`: **Deprecated**
  - Documents: narrative design discussion superseded by implementation docs/checklists
- `docs/deprecated/ui-ux-evaluation-checklist.md`: **Deprecated**
  - Documents: historical UI evaluation with many specific claims; not maintained

## Deprecated Files List

Deprecated documents live under `docs/deprecated/` (plus the redirect stubs in repo root):

- `docs/deprecated/*`
- `ruflo-claude-codex-prompt.md`
- `ruflo-claude-prompt.md`
- `ruflo-codex-prompt.md`

## Merges / Moves Performed

- Moved live and summarization checklists into `docs/architecture/checklists/`.
- Moved `docs/windows-gpu-setup.md` → `docs/infrastructure/windows-gpu.md` and rewrote to remove machine-specific paths.
- Moved UI docs from `frontend/docs/` → `docs/frontend/`.
- Moved historical plans into `docs/deprecated/` and added a required `# Deprecated` header.
- Moved Ruflo prompt packs into `docs/tools/ruflo/` and left redirect stubs at repo root.

## Remaining TODOs (If You Want Zero-Drift Docs)

- Consider renaming the `MeetingSummary` type to a neutral name across backend/frontend (code + docs).
- Add a small, reproducible evaluation dataset/rubric for summaries (currently only described as a future step).
