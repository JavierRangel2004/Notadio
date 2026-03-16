import test from "node:test";
import assert from "node:assert/strict";
import {
  EnhancementConfig,
  EnhancementStageKey,
  EnhancementStageState,
  EnhancementStatus,
  JobManifest,
  SourceOrigin,
  SummaryPreset
} from "./types.js";

test("JobManifest backward compatibility: legacy jobs without enhancement fields load correctly", () => {
  const legacyJob: JobManifest = {
    id: "legacy-1",
    status: "completed",
    stage: "Transcript ready",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T01:00:00Z",
    warnings: [],
    artifacts: { source: ["/path/source.txt"], english: [] }
  };

  assert.equal(legacyJob.sourceOrigin, undefined);
  assert.equal(legacyJob.transcriptReady, undefined);
  assert.equal(legacyJob.enhancementStatus, undefined);
  assert.equal(legacyJob.enhancementConfig, undefined);
  assert.equal(legacyJob.enhancementStages, undefined);
  assert.equal(legacyJob.status, "completed");
});

test("JobManifest supports new enhancement fields alongside existing fields", () => {
  const enhancedJob: JobManifest = {
    id: "enhanced-1",
    status: "processing",
    stage: "Transcript ready — choose enhancements",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T01:00:00Z",
    sourceOrigin: "recording",
    transcriptReady: true,
    enhancementStatus: "awaiting_selection",
    warnings: [],
    artifacts: { source: [], english: [] }
  };

  assert.equal(enhancedJob.sourceOrigin, "recording");
  assert.equal(enhancedJob.transcriptReady, true);
  assert.equal(enhancedJob.enhancementStatus, "awaiting_selection");
});

test("EnhancementConfig captures selected stages and preset", () => {
  const config: EnhancementConfig = {
    stages: ["translate", "summarize"],
    summaryPreset: "whatsappVoiceNote",
    translationLanguage: "en"
  };

  assert.deepEqual(config.stages, ["translate", "summarize"]);
  assert.equal(config.summaryPreset, "whatsappVoiceNote");
  assert.equal(config.translationLanguage, "en");
});

test("EnhancementConfig with empty stages represents skip", () => {
  const config: EnhancementConfig = { stages: [] };

  assert.equal(config.stages.length, 0);
  assert.equal(config.summaryPreset, undefined);
});

test("EnhancementStageState tracks individual stage lifecycle", () => {
  const pending: EnhancementStageState = { status: "pending" };
  const running: EnhancementStageState = { status: "running" };
  const completed: EnhancementStageState = { status: "completed" };
  const failed: EnhancementStageState = { status: "failed", error: "Ollama unavailable" };

  assert.equal(pending.status, "pending");
  assert.equal(running.status, "running");
  assert.equal(completed.status, "completed");
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "Ollama unavailable");
});

test("All EnhancementStatus values are valid", () => {
  const statuses: EnhancementStatus[] = ["awaiting_selection", "running", "completed", "skipped"];
  assert.equal(statuses.length, 4);
});

test("All SummaryPreset values are valid", () => {
  const presets: SummaryPreset[] = ["meeting", "whatsappVoiceNote", "genericMedia", "contentCreation"];
  assert.equal(presets.length, 4);
});

test("All SourceOrigin values are valid", () => {
  const origins: SourceOrigin[] = ["upload", "recording"];
  assert.equal(origins.length, 2);
});

test("All EnhancementStageKey values are valid", () => {
  const keys: EnhancementStageKey[] = ["translate", "diarize", "summarize"];
  assert.equal(keys.length, 3);
});

test("JobManifest with full enhancement lifecycle fields", () => {
  const job: JobManifest = {
    id: "full-1",
    status: "completed",
    stage: "Processing complete",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T02:00:00Z",
    sourceOrigin: "upload",
    transcriptReady: true,
    enhancementStatus: "completed",
    enhancementConfig: {
      stages: ["diarize", "summarize"],
      summaryPreset: "meeting"
    },
    enhancementStages: {
      diarize: { status: "completed" },
      summarize: { status: "completed" }
    },
    warnings: [],
    artifacts: { source: ["/path/source.txt", "/path/source.srt"], english: [] }
  };

  assert.equal(job.enhancementConfig?.stages.length, 2);
  assert.equal(job.enhancementStages?.diarize?.status, "completed");
  assert.equal(job.enhancementStages?.summarize?.status, "completed");
});
