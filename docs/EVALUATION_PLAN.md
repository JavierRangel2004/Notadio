# Evaluation and Improvement Plan: GPU Run Analysis (gpuWin15_03V4.txt)

## Executive Summary
This evaluation reviews the processing log `gpuWin15_03V4.txt` following our recent code changes. The results show excellent progress on the system architecture (GPU detection and Translation), but the AI summarization stage continues to struggle with contextual comprehension and structural hallucination, particularly when analyzing non-corporate audio.

---

## 1. System & Runtime Evaluation

### 🟢 1.1 Whisper Transcription & Translation Performance
*   **Result:** EXCELLENT. 
*   **Analysis:** The 3-minute, 8-second audio file was transcribed in 18.1 seconds, and an English translation was generated in 25.8 seconds. This demonstrates that the Whisper runtime is highly performant.

### 🟢 1.2 False Positive GPU Warning (FIXED)
*   **Result:** RESOLVED.
*   **Analysis:** The critical UI bug where the frontend warned about a CPU fallback is no longer present in the V4 log. The system correctly identifies and relies on the GPU (`CUDA0`) without emitting false warnings.

### 🟡 1.3 Diarization Warnings
*   **Result:** TECHNICAL DEBT.
*   **Analysis:** The Python diarization environment continues to throw deprecation warnings regarding `torchaudio.sox_effects.apply_effects_file`. While this does not break the pipeline, it pollutes the logs.
*   **Solution:** Suppress the warning or update the Python library calls to `torchcodec`.

---

## 2. Summarization & LLM Evaluation

### 🔴 2.1 Persistent Contextual Hallucination
*   **Result:** FAIL.
*   **Analysis:** The audio is a Twitch/YouTube live stream where the speaker is talking about Twitch bits, chat donations, and jokes about a subscriber taking their mother's credit card ("tarjeta") to donate 100k.
    *   The LLM misinterpreted "tarjeta" (credit card) as "tarjetas de identificación" (ID cards).
    *   It continues to invent corporate-style action items that do not exist, outputting: `Investigar opciones de tarjetas de identificación personalizadas` (Investigate options for custom ID cards).
*   **Root Cause:** The `llama3.2` model (likely the 3B parameter variant) is highly susceptible to prompt bias. Even if we pass generic prompts, small models struggle to comprehend slang or informal contexts and default to standard "meeting" structures (inventing action items out of thin air). 

### 🔴 2.2 Output Duplication (Overview vs Narrative)
*   **Result:** POOR QUALITY.
*   **Analysis:** The `overview` and `narrative` fields in the generated JSON remain 100% identical in the V4 output.
*   **Root Cause:** Small LLM models cannot easily differentiate between similar prompt instructions (e.g., "Write a TL;DR" vs "Write a chronological story"). If the content is short, it simply copies the same text into both JSON keys.

---

## 3. Actionable Improvement Plan

To resolve the ongoing summary issues, the following adjustments must be made:

### Step 1: Force Strict Nulls/Omissions for Redundant Fields
1.  **Modify JSON Schema Instructions:** In `backend/src/services/summaryService.ts`, change the schema instructions to explicitly demand that `narrative` be `null` or omitted if it would just repeat the `overview`.
    *   *Change:* `"narrative": "Si la narración es idéntica al overview o el audio es muy corto, devuelve null o una cadena vacía."*

### Step 2: Aggressive Anti-Hallucination Prompting
1.  **Update `getPresetContext`:** We need to add aggressive negative constraints to the prompts for small models.
    *   *Add:* "BAJO NINGUNA CIRCUNSTANCIA inventes tareas ('actionItems') si nadie se comprometió explícitamente a hacer algo. Una conversación casual NO tiene 'actionItems'."
    *   *Add:* "Si la palabra 'tarjeta' se usa junto a palabras como 'donar', 'bits', 'mamá' o 'dinero', asume que es una tarjeta de crédito/débito, no una tarjeta de identificación." (Or a more generic rule about slang/stream context).

### Step 3: Ensure Frontend Preset Transmission
1.  **Verify the API call:** It is highly likely the frontend is not sending the `preset: "contentCreation"` flag to the backend in the V4 run, causing it to fall back to the default `meeting` preset. 
2.  **Action:** Audit the frontend API layer (`frontend/src/api.ts` or equivalent) to ensure the user's selected preset from the "Session Intake" UI is being successfully passed in the payload to the `/api/jobs/:id/process` endpoint.

### Step 4: Clean up Diarization Logs
1.  Open `scripts/diarize_audio.py` and implement the warning suppression to clean up the UI logs:
    ```python
    import warnings
    warnings.filterwarnings("ignore", category=UserWarning, module="torchaudio")
    ```