# Notadio UI Redesign Plan

Based on the latest design concept (`Gemini_Generated_Image_16jjts16jjts16jj.png`), incorporating elements from the previous design while prioritizing the newer, more detailed UI screens, here is the comprehensive plan to implement the aesthetic and UI components for Notadio.

## 1. Brand & Styling Foundations

### 1.1 Color Palette
We will update `frontend/src/styles.css` with the refined dark mode colors and vibrant accents.
- **Primary Background (Darkest):** `#0A0510`
- **Secondary Background/Surface (Dark Purple):** `#1A0B2E`
- **Primary Text (Crisp White):** `#FFFFFF` (or close to it, for high contrast)
- **Secondary Text (Muted Grey):** `#A09DB0` (or similar grey)
- **Primary Accent (Crimson Red / Carmesi):** `#9E1B32`
- **Secondary Accent (Rich Dark Purple):** `#5D2A7A`

### 1.2 Typography
- **Typeface:** "Clean UI typeface" - A modern, geometric sans-serif (e.g., `Inter`, `Manrope`, system fonts like `San Francisco` or `Segoe UI`).
- **Hierarchy:** Clear distinction between Heading Titles, Subheadings, and Paragraphs/Body text. Ensure high legibility for transcription text.

### 1.3 Iconography & Logo
- **Logo:** Adopt the new "N" lettermark integrating a soundwave, paired with the "Notadio" wordmark.
- **Favicon:** Use the "N" soundwave lettermark inside a dark rounded square.

## 2. Core UI Components

### 2.1 Buttons & Controls
- **Crimson Buttons:** Solid `#9E1B32` for primary actions (Start, Run, Stop, Start Transcription, New Session).
- **Secondary/Action Buttons:** Muted or dark purple `#5D2A7A` buttons, or outlined buttons.
- **Glassmorphism Nav Bar:** Semi-transparent top navigation with links (Workspace, New Session) and a primary action button.
- **Export Controls:** Segmented controls or toggles for format selection (TXT, JSON) and language (Source/English).
- **Variant Toggles & Badges:** Interactive tooltips, confirm modals, status tags (solid pill shapes), and stage badges (e.g., green, purple tags).

### 2.2 Audio & Transcription Elements
- **Audio Player:** Custom UI with timeline, play/pause controls, volume, and visual waveform.
- **Speaker ID Tags:** Pill-shaped colored tags (red, purple, etc.) to identify speakers in the player and transcript.

## 3. Page Layouts & Workflows

### 3.1 Homepage Hero
- **Headline:** "Private transcription atelier"
- **Background:** Integration of "Sound lends text" abstract audio wave / AI particle graphics.
- **Layout:** Highlighting local-first, secure, contemporary processing.

### 3.2 Session Intake (New Session)
- **File Upload:** Drag-and-drop zone for media files (MKV, MP4, MP3, etc.).
- **Record Mic:** Integrated recording controls (Start, Pause, Stop) with a timer and actions (Use, Discard).
- **Action:** Large "Start Transcription" crimson button.
- **Settings/Presets:** Sidebar for selecting AI Summaries, Translation, Enhancement, and choosing models (Local Whisper/Ollama).

### 3.3 Processing Dashboard
- **Progress Tracking:** Overall progress bar (0-100%).
- **Pipeline Stages:** Visual indicators for pipeline steps: Normalize, Transcribe, Translate, Diarize, Summarize, Export.
- **Metrics Panel:** Display Duration, Elapsed time, ETA, Threads, Profile, and Path.
- **Live Logs:** A built-in terminal-like console showing real-time processing logs with copy and show/hide functionality.
- **Status Tags:** Showing current processing stage and status.

### 3.4 Results Workspace (Transcription View)
- **Summary Rail:** Top or side panel with tabs for Headline, Decisions, Action items, Sections, Open questions, Diagnostics, Pipeline timings, Retry actions.
- **Transcript Area:** Toggle between "Source" and "English" (translation), with a "Copy" action. Text displays with inline colored Speaker ID tags.
- **Audio Player:** Pinned audio player matching the active transcript timestamp.

### 3.5 Workspace / Library (Dashboard)
- **Layout:** Grid or list of "Job cards".
- **Job Cards:** Dark cards `#1A0B2E` showing Job Name, Date, Status, Mic/File tag, Language, and actions ("Open job", "Delete").
- **Header:** Title "Workspace" and a prominent "New Session" button.

## 4. Execution Strategy (Step-by-Step)

1. **Step 1: CSS Architecture & Theming** 
   - Overhaul `frontend/src/styles.css` with the new color palette, typography variables, and glassmorphism utilities.
2. **Step 2: Core Components Library**
   - Create reusable React components: Buttons, Tags, Badges, Nav Bar, and Job Cards.
3. **Step 3: Session Intake & Upload**
   - Build the drag-and-drop file upload and mic recording UI. Integrate the options/presets sidebar.
4. **Step 4: Processing Dashboard**
   - Implement the complex progress view with the pipeline steps, metrics, and the Live Logs console.
5. **Step 5: Results Workspace**
   - Build the Summary Rail, the Transcript view with Speaker tags and Source/English toggle, and the custom Audio Player.
6. **Step 6: Workspace Library**
   - Update the main dashboard to use the new Job Cards layout.
7. **Step 7: Landing/Hero Page**
   - Construct the new "Private transcription atelier" homepage hero.
8. **Step 8: Polish & Interactions**
   - Ensure tooltips, modals, and real-time AI processing animations (motion inspiration) are smooth and responsive.

---
*Status: Ready for implementation.*