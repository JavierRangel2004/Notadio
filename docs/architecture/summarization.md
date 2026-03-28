# Summarization (Local, Structured)

This document describes the summarization system as implemented in the repo.

Source of truth:

- `backend/src/services/summaryService.ts`
- `backend/src/types.ts`
- `frontend/src/App.tsx`
- `frontend/src/api.ts`

## Overview

Summarization is optional and uses a local Ollama model (`OLLAMA_MODEL`, `OLLAMA_BASE_URL`).

The backend generates a structured JSON summary and persists it as `summary.json` in the job directory.

## Presets

The frontend exposes a `summaryPreset` selector. The backend also heuristically detects a preset when none is provided.

Current presets (`SummaryPreset`):

- `meeting`: operational recap (decisions, action items, risks)
- `whatsappVoiceNote`: concise intent-driven voice note recap
- `genericMedia`: neutral recap for general audio/video
- `contentCreation`: stream/podcast recap without corporate structure
- `analysisEssay`: argument/essay recap focusing on thesis and evidence

## Output Shape

The summary type is still called `MeetingSummary` in code, but it contains both operational and non-operational fields.

Key universal fields (added to avoid “minuta for everything”):

- `contentType`: `meeting | voiceNote | contentCreation | analysisEssay | genericMedia`
- `speakerIntent`: dominant intent of the content (best-effort)
- `coreClaims`: thesis/claims (best-effort, especially for essay content)
- `evidenceMoments`: concrete examples/evidence (best-effort)

Operational fields remain present and should be empty for non-operational content unless literally present:

- `keyDecisions`
- `actionItems`
- `followUps`
- `openQuestions`

## Large Transcript Handling (Chunk + Reduce)

If the transcript input exceeds configured limits:

- The backend builds transcript “blocks”, selects a subset (coverage + evidence + ending), and then chunk-summarizes.
- It merges or “reduces” partial summaries into a final summary.
- If the reduce fails, it merges partials locally.

## Fallback Path (No Ollama / Bad Output)

If Ollama is unavailable or produces sparse JSON, the backend generates an extractive fallback summary from the transcript.

Important behavior:

- Fallback is preset-aware.
- For non-operational presets, fallback does not derive `actionItems` or `followUps` heuristically.

## Where To Track Status

- Implementation checklist: `docs/architecture/checklists/SUMMARIZATION_LOCAL_IMPROVEMENT_PLAN_CHECKLIST.md`
- The original plan: `docs/architecture/SUMMARIZATION_LOCAL_IMPROVEMENT_PLAN.md`
