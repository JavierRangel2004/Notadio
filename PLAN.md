# Notadio — Full Functional App Plan

## Problem Statement

The current page is a **literal copy-paste of the brand board design image** (`unnamed.jpg`). It looks like a design presentation, not a working web app. The left column shows brand concepts/typography, the right column shows mock UI components and keywords, and the center wraps the actual app inside a "Website UI Concepts" module. Decorative elements (color swatches, motion cards, mood boards, "Buy Now" button, keyword cloud) take up real estate that should be app functionality.

**Goal**: Transform this into a fully functional, premium dark-themed web application that *uses the design language from the image* (colors, glass panels, typography, dark aesthetic) but removes all brand-board scaffolding and replaces it with real, working features.

---

## Plan A — Backend (New Endpoints & Features)

The existing backend is solid: upload, transcription pipeline, SSE progress, transcript/summary/export, retry diarize/summarize. The following additions unlock the missing frontend capabilities.

### BE-1: Audio Playback Endpoint

**Why**: The design shows audio player controls. The backend already stores `normalizedAudioPath` (16kHz mono WAV) on completed jobs. We just need to serve it.

**Endpoint**: `GET /api/jobs/:jobId/audio`

**Implementation** (`backend/src/index.ts`):
- Look up job, verify `normalizedAudioPath` exists
- Support HTTP `Range` headers for seekable streaming (required for `<audio>` element seek)
- Set `Content-Type: audio/wav`, `Accept-Ranges: bytes`
- Pipe file stream to response
- Return 404 if job not completed or audio missing

**Scope**: ~40 lines in `index.ts`. No new service files.

### BE-2: List Jobs Endpoint

**Why**: The app currently loses track of jobs on page refresh (state is in React `useState`). Users need a job history / workspace library view.

**Endpoint**: `GET /api/jobs`

**Implementation** (`backend/src/index.ts`):
- Return all jobs from `jobStore` as an array of `makeJobResponse()` objects
- Sort by `createdAt` descending (newest first)
- Optional query param `?status=completed` to filter
- Lightweight — returns summary data only, not transcripts

**Supporting change** (`backend/src/store/jobStore.ts`):
- Add `getAll(): JobManifest[]` method that returns all values from the in-memory map

**Frontend type** (`frontend/src/api.ts`):
- Add `getJobs(status?: string): Promise<JobPayload[]>`

### BE-3: Delete Job Endpoint

**Why**: Users need to clean up old jobs from the workspace.

**Endpoint**: `DELETE /api/jobs/:jobId`

**Implementation** (`backend/src/index.ts`):
- Look up job, remove from jobStore
- Delete the job directory on disk (`rm -rf` the job folder)
- Return 204 No Content

**Supporting change** (`backend/src/store/jobStore.ts`):
- Add `delete(jobId: string)` method that removes from memory map, clears transcript cache, removes listeners

**Frontend type** (`frontend/src/api.ts`):
- Add `deleteJob(jobId: string): Promise<void>`

### BE-4: Audio URL helper in API client

**Frontend** (`frontend/src/api.ts`):
- Add `getAudioUrl(jobId: string): string` — returns the URL for the audio endpoint (same pattern as `getExportUrl`)

---

## Plan B — Frontend (Functional App Rebuild)

### Overview of Layout Transformation

**Current** (3-column brand board):
```
[Brand Concepts]  [Color Palette + "Website UI Concepts" wrapper]  [UI Components Mock + Keywords + Mood]
```

**Target** (real app layout):
```
┌─────────────────────────────────────────────────────────┐
│  Nav: Logo • [Workspace] [Upload New]                   │
├──────────┬──────────────────────────────────────────────┤
│ Sidebar  │  Main Content Area                           │
│ (context │  - Upload view (idle)                        │
│  aware)  │  - Processing dashboard                      │
│          │  - Transcript + Summary results               │
│          │  - Audio player bar (when job loaded)         │
└──────────┴──────────────────────────────────────────────┘
```

### FE-1: Remove Brand Board Scaffolding

