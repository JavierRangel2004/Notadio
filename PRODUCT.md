# Notadio

## Product Purpose
Local-first transcription studio for high-value audio: meetings, interviews, strategy calls, voice notes, and Obsidian notes converted to narrated audio. Everything runs on the user's machine (whisper.cpp + ffmpeg + optional Ollama); privacy is the core promise.

## Register
product

## Users
- Primary: a single power user (developer) running it on a Windows desktop with a CUDA GPU, often at night, processing Spanish/Spanglish team dailies and long recordings (90+ min), plus a 1300+ note Obsidian vault.
- Comfort with technical detail is high: device profiles, threads, models, pipeline stages are meaningful, not noise. But diagnostics should be available on demand, not dominate the reading surface.

## Brand & Tone
- "Private transcription atelier": premium, calm, confident. Dark plum/violet surfaces with a deep crimson accent (#9E1B32) and secondary violet (#5D2A7A).
- Bilingual surface: marketing copy in English, vault/operational UI in Spanish. Keep each surface internally consistent.
- Anti-references: generic SaaS dashboards, neon cyberpunk, cluttered admin panels, white-label bootstrap looks.

## Strategic principles
- The transcript is the product. Reading comfort beats chrome.
- Diagnostics (timings, chunk stats, logs) are for debugging: collapsed by default, never competing with content.
- Local-first means states must handle "engine off / model missing / no API key" gracefully and explain in plain language.
- Large collections (1300+ notes) need structure (folders, counts, search) before they need decoration.

## Design system source
`frontend/src/styles.css` defines tokens: --bg-page #0A0510, --bg-surface #1A0B2E, fonts Inter (display) / Manrope (body) / IBM Plex Mono, radius 8/16/24, glass panels, control-strip segmented buttons. Reuse these; do not introduce new palettes.
