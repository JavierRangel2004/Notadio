# Checklist: `SUMMARIZATION_LOCAL_IMPROVEMENT_PLAN.md`

Last audited against repo state: 2026-03-28

Status legend:
- `[x]` Implemented
- `[-]` Partial
- `[ ]` Missing

## Summary

- [x] New preset `analysisEssay` exists across backend and frontend types.
- [x] Summary output now includes `contentType`, `speakerIntent`, `coreClaims`, and `evidenceMoments`.
- [x] Summary preset can be auto-detected heuristically when not provided.
- [x] Transcript selection is now hybrid instead of pure uniform sampling.
- [x] Fallback summary generation is preset-aware and avoids deriving action items for non-operational content.
- [x] Frontend exposes `analysisEssay` and renders non-operational summaries with thesis/evidence emphasis.
- [-] The summary contract is still named `MeetingSummary`; schema separation is behavioral, not a full type split.
- [ ] There is still no local evaluation dataset or rubric harness in repo.

## Phase 1: Content Type Classification Without Extra LLM

- [x] Heuristic auto-classification exists in `detectSummaryPreset()` in `backend/src/services/summaryService.ts`.
- [x] Classification can resolve to `meeting`, `whatsappVoiceNote`, `contentCreation`, `analysisEssay`, or `genericMedia`.
- [x] Classification uses transcript lexical signals rather than an extra LLM call.
- [-] Heuristics cover meeting, note, content, and essay signals, but are still shallow string-pattern heuristics rather than a richer scoring model.
- [ ] No dedicated tests for borderline ambiguous classification cases.

## Phase 2: New Preset `analysisEssay`

- [x] `analysisEssay` exists in `backend/src/types.ts` and `frontend/src/api.ts`.
- [x] `analysisEssay` prompt context exists in `getPresetContext()` in `backend/src/services/summaryService.ts`.
- [x] Prompt rules explicitly prioritize thesis, evidence, implications, and conclusion.
- [x] Prompt rules explicitly discourage `actionItems`, `keyDecisions`, and `followUps` for argument-driven content.
- [x] Frontend exposes the preset in `frontend/src/App.tsx`.
- [x] Tests cover explicit `analysisEssay` prompting and output shape in `backend/src/services/summaryService.test.ts`.

## Phase 3: Separate Universal vs Operational Schema

- [x] Summary output now includes universal fields:
  - `contentType`
  - `speakerIntent`
  - `coreClaims`
  - `evidenceMoments`
- [x] Prompt schema instructions include those universal fields in `buildSchemaInstructions()`.
- [x] Non-operational fallback section generation now prefers thesis/evidence sections over meeting sections.
- [-] The backend still uses a single `MeetingSummary` type rather than separate universal and operational types.
- [-] Operational fields still remain on all summaries, even when intentionally empty.
- [ ] No explicit `operationalNotes` extension type or separate operational subtype exists.

## Phase 4: Evidence-Preserving Input Selection

- [x] Pure uniform sampling has been replaced with hybrid block selection in `selectSummaryInputBlocks()` in `backend/src/services/summaryService.ts`.
- [x] Selection preserves coverage across the transcript.
- [x] Selection boosts likely evidence markers such as examples, thesis markers, and conclusion markers.
- [x] Selection explicitly protects the end of the transcript.
- [-] Evidence scoring is heuristic and regex-driven; there is no entity rarity or semantic salience model.
- [ ] Prompt input is still a single transcript block, not separate `Contexto general` and `Momentos de evidencia` sections.

## Phase 5: Disable Heuristic Task Extraction for Non-Operational Fallbacks

- [x] `buildFallbackSummary()` is now preset-aware.
- [x] Non-operational presets no longer derive fallback `actionItems`.
- [x] Non-operational presets no longer derive fallback `followUps` from action items.
- [x] Fallback now derives `coreClaims` and `evidenceMoments` for non-operational content.
- [x] Tests cover the no-action-item fallback behavior for `analysisEssay`.
- [-] `genericMedia` still shares a generic fallback path; there is no finer split between narrative media vs informational media.

## Phase 6: Reduce Less Aggressively for Argumentative Content

- [x] Reduce prompt now explicitly asks to preserve example/evidence for non-operational content.
- [x] Reduce prompt now distinguishes operational coverage vs argumentative coverage.
- [x] Reduce payload now includes `contentType`, `speakerIntent`, `coreClaims`, and `evidenceMoments`.
- [-] Reduce compaction still trims fields aggressively by character count.
- [ ] No hard guarantee exists that at least one evidence item always survives final reduce.
- [ ] No dedicated reduce-time semantic density ranking exists for essay content.

## Phase 7: UI Intention and Rendering

- [x] The enhancement label changed from meeting-biased `AI Summary` to `Structured Summary`.
- [x] Preset descriptions now include `analysisEssay`.
- [x] Results UI renders `Core Claims` for non-operational summaries.
- [x] Results UI renders `Evidence Moments` for non-operational summaries.
- [x] Results UI demotes operational blocks for non-operational content by labeling them as literal mentions/commitments.
- [-] The results UI still uses one shared summary rail layout rather than a fully specialized layout per content type.
- [ ] No automatic user-facing explanation is shown when the preset was auto-detected rather than manually chosen.

## Concrete Backend Changes From The Plan

- [x] Add preset `analysisEssay`
- [x] Introduce `contentType`
- [x] Introduce `evidenceMoments`
- [x] Introduce `coreClaims`
- [x] Condition fallback behavior by preset/content type
- [x] Replace pure uniform sampling with hybrid selection
- [-] Fully separate universal and operational schemas at type level

## Concrete Frontend Changes From The Plan

- [x] Expose `analysisEssay`
- [x] Adjust preset labels/descriptions
- [x] Reduce meeting bias in the summary-entry label and helper text
- [x] De-emphasize `Action Items` and `Key Decisions` for non-operational summaries
- [-] UI adapts to returned `contentType`, but still within one common layout rather than distinct view models

## Concrete Type Changes From The Plan

- [x] `SummaryPreset` expanded with `analysisEssay`
- [x] `contentType` added
- [x] `evidenceMoments` added
- [x] `coreClaims` added
- [-] `MeetingSummary` name still reflects the old meeting-centric model

## Sprint Status

### Sprint 1

- [x] Add preset `analysisEssay`
- [x] Disable heuristic task extraction outside operational fallbacks
- [x] Adjust prompt base for thesis, evidence, and conclusion
- [x] Expose preset in frontend

### Sprint 2

- [x] Implement hybrid transcript selection
- [x] Preserve evidence moments
- [-] Adjust reduce behavior for narrative/argumentative content

### Sprint 3

- [-] Separate schema behaviorally between universal and operational summaries
- [x] Update UI to render according to `contentType`
- [ ] Add reproducible local evaluation dataset/rubric

## Tests and Verification

- [x] Backend summary tests pass.
- [x] Frontend build passes.
- [x] Tests cover:
  - explicit `analysisEssay` prompting
  - auto-detection of essay content
  - preset-aware fallback behavior
- [ ] No goldens or fixture-based semantic-quality benchmark suite exists for summary quality.

## Remaining Gaps Worth Tracking

- [ ] Rename `MeetingSummary` to a neutral summary type shared across backend/frontend.
- [ ] Add a reproducible local evaluation set for meetings, voice notes, streams, podcasts, and essay videos.
- [ ] Add a scorecard for thesis fidelity, evidence preservation, and false operational extraction.
- [ ] Consider splitting prompt input into separate context and evidence blocks.
- [ ] Add richer auto-classification tests for edge cases.