**Delete entirely** from `App.tsx`:
- Left column (`board-col-left`): brand concepts, logo display, typography showcase, motion & interaction cards
- Right column (`board-col-right`): UI components mock, "Buy Now" button, tag outlines, audio player mock, speaker tags mock, keyword cloud, mood grid
- Center column's "Color Palette" swatches module
- The `brand-board` 3-column grid wrapper
- The `module-title` "Website UI Concepts" header

**Keep and promote**:
- The `main-app-container` (center column's actual app) becomes the top-level layout
- The `app-nav` stays but gets real navigation
- All three state views (idle/upload, processing, results) stay and get enhanced

**CSS cleanup** (`styles.css`):
- Remove all `.board-col`, `.board-module`, `.brand-board`, `.logo-display`, `.grid-2`, `.logo-lockup`, `.typo-showcase`, `.motion-grid`, `.motion-card`, `.circle-pulse`, `.mic-icon`, `.palette-grid`, `.swatch`, `.ui-components-stack`, `.ui-row`, `.tag-outline`, `.audio-player-mock`, `.audio-timeline`, `.audio-bar`, `.audio-controls`, `.speaker-tags-mock`, `.spk-tag`, `.keyword-cloud`, `.kw`, `.mood-grid`, `.mood-card` classes
- Keep the design system tokens (`:root` variables), glass panels, buttons, speaker colors, all functional component styles

### FE-2: Real Navigation & App Shell

**Replace** the current decorative nav with a functional one:

```
[Brand Icon + NOTADIO]     [Workspace]  [Upload New ↑]
```

- **Workspace**: navigates to job history list view (FE-5)
- **Upload New**: resets state to upload view or scrolls to it
- The nav stays fixed at top, glass backdrop

**App state routing** (keep using React state, no router needed — simple enough):
- `view: "upload" | "processing" | "results" | "workspace"`
- Upload creates job → auto-transition to processing → auto-transition to results
- Workspace lists all past jobs, clicking one loads results

### FE-3: Functional Audio Player

**Replace** the mock audio player with a real `<audio>` element + custom UI.

**Where it appears**: In the results view, between the transcript header and transcript body (or as a sticky bar at the bottom of the results area).

**Implementation**:
- `<audio>` element with `src={getAudioUrl(jobId)}` — only rendered when job is completed
- Custom controls UI matching the dark premium design:
  - Play/pause button (crimson accent)
  - Seekable timeline bar (click-to-seek)
  - Current time / duration display (mono font)
  - Playback speed toggle (1x, 1.5x, 2x)
- React state: `isPlaying`, `currentTime`, `duration`, `playbackRate`
- Wire `timeupdate` event from `<audio>` to update position
- **Click-to-seek in transcript**: clicking a timestamp in a speaker group seeks the audio to that time

**New component** (inline in `App.tsx` or extract to a separate function):
```tsx
function AudioPlayer({ jobId, duration }: { jobId: string; duration?: number })
```

### FE-4: Enhanced Results View

**Current**: 2-column (summary rail + transcript area), mostly working but missing features.

**Additions**:

#### 4a. Full Summary Display
Currently only shows `headline`, `brief`, and `actionItems`. The `MeetingSummary` type has much more data. Display all populated fields:
- **Key Decisions** (`keyDecisions: string[]`) — bulleted list
- **Sections** (`sections: MeetingSummarySection[]`) — collapsible panels with title, summary, bullets
- **Follow-ups** (`followUps: string[]`) — bulleted list
- **Risks** (`risks: string[]`) — bulleted list with warning styling
- **Operational Notes** (`operationalNotes: string[]`) — bulleted list
- **Open Questions** (`openQuestions: string[]`) — bulleted list
- **Topics** (`topics: string[]`) — tag pills

Only render each section if the array is non-empty.

#### 4b. Copy-to-Clipboard Actions
Currently `copiedState` and `copyText()` exist but are **unused in the JSX**. Wire them up:
- Copy summary button (copies full summary as text)
- Copy transcript button (copies full transcript text)
- Visual feedback: button text changes to "Copied!" for 1.8s (logic already exists)

#### 4c. JSON Export
Currently only TXT and SRT exports are shown. Add JSON export button to the control strip.

#### 4d. File Metadata Bar
Show at the top of results:
- Original filename, file size, detected language, duration, processing time
- Warnings (if any) — expandable

#### 4e. Failed State
Currently there's NO UI for `job.status === "failed"`. Add a clear error state:
- Show error message from `job.error`
- Show any logs collected before failure
- "Try Again" button (resets to upload)

### FE-5: Workspace / Job History View

**New view** showing all past and current jobs.

**Layout**: Grid or list of job cards, each showing:
- Filename, status badge (queued/processing/completed/failed)
- Created date, duration, detected language
- Click to load results (if completed) or view progress (if processing)
- Delete button (calls `DELETE /api/jobs/:jobId`)

**Data source**: `GET /api/jobs` (BE-2)

**Load on mount**: Fetch job list when workspace view is active. Also persist `currentJobId` in `localStorage` so refreshing the page can restore the last viewed job.

### FE-6: Responsive Design Fix

Current responsive is a blunt "hide sidebars under 1400px". After removing sidebars (FE-1), the responsive approach becomes:

- **Desktop (>1024px)**: Sidebar + main content side by side
- **Tablet (768px–1024px)**: Stacked layout, summary above transcript
- **Mobile (<768px)**: Single column, collapsible summary, transcript takes full width, audio player docked at bottom

### FE-7: Nav Links → Scroll/Tab Anchors (Results View)

The current nav has "Summaries", "Translation", "Diarization" as decorative labels. Make them functional:
- In results view, these scroll to / highlight the relevant section
- "Summaries" → scrolls to summary rail
- "Translation" → switches transcript variant to English (if available)
- "Diarization" → scrolls to transcript and highlights speaker tags

Or replace with a tab/section structure within the results view.

---

## Implementation Order (Recommended)

### Phase 1 — Backend API additions (BE-1 through BE-4)
All backend changes are independent and can be done in one pass. They unblock frontend features.

1. **BE-2**: List jobs endpoint + `getAll()` on jobStore
2. **BE-3**: Delete job endpoint
3. **BE-1**: Audio streaming endpoint with Range support
4. **BE-4**: Frontend API client additions (`getJobs`, `deleteJob`, `getAudioUrl`)

### Phase 2 — Frontend restructure (FE-1, FE-2)
Strip the brand board and build the real app shell.

1. **FE-1**: Remove all decorative brand board elements from JSX and CSS
2. **FE-2**: Build real navigation + app state routing

### Phase 3 — Feature build-out (FE-3 through FE-7)
Add the missing functional features.

1. **FE-4e**: Failed state (quick win, important UX gap)
2. **FE-4a**: Full summary display (all fields)
3. **FE-4b**: Copy-to-clipboard (wire existing code)
4. **FE-4c**: JSON export button
5. **FE-4d**: File metadata bar
6. **FE-3**: Audio player (depends on BE-1)
7. **FE-5**: Workspace / job history (depends on BE-2, BE-3)
8. **FE-6**: Responsive design
9. **FE-7**: Nav anchor links

---

## Files Changed

### Backend
| File | Changes |
|------|---------|
| `backend/src/index.ts` | Add `GET /api/jobs`, `DELETE /api/jobs/:jobId`, `GET /api/jobs/:jobId/audio` |
| `backend/src/store/jobStore.ts` | Add `getAll()`, `delete()` methods |

### Frontend
| File | Changes |
|------|---------|
| `frontend/src/api.ts` | Add `getJobs()`, `deleteJob()`, `getAudioUrl()` |
| `frontend/src/App.tsx` | Full restructure: remove brand board, add real nav, workspace view, audio player, full summary, failed state, copy actions, metadata bar |
| `frontend/src/styles.css` | Remove decorative classes, add workspace grid, audio player, responsive breakpoints, failed state styles |

### No changes needed
- `backend/src/config.ts` — no new config
- `backend/src/types.ts` — existing types cover all needs
- `backend/src/services/*` — all services already complete

---

## What We're NOT Building (Out of Scope)

- **Live microphone recording** — complex (MediaRecorder API, WebSocket streaming), separate project
- **User auth / accounts** — local-first app, not needed
- **Database** — existing file-based jobStore is appropriate
- **Router library** — React state is sufficient for 4 views
- **New backend services** — all transcription/diarization/summary services are complete
