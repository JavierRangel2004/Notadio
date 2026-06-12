# Notadio — UI/UX Improvement Plan

_Captured 2026-06-12. Based on screenshot review + senior UI/UX audit._

> **Implementation status (2026-06-12):** P0 overflow bugs (1–5), P1 (CTA summary
> strip + sticky footer, localized LLM labels, 2×2 tab grid), P2 (note preview on
> hover, voice play-preview), and P3 hero polish (11–12) are **DONE**. New backend
> endpoints: `GET /api/vault/note` (excerpt) and `GET /api/tts/preview` (voice
> sample). Remaining: a11y contrast audit pass (table below) and the parking-lot
> items. The screenshot's search-placeholder bug (15) was already fixed in the
> prior refactor.

---

## Critical bugs (breaks the UI right now)

### 1. Convert button clipped — overflow bottom-right

**What:** The "Convert" button is partially hidden below the viewport edge. The button text is barely readable and the button cannot be reliably clicked.

**Root cause:** `.vault-panel` stacks vertically inside the right column without constraining its height. The panel grows past `100vh` and the sticky/fixed button at the bottom gets obscured by the browser chrome.

**Fix:**
- Make the right panel a flex column with `min-height: 0` so it can shrink.
- The inner note list (`vault-file-list`) should take `flex: 1; overflow-y: auto` so it scrolls internally and the button always stays visible below it.
- Alternatively: make the whole right panel scrollable and pin the Convert CTA with `position: sticky; bottom: 0` inside the scroll container.

---

### 2. Voice chip grid — 4th chip (Álva…) clipped on the right

**What:** The voice chip row overflows horizontally. The last chip is cut off by the container edge — the locale label is invisible.

**Root cause:** `.voice-chip-grid` uses `display: flex` with no wrap, or a fixed `grid-template-columns` that doesn't account for the available width.

**Fix:**
- Change to `display: grid; grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr))` so chips wrap and never overflow.
- Ensure the parent container has `overflow: hidden` or `overflow-x: hidden` and the chips have `min-width: 0`.

---

### 3. LLM model input overflows panel width

**What:** The "deepseek-v4-flash" text input / select exceeds the panel border on the right.

**Root cause:** The input element has no `max-width: 100%` or the flex/grid parent doesn't constrain its children's inline size.

**Fix:**
- Add `width: 100%; box-sizing: border-box` to the model `<input>` and `<select>`.
- Ensure the parent `.control-strip` or wrapper has `min-width: 0` and `overflow: hidden`.

---

### 4. "Vault Notes" tab sits on its own second row

**What:** The four intake tabs (Upload File / Record Mic / Live Session / Vault Notes) should be a clean 2×2 grid. In the screenshot "Vault Notes" wraps to a second row misaligned with the others.

**Root cause:** The `control-strip` grid has `grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr))` — on the panel width (~260px) three tabs fit in the first row and one falls alone.

**Fix:**
- Force exactly 2 columns: `grid-template-columns: repeat(2, 1fr)` for the intake-mode strip specifically, or reduce `minmax` to `5.5rem`.
- Alternatively use `display: flex; flex-wrap: wrap` with each tab at `width: calc(50% - gap/2)`.

---

### 5. Note file names truncated/cut off in list

**What:** Long note names like "iLuk - Meta Ads — Prueba campaña WA Finclu post-Rocío" are clipped by the container and the overflow isn't handled gracefully — text bleeds past the edge.

**Root cause:** `.vault-file-row` or its inner `<span>` lacks `overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0`.

**Fix:**
- Apply `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` to the note name element.
- Ensure the grid column that holds the name has `min-width: 0` (flex/grid children default to `min-width: auto` which allows overflow).

---

## High-priority UX issues

### 6. Dual product purpose not separated visually

**Problem:** "Session Intake" (transcription) and "Vault Notes" (podcast synthesis) are two fundamentally different workflows packed into the same panel. A new user cannot tell if they need to record first, or if Vault Notes is independent.

**Proposed fix:**
- Treat "Upload / Record / Live Session" and "Vault Notes" as sibling top-level modes at the same visual weight — the current tab strip already does this conceptually but the label "Session Intake" above the tabs suggests recording is the primary path and Vault is an afterthought.
- Remove the "SESSION INTAKE" eyebrow label (or change it to "Start") so both halves feel equally valid.
- Consider a brief one-line description that appears below the tab strip and changes per tab: _"Upload an audio or video file to transcribe."_ / _"Convert Obsidian notes into a podcast-style audio."_

---

### 7. Convert CTA has no visual weight and is not anchored to completion

**Problem:** Even fixing the overflow, the Convert button is at the very bottom of a long scroll and doesn't feel like the climax of the flow. The user loses the sense of "I picked my notes → I configured → now I'm ready."

**Proposed fix:**
- Add a small summary strip just above the button: "3 notes selected · Dalia · OpenCode". This anchors the action to the selections made above and confirms the user hasn't missed a step.
- Increase button height to `3rem` minimum and font-size to `1rem`.
- Disabled state should say "Select notes to convert" (already done) — ensure it's legible.

---

### 8. LLM section uses raw technical identifiers

**Problem:** "Ollama (Local)", "OpenCode", "deepseek-v4-flash" are developer-facing labels. Users don't know if "deepseek-v4-flash" is better or worse than other options.

**Proposed fix:**
- Show a friendly alias next to the model ID: _deepseek-v4-flash · fast & creative_ (configurable in a small lookup table in the frontend).
- Keep the raw ID visible in small muted text for power users, but lead with the alias.
- Long-term: replace raw provider names with labels like "Local (Ollama)" / "Cloud (OpenCode)".

---

### 9. No preview of selected note content

**Problem:** Users selecting from 1311 notes cannot remember what "iLuk - Voice Calls — RCA + Auditoría conv_8301 (2026-06-11)" actually contains. They risk converting the wrong note.

**Proposed fix (fast):** On hover/focus of a note row, show a tooltip or small popover with the first 2–3 sentences of the note.

**Proposed fix (proper):** Add a preview pane: when a single note is selected (or hovered for 500ms), show a right-side drawer or a panel below the list with the first ~200 chars of the note. Clear when nothing is selected.

---

### 10. Voice chips lack a play-preview affordance

**Problem:** Voices are identified by name + region but there's no way to audition a voice before converting 10 notes. Users will pick arbitrarily and be disappointed.

**Proposed fix:**
- Add a small ▶ play icon on each voice chip. On click, fetch/play a short sample phrase (pre-recorded or generated on-demand from the backend via Edge TTS).
- Mark the selected chip with a thicker border + filled background — the current accent ring is too subtle.

---

## Medium-priority UI polish

### 11. Hero bullet points — low contrast

The three bullet points ("Built for private meetings…", "Whisper-first translation…", "Local summaries…") use a muted color that fails WCAG AA on the dark background. Increase to at least `rgba(255,255,255,0.75)`.

### 12. Hero stats strip ("CUDA WHISPER / SPEAKER ID / EXPORT STACK") — visual noise

These three stat rows compete visually with the hero headline without adding decision-relevant information to new users. They read like spec-sheet footnotes.

Options:
- (a) Move them to a collapsed `<details>` or a "System" tooltip accessible from the navbar.
- (b) Rewrite as benefit-first: "GPU-accelerated" / "Speaker labels" / "TXT · SRT · JSON" — remove the all-caps technical names.
- (c) Remove entirely from the hero; place in the footer.

### 13. Folder tree collapse arrows — unclear hit area

The `–` / `+` toggle on folder headers is too small. Users with the vault panel narrow will often mis-click and trigger a note selection instead of a fold/unfold. Increase the clickable area to the full header row (`cursor: pointer` on the entire `<header>` element, not just the icon).

### 14. "3 de 1311 notas" counter — positioning

The counter is currently above the note list. When selecting notes deep in the list the counter scrolls out of view. Move it to a sticky bar at the top of the scrollable list area so it's always visible alongside the search input.

### 15. Search bar — placeholder text not localized

The search placeholder says "2026-06-11" (a date string) in the screenshot instead of a real placeholder. This is likely a bug where the value of a state variable was passed as `placeholder` instead of as the input `value`. Fix: `placeholder="Search notes…"`.

---

## Accessibility & contrast

| Element | Issue | Fix |
|---|---|---|
| Secondary text (paths, labels, muted) | Contrast ratio ~2.5:1 | Raise to ≥ 4.5:1 (WCAG AA) |
| Checkboxes | Default browser style, tiny hit area | `accent-color: var(--accent-primary)`, wrap in `<label>` with full row as target |
| Voice chips | Selected state border only | Add filled background on selected + `aria-pressed` |
| Folder headers | No keyboard focus ring visible | `focus-visible` ring matching accent |
| Convert button (disabled) | Text color too close to background on disabled state | `opacity: 0.45` minimum or dedicate a disabled color token |

---

## Recommended implementation order

1. **P0 — Fix overflows (bugs):** items 1–5. All are CSS-only fixes, no logic changes.
2. **P1 — CTA anchoring:** item 7 (summary strip above Convert). One JSX + CSS addition.
3. **P1 — Localized LLM labels:** item 8. Small lookup table in `VaultNotesPanel.tsx`.
4. **P1 — Tab grid 2×2:** item 4. One CSS rule change.
5. **P2 — Note preview on hover:** item 9. Requires a new lightweight backend route or client-side vault file read.
6. **P2 — Voice play preview:** item 10. Requires a `/api/tts/preview` endpoint returning a short WAV clip.
7. **P3 — Hero section cleanup:** items 11–12.
8. **P3 — Contrast + a11y pass:** accessibility table above.

---

## Out of scope for now (parking lot)

- Step-by-step wizard flow (would require significant App.tsx restructure — do after P0–P2 are clean)
- Note "mosaic" view (complex, needs design spec first)
- Full WCAG AAA compliance (nice to have)
