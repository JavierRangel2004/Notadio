import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import express, { type RequestHandler } from "express";
import cors from "cors";
import multer from "multer";
import mime from "mime-types";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config.js";
import { detectProcessingProfile } from "./services/deviceProfileService.js";
import { normalizeMediaToWav } from "./services/mediaService.js";
import { writeArtifacts } from "./services/exportService.js";
import { applyOptionalDiarization } from "./services/diarizationService.js";
import { transcribeAudio, translateTranscript } from "./services/transcriptionService.js";
import { generateSummary } from "./services/summaryService.js";
import { jobStore } from "./store/jobStore.js";
import { ensureDir, readJsonFile, writeJsonFile } from "./utils/fs.js";
import {
  EnhancementConfig,
  EnhancementStageKey,
  EnhancementStageState,
  JobManifest,
  JobProcessingProfile,
  JobProgress,
  SourceOrigin,
  StageTiming,
  TranscriptRecord
} from "./types.js";
import { JobQueue } from "./utils/jobQueue.js";

const app = express();
const upload = multer({ dest: path.join(config.storageRoot, ".tmp") });
const uploadSingle = upload.single("media") as unknown as RequestHandler;
const jobQueue = new JobQueue(config.maxConcurrentJobs);

type PipelineStageKey = "queued" | "normalize" | "transcribe" | "translate" | "diarize" | "summarize" | "export";

type StageDefinition = {
  key: PipelineStageKey;
  weight: number;
};

type TelemetryContext = {
  stages: StageDefinition[];
};

type PostCompletionActionKey = EnhancementStageKey;

type PostCompletionAction = {
  stageKey: PostCompletionActionKey;
  stageLabel: string;
  exportLabel?: string;
};

const QUEUE_BASELINE_PCT = 5;

app.use(cors({ origin: config.webOrigin }));
app.use(express.json());

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

function getMojibakeScore(value: string): number {
  const suspiciousMatches = value.match(/[ÃÂâðÌÒÓÕ]|[\u0080-\u009f]/g);
  return suspiciousMatches?.length ?? 0;
}

function normalizeUploadFilename(value: string): string {
  const trimmed = value.trim().replace(/[\\/]+/g, "/");
  if (!trimmed) {
    return "upload";
  }

  const normalized = path.basename(trimmed).normalize("NFC");

  try {
    const repaired = Buffer.from(normalized, "latin1").toString("utf8").normalize("NFC");
    if (getMojibakeScore(repaired) < getMojibakeScore(normalized) && repaired.replace(/\s/g, "").length > 0) {
      return repaired;
    }
  } catch {
    // Ignore decode failures and fall back to the original filename.
  }

  return normalized;
}

function buildDefaultProgress(timestamp: string): JobProgress {
  return {
    stageKey: "queued",
    overallPct: 0,
    stagePct: 0,
    startedAt: timestamp,
    elapsedSeconds: 0
  };
}

function buildDefaultProcessing(): JobProcessingProfile {
  return {
    profile: "pending",
    deviceSummary: "Detecting runtime profile",
    threads: 0,
    translationEnabled: config.enableEnglishTranslation,
    runtimeBackend: "pending",
    runtimeSummary: "Waiting for Whisper runtime telemetry",
    capabilityWarnings: []
  };
}

function cloneSummaryDiagnostics(job: JobManifest): JobManifest["summaryDiagnostics"] {
  if (!job.summaryDiagnostics) {
    return undefined;
  }

  return {
    ...job.summaryDiagnostics,
    chunks: job.summaryDiagnostics.chunks.map((chunk) => ({ ...chunk }))
  };
}

function cloneStageTimings(job: JobManifest): JobManifest["stageTimings"] {
  if (!job.stageTimings) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(job.stageTimings).map(([key, value]) => [key, { ...value } satisfies StageTiming])
  );
}

function cloneJob(job: JobManifest): JobManifest {
  return {
    ...job,
    warnings: [...job.warnings],
    logs: [...(job.logs ?? [])],
    summaryDiagnostics: cloneSummaryDiagnostics(job),
    stageTimings: cloneStageTimings(job),
    progress: job.progress ? { ...job.progress } : buildDefaultProgress(job.createdAt),
    processing: job.processing ? { ...job.processing } : buildDefaultProcessing(),
    artifacts: {
      source: [...job.artifacts.source],
      english: [...job.artifacts.english]
    }
  };
}

function makeJobResponse(job: JobManifest) {
  const normalized = cloneJob(job);
  return {
    id: normalized.id,
    status: normalized.status,
    stage: normalized.stage,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    sourceOrigin: normalized.sourceOrigin,
    sourceMedia: normalized.sourceMedia
      ? {
        originalName: normalized.sourceMedia.originalName,
        mimeType: normalized.sourceMedia.mimeType,
        sizeBytes: normalized.sourceMedia.sizeBytes
      }
      : undefined,
    detectedLanguage: normalized.detectedLanguage,
    durationSeconds: normalized.durationSeconds,
    warnings: normalized.warnings,
    error: normalized.error,
    transcriptReady: normalized.transcriptReady,
    enhancementStatus: normalized.enhancementStatus,
    enhancementConfig: normalized.enhancementConfig,
    enhancementStages: normalized.enhancementStages ? { ...normalized.enhancementStages } : undefined,
    summaryDiagnostics: normalized.summaryDiagnostics,
    stageTimings: normalized.stageTimings,
    progress: normalized.progress,
    processing: normalized.processing,
    logs: normalized.logs,
    artifacts: normalized.artifacts
  };
}

/**
 * Update job in-memory with debounced disk persistence.
 * For progress-only telemetry updates — avoids disk I/O on every tick.
 */
function updateJobDebounced(jobId: string, updater: (job: JobManifest) => void): void {
  const current = jobStore.get(jobId);
  if (!current) return;

  updater(current);
  current.updatedAt = new Date().toISOString();
  jobStore.debouncedPersist(current);
}

/**
 * Update job with immediate disk persistence.
 * For critical state transitions (status changes, final writes).
 */
async function updateJobImmediate(jobId: string, updater: (job: JobManifest) => void): Promise<JobManifest> {
  const current = jobStore.get(jobId);
  if (!current) {
    throw new Error(`Job ${jobId} not found`);
  }

  updater(current);
  current.updatedAt = new Date().toISOString();
  await jobStore.persist(current);
  return current;
}

function estimateStageWeight(
  stageKey: Exclude<PipelineStageKey, "queued">,
  processing: JobProcessingProfile,
  durationSeconds?: number
): number {
  const duration = Math.max(60, durationSeconds ?? 0);
  const appleSilicon = processing.deviceSummary.toLowerCase().includes("apple silicon");

  switch (stageKey) {
    case "normalize":
      return Math.max(12, Math.min(36, duration * 0.02));
    case "transcribe":
      if (appleSilicon) {
        return Math.max(20, duration * 0.035);
      }
      if (processing.profile === "speed") {
        return Math.max(20, duration * 0.05);
      }
      if (processing.profile === "quality") {
        return Math.max(35, duration * 0.18);
      }
      return Math.max(26, duration * 0.09);
    case "translate":
      if (appleSilicon) {
        return Math.max(18, duration * 0.03);
      }
      if (processing.profile === "speed") {
        return Math.max(16, duration * 0.045);
      }
      if (processing.profile === "quality") {
        return Math.max(28, duration * 0.12);
      }
      return Math.max(20, duration * 0.07);
    case "diarize":
      return Math.max(28, duration * (appleSilicon ? 0.11 : 0.09));
    case "summarize":
      return Math.max(18, Math.min(90, duration * 0.035));
    case "export":
      return Math.max(8, Math.min(20, duration * 0.01));
  }
}

function buildTelemetryContext(processing: JobProcessingProfile, durationSeconds?: number): TelemetryContext {
  const stages: StageDefinition[] = [
    { key: "normalize", weight: estimateStageWeight("normalize", processing, durationSeconds) },
    { key: "transcribe", weight: estimateStageWeight("transcribe", processing, durationSeconds) }
  ];

  if (processing.translationEnabled) {
    stages.push({ key: "translate", weight: estimateStageWeight("translate", processing, durationSeconds) });
  }

  if (config.diarizationCommand) {
    stages.push({ key: "diarize", weight: estimateStageWeight("diarize", processing, durationSeconds) });
  }

  if (config.enableSummary) {
    stages.push({ key: "summarize", weight: estimateStageWeight("summarize", processing, durationSeconds) });
  }

  stages.push({ key: "export", weight: estimateStageWeight("export", processing, durationSeconds) });
  return { stages };
}

function calculateOverallPct(context: TelemetryContext, stageKey: PipelineStageKey, stagePct: number): number {
  if (stageKey === "queued") {
    return clampPct(stagePct * (QUEUE_BASELINE_PCT / 100));
  }

  const totalWeight = context.stages.reduce((sum, stage) => sum + stage.weight, 0) || 1;
  let completedWeight = 0;
  let currentWeight = 0;

  for (const stage of context.stages) {
    if (stage.key === stageKey) {
      currentWeight = stage.weight;
      break;
    }

    completedWeight += stage.weight;
  }

  const weightedPct = completedWeight + currentWeight * (clampPct(stagePct) / 100);
  return clampPct(QUEUE_BASELINE_PCT + (weightedPct / totalWeight) * (100 - QUEUE_BASELINE_PCT));
}

/** Append log line in-place, trimming to limit. */
function appendLog(job: JobManifest, line: string): void {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  if (!job.logs) {
    job.logs = [];
  }

  const lastLog = job.logs.at(-1);
  const normalizedLine = trimmed.toLowerCase();
  const normalizedLastLog = lastLog?.trim().toLowerCase();
  const isDuplicateDiarizationCompletion =
    normalizedLine.startsWith("diarization complete.") &&
    normalizedLastLog?.startsWith("diarization complete.");

  if (normalizedLastLog === normalizedLine || isDuplicateDiarizationCompletion) {
    return;
  }

  job.logs.push(trimmed);
  const excess = job.logs.length - config.jobLogLimit;
  if (excess > 0) {
    job.logs.splice(0, excess);
  }
}

function updateProgress(job: JobManifest, context: TelemetryContext, stageKey: PipelineStageKey, stagePct: number): void {
  const progress = job.progress ?? buildDefaultProgress(job.createdAt);
  const startedAt = progress.startedAt ?? new Date().toISOString();
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000));
  const overallPct = calculateOverallPct(context, stageKey, stagePct);
  const etaSeconds =
    overallPct > 0 ? Math.max(0, Math.round((elapsedSeconds * (100 - overallPct)) / overallPct)) : undefined;

  job.progress = {
    stageKey,
    overallPct,
    stagePct: clampPct(stagePct),
    startedAt,
    elapsedSeconds,
    etaSeconds
  };
}

function ensureStageTimings(job: JobManifest): Record<string, StageTiming> {
  if (!job.stageTimings) {
    job.stageTimings = {};
  }

  return job.stageTimings;
}

function startStageTiming(job: JobManifest, stageKey: string, label: string): void {
  const stageTimings = ensureStageTimings(job);
  const existing = stageTimings[stageKey];

  if (existing) {
    existing.label = label;
    if (!existing.startedAt) {
      existing.startedAt = new Date().toISOString();
    }
    return;
  }

  stageTimings[stageKey] = {
    key: stageKey,
    label,
    startedAt: new Date().toISOString()
  };
}

function completeStageTiming(job: JobManifest, stageKey?: string): void {
  if (!stageKey) {
    return;
  }

  const stageTimings = ensureStageTimings(job);
  const existing = stageTimings[stageKey];
  if (!existing || existing.completedAt) {
    return;
  }

  const completedAt = new Date().toISOString();
  existing.completedAt = completedAt;
  existing.durationMs = Math.max(0, new Date(completedAt).getTime() - new Date(existing.startedAt).getTime());
}

function resetStageTiming(job: JobManifest, stageKey: string): void {
  if (!job.stageTimings) {
    return;
  }

  delete job.stageTimings[stageKey];
}

function transitionStageTiming(job: JobManifest, stageKey: PipelineStageKey, label: string): void {
  const currentStageKey = job.progress?.stageKey;
  if (currentStageKey && currentStageKey !== stageKey) {
    completeStageTiming(job, currentStageKey);
  }

  startStageTiming(job, stageKey, label);
}

/**
 * Apply a telemetry update. Uses debounced persistence for progress-only updates,
 * and immediate persistence for status transitions.
 */
function applyTelemetryUpdate(
  jobId: string,
  context: TelemetryContext,
  patch: {
    status?: JobManifest["status"];
    stage?: string;
    stageKey?: PipelineStageKey;
    stagePct?: number;
    logLine?: string;
    error?: string;
    processing?: Partial<JobProcessingProfile>;
  }
): void {
  const isStatusChange = patch.status !== undefined;

  const updater = (job: JobManifest) => {
    if (patch.status) {
      job.status = patch.status;
    }

    if (patch.stage) {
      job.stage = patch.stage;
    }

    if (patch.processing) {
      job.processing = {
        ...(job.processing ?? buildDefaultProcessing()),
        ...patch.processing
      };
    }

    if (patch.logLine) {
      appendLog(job, patch.logLine);
      const normalizedLine = patch.logLine.toLowerCase();
      const processing = job.processing ?? buildDefaultProcessing();

      if (normalizedLine.includes("whisper_backend_init_gpu: no gpu found")) {
        const hasHostGpuHint = processing.deviceSummary.toLowerCase().includes("nvidia gpu detected");
        const capabilityWarnings = [...(processing.capabilityWarnings ?? [])];
        const warning =
          "Host GPU detected, but the current whisper runtime fell back to CPU. Verify that WHISPER_COMMAND points to a GPU-enabled whisper.cpp build.";
        if (hasHostGpuHint && !capabilityWarnings.includes(warning)) {
          capabilityWarnings.push(warning);
          if (!job.warnings.includes(warning)) {
            job.warnings.push(warning);
          }
        }

        job.processing = {
          ...processing,
          runtimeBackend: "cpu",
          runtimeSummary: "Whisper runtime reported CPU fallback",
          capabilityWarnings
        };
      } else if (normalizedLine.includes("device 0: cpu")) {
        job.processing = {
          ...processing,
          runtimeBackend: processing.runtimeBackend === "pending" ? "cpu" : processing.runtimeBackend,
          runtimeSummary:
            processing.runtimeSummary === "Waiting for Whisper runtime telemetry"
              ? "Whisper runtime is using CPU"
              : processing.runtimeSummary
        };
      } else if (normalizedLine.includes("cuda") || normalizedLine.includes("gpu") && normalizedLine.includes("backend")) {
        job.processing = {
          ...processing,
          runtimeBackend: processing.runtimeBackend === "pending" ? "gpu" : processing.runtimeBackend,
          runtimeSummary:
            processing.runtimeSummary === "Waiting for Whisper runtime telemetry"
              ? patch.logLine
              : processing.runtimeSummary
        };
      } else if (normalizedLine.startsWith("system_info:")) {
        job.processing = {
          ...processing,
          runtimeSummary: patch.logLine
        };
      }
    }

    if (patch.stageKey) {
      transitionStageTiming(job, patch.stageKey, patch.stage ?? job.stage);
      updateProgress(job, context, patch.stageKey, patch.stagePct ?? job.progress?.stagePct ?? 0);
    }

    if (patch.error) {
      job.error = patch.error;
    }
  };

  if (isStatusChange) {
    // Status transitions are critical — persist immediately (fire and forget)
    void updateJobImmediate(jobId, updater);
  } else {
    // Progress-only updates — debounce disk writes
    updateJobDebounced(jobId, updater);
  }
}

function buildBaseTelemetryContext(processing: JobProcessingProfile, durationSeconds?: number): TelemetryContext {
  return {
    stages: [
      { key: "normalize", weight: estimateStageWeight("normalize", processing, durationSeconds) },
      { key: "transcribe", weight: estimateStageWeight("transcribe", processing, durationSeconds) },
      { key: "export", weight: estimateStageWeight("export", processing, durationSeconds) }
    ]
  };
}

function buildEnhancementTelemetryContext(
  selectedStages: EnhancementStageKey[],
  processing: JobProcessingProfile,
  durationSeconds?: number,
  options: { includeExport?: boolean } = {}
): TelemetryContext {
  const stages: StageDefinition[] = selectedStages.map((key) => ({
    key: key as PipelineStageKey,
    weight: estimateStageWeight(key as Exclude<PipelineStageKey, "queued">, processing, durationSeconds)
  }));

  if (options.includeExport ?? true) {
    stages.push({ key: "export", weight: estimateStageWeight("export", processing, durationSeconds) });
  }

  return { stages };
}

function getRunningEnhancementStage(job: JobManifest): EnhancementStageKey | undefined {
  if (!job.enhancementStages) {
    return undefined;
  }

  return (Object.entries(job.enhancementStages).find(([, state]) => state.status === "running")?.[0] ??
    undefined) as EnhancementStageKey | undefined;
}

function ensureNoRunningPostAction(job: JobManifest): string | undefined {
  const runningStage = getRunningEnhancementStage(job);
  if (!runningStage) {
    return undefined;
  }

  return `Another post-processing action is already running: ${runningStage}.`;
}

async function startPostCompletionAction(jobId: string, action: PostCompletionAction): Promise<JobManifest> {
  return updateJobImmediate(jobId, (current) => {
    const runningError = ensureNoRunningPostAction(current);
    if (runningError) {
      throw new Error(runningError);
    }

    current.error = undefined;
    current.stage = action.stageLabel;
    current.enhancementStatus = "completed";
    current.enhancementStages = {
      ...(current.enhancementStages ?? {}),
      [action.stageKey]: { status: "running" }
    };
    appendLog(current, `[${action.stageKey}-retry] Started.`);
    resetStageTiming(current, action.stageKey);
    if (action.exportLabel) {
      resetStageTiming(current, "export");
    }
    current.progress = {
      stageKey: action.stageKey,
      overallPct: 0,
      stagePct: 0,
      startedAt: new Date().toISOString(),
      elapsedSeconds: 0,
      etaSeconds: undefined
    };
  });
}

async function failPostCompletionAction(
  jobId: string,
  action: PostCompletionAction,
  message: string
): Promise<void> {
  await updateJobImmediate(jobId, (current) => {
    completeStageTiming(current, current.progress?.stageKey);
    current.stage = `${action.stageLabel} failed`;
    current.error = message;
    current.enhancementStages = {
      ...(current.enhancementStages ?? {}),
      [action.stageKey]: { status: "failed", error: message }
    };
    appendLog(current, `[${action.stageKey}-retry] ${message}`);
  });
}

async function completePostCompletionAction(
  jobId: string,
  action: PostCompletionAction,
  options?: {
    warnings?: string[];
    stageStatus?: EnhancementStageState;
  }
): Promise<void> {
  await updateJobImmediate(jobId, (current) => {
    completeStageTiming(current, current.progress?.stageKey);
    current.stage = "Processing complete";
    current.error = undefined;
    current.enhancementStatus = "completed";
    current.enhancementStages = {
      ...(current.enhancementStages ?? {}),
      [action.stageKey]: options?.stageStatus ?? { status: "completed" }
    };
    if (options?.warnings?.length) {
      current.warnings = [...current.warnings, ...options.warnings];
    }
    appendLog(current, `[${action.stageKey}-retry] Completed.`);
    current.progress = {
      ...(current.progress ?? buildDefaultProgress(current.createdAt)),
      stageKey: action.exportLabel ? "export" : action.stageKey,
      stagePct: 100,
      overallPct: 100,
      elapsedSeconds: Math.max(
        0,
        Math.round(
          (Date.now() - new Date((current.progress ?? buildDefaultProgress(current.createdAt)).startedAt ?? current.createdAt).getTime()) / 1000
        )
      ),
      etaSeconds: 0
    };
  });
}

async function processBaseJob(jobId: string): Promise<void> {
  const processingProfile = detectProcessingProfile();
  let telemetry = buildBaseTelemetryContext(processingProfile);

  try {
    const job = jobStore.get(jobId);
    if (!job?.sourceMedia) {
      throw new Error("Missing uploaded media file.");
    }

    const jobDir = jobStore.getJobDir(jobId);
    const workingDir = path.join(jobDir, "working");
    const artifactDir = jobStore.getArtifactDir(jobId);
    await ensureDir(workingDir);
    await ensureDir(artifactDir);

    applyTelemetryUpdate(jobId, telemetry, {
      status: "processing",
      stage: "Normalizing media for transcription",
      stageKey: "queued",
      stagePct: 100,
      processing: processingProfile,
      logLine: `Detected processing profile: ${processingProfile.profile} (${processingProfile.deviceSummary})`
    });

    applyTelemetryUpdate(jobId, telemetry, {
      stage: "Normalizing media for transcription",
      stageKey: "normalize",
      stagePct: 0
    });

    const normalization = await normalizeMediaToWav(job.sourceMedia.storedPath, workingDir, {
      onLog: (line) => applyTelemetryUpdate(jobId, telemetry, { stageKey: "normalize", logLine: line }),
      onProgress: (stagePct) =>
        applyTelemetryUpdate(jobId, telemetry, {
          stage: "Normalizing media for transcription",
          stageKey: "normalize",
          stagePct
        })
    });

    await updateJobImmediate(jobId, (current) => {
      current.normalizedAudioPath = normalization.outputPath;
      current.durationSeconds = normalization.durationSeconds;
    });

    telemetry = buildBaseTelemetryContext(processingProfile, normalization.durationSeconds);

    applyTelemetryUpdate(jobId, telemetry, {
      stage: "Running local Whisper transcription",
      stageKey: "transcribe",
      stagePct: 0,
      logLine: `Whisper thread recommendation: ${processingProfile.threads}`
    });

    const baseProfile: JobProcessingProfile = { ...processingProfile, translationEnabled: false };
    const transcriptVariants = await transcribeAudio(normalization.outputPath, path.join(workingDir, "whisper"), {
      durationSeconds: normalization.durationSeconds,
      processingProfile: baseProfile,
      onSourceLog: (line: string) =>
        applyTelemetryUpdate(jobId, telemetry, {
          stage: "Running local Whisper transcription",
          stageKey: "transcribe",
          logLine: line
        }),
      onSourceProgress: (stagePct: number) =>
        applyTelemetryUpdate(jobId, telemetry, {
          stage: "Running local Whisper transcription",
          stageKey: "transcribe",
          stagePct
        })
    });

    const latestJob = jobStore.get(jobId);
    const warnings = [
      ...(latestJob?.warnings ?? []),
      ...transcriptVariants.warnings
    ];

    if (transcriptVariants.source.segments.length === 0) {
      throw new Error("Transcription completed without parsed source segments.");
    }

    const transcriptRecord: TranscriptRecord = {
      jobId,
      sourceMedia: {
        originalName: job.sourceMedia.originalName,
        mimeType: job.sourceMedia.mimeType,
        sizeBytes: job.sourceMedia.sizeBytes
      },
      durationSeconds: transcriptVariants.source.segments.at(-1)?.end ?? normalization.durationSeconds,
      detectedLanguage: transcriptVariants.source.language,
      warnings,
      source: transcriptVariants.source
    };

    if (!transcriptRecord.source.text.trim() || transcriptRecord.source.segments.length === 0) {
      throw new Error("Transcript was generated but contains no source transcript content.");
    }

    const transcriptPath = path.join(jobDir, "transcript.json");
    await writeJsonFile(transcriptPath, transcriptRecord);
    jobStore.setTranscript(jobId, transcriptRecord);

    applyTelemetryUpdate(jobId, telemetry, {
      stage: "Writing transcript artifacts",
      stageKey: "export",
      stagePct: 20
    });

    const artifacts = await writeArtifacts(transcriptRecord, artifactDir);

    await updateJobImmediate(jobId, (current) => {
      completeStageTiming(current, current.progress?.stageKey);
      current.transcriptPath = transcriptPath;
      current.detectedLanguage = transcriptRecord.detectedLanguage;
      current.durationSeconds = transcriptRecord.durationSeconds;
      current.warnings = warnings;
      current.artifacts = artifacts;
      current.transcriptReady = true;
      current.enhancementStatus = "awaiting_selection";
      current.stage = "Transcript ready \u2014 choose enhancements";
      appendLog(current, "Base transcription complete. Waiting for enhancement selection.");
      current.progress = {
        ...(current.progress ?? buildDefaultProgress(current.createdAt)),
        stageKey: "export",
        stagePct: 100,
        overallPct: 100,
        elapsedSeconds: Math.max(
          0,
          Math.round(
            (Date.now() - new Date((current.progress ?? buildDefaultProgress(current.createdAt)).startedAt ?? current.createdAt).getTime()) / 1000
          )
        ),
        etaSeconds: 0
      };
      current.processing = {
        ...(current.processing ?? buildDefaultProcessing()),
        runtimeBackend: current.processing?.runtimeBackend ?? "cpu",
        runtimeSummary:
          current.processing?.runtimeSummary ?? "Transcription finished with captured runtime telemetry"
      };
    });
  } catch (error) {
    await updateJobImmediate(jobId, (current) => {
      completeStageTiming(current, current.progress?.stageKey);
      current.status = "failed";
      current.stage = "Processing failed";
      current.error = error instanceof Error ? error.message : "Unknown processing error";
      appendLog(current, current.error);
    });
  }
}

async function processEnhancements(jobId: string): Promise<void> {
  const job = jobStore.get(jobId);
  if (!job?.sourceMedia || !job.transcriptPath || !job.normalizedAudioPath || !job.enhancementConfig) {
    throw new Error("Job is not ready for enhancement processing.");
  }

  const enhancementConfig = job.enhancementConfig;
  const stages = enhancementConfig.stages;
  const processingProfile = job.processing ?? buildDefaultProcessing();
  const telemetry = buildEnhancementTelemetryContext(stages, processingProfile, job.durationSeconds);

  const enhancementStageStates: Record<string, EnhancementStageState> = {};
  for (const stage of stages) {
    enhancementStageStates[stage] = { status: "pending" };
  }

  await updateJobImmediate(jobId, (current) => {
    current.enhancementStatus = "running";
    current.enhancementStages = enhancementStageStates;
    current.stage = "Running enhancements";
    appendLog(current, `Starting enhancements: ${stages.join(", ")}`);
    current.progress = {
      ...(current.progress ?? buildDefaultProgress(current.createdAt)),
      stageKey: (stages[0] ?? "export") as string,
      overallPct: 0,
      stagePct: 0,
      etaSeconds: undefined
    };
  });

  try {
    const jobDir = jobStore.getJobDir(jobId);
    const workingDir = path.join(jobDir, "working");
    const artifactDir = jobStore.getArtifactDir(jobId);
    const transcriptRecord = await readJsonFile<TranscriptRecord>(job.transcriptPath);
    const warnings: string[] = [];

    if (stages.includes("translate")) {
      await updateJobImmediate(jobId, (current) => {
        if (current.enhancementStages) current.enhancementStages.translate = { status: "running" };
      });
      applyTelemetryUpdate(jobId, telemetry, {
        stage: "Generating English translation",
        stageKey: "translate",
        stagePct: 0
      });
      try {
        const english = await translateTranscript(transcriptRecord.source, {
          onLog: (line) => applyTelemetryUpdate(jobId, telemetry, {
            stage: "Generating English translation",
            stageKey: "translate",
            logLine: line
          }),
          onProgress: (stagePct) => applyTelemetryUpdate(jobId, telemetry, {
            stage: "Generating English translation",
            stageKey: "translate",
            stagePct
          })
        });
        transcriptRecord.english = english;
        await updateJobImmediate(jobId, (current) => {
          if (current.enhancementStages) current.enhancementStages.translate = { status: "completed" };
        });
      } catch (error) {
        const message = error instanceof Error
          ? `English translation failed: ${error.message}`
          : "English translation failed.";
        warnings.push(message);
        await updateJobImmediate(jobId, (current) => {
          if (current.enhancementStages) current.enhancementStages.translate = { status: "failed", error: message };
        });
      }
    }

    if (stages.includes("diarize")) {
      await updateJobImmediate(jobId, (current) => {
        if (current.enhancementStages) current.enhancementStages.diarize = { status: "running" };
      });
      applyTelemetryUpdate(jobId, telemetry, {
        stage: "Applying speaker diarization",
        stageKey: "diarize",
        stagePct: 0
      });
      const diarization = await applyOptionalDiarization(
        job.normalizedAudioPath,
        path.join(workingDir, "diarization"),
        transcriptRecord.source.segments,
        {
          durationSeconds: job.durationSeconds,
          onLog: (line) => applyTelemetryUpdate(jobId, telemetry, {
            stage: "Applying speaker diarization",
            stageKey: "diarize",
            logLine: line
          }),
          onProgress: (stagePct) => applyTelemetryUpdate(jobId, telemetry, {
            stage: "Applying speaker diarization",
            stageKey: "diarize",
            stagePct
          })
        }
      );
      warnings.push(...diarization.warnings);
      transcriptRecord.source = { ...transcriptRecord.source, segments: diarization.segments };
      const hasSpeakers = diarization.segments.some((s) => s.speaker);
      await updateJobImmediate(jobId, (current) => {
        if (current.enhancementStages) {
          current.enhancementStages.diarize = {
            status: hasSpeakers ? "completed" : "failed",
            error: hasSpeakers ? undefined : "Diarization did not produce speaker labels"
          };
        }
      });
    }

    if (stages.includes("summarize")) {
      await updateJobImmediate(jobId, (current) => {
        if (current.enhancementStages) current.enhancementStages.summarize = { status: "running" };
      });
      applyTelemetryUpdate(jobId, telemetry, {
        stage: "Generating AI summary",
        stageKey: "summarize",
        stagePct: 0
      });
      const summaryResult = await generateSummary(
        transcriptRecord,
        {
          onLog: (line) => applyTelemetryUpdate(jobId, telemetry, {
            stage: "Generating AI summary",
            stageKey: "summarize",
            logLine: line
          }),
          onProgress: (stagePct) => applyTelemetryUpdate(jobId, telemetry, {
            stage: "Generating AI summary",
            stageKey: "summarize",
            stagePct
          })
        },
        { preset: enhancementConfig.summaryPreset, force: true }
      );
      warnings.push(...summaryResult.warnings);
      if (summaryResult.summary) {
        transcriptRecord.summary = summaryResult.summary;
        transcriptRecord.summaryDiagnostics = summaryResult.summaryDiagnostics;
        const summaryPath = path.join(jobDir, "summary.json");
        await writeJsonFile(summaryPath, summaryResult.summary);
        await updateJobImmediate(jobId, (current) => {
          current.summaryPath = summaryPath;
          current.summaryDiagnostics = summaryResult.summaryDiagnostics;
          if (current.enhancementStages) current.enhancementStages.summarize = { status: "completed" };
        });
      } else {
        await updateJobImmediate(jobId, (current) => {
          if (current.enhancementStages) {
            current.enhancementStages.summarize = {
              status: "failed",
              error: summaryResult.warnings.join("; ") || "Summary generation failed"
            };
          }
        });
      }
    }

    await writeJsonFile(job.transcriptPath, transcriptRecord);
    jobStore.setTranscript(jobId, transcriptRecord);

    applyTelemetryUpdate(jobId, telemetry, {
      stage: "Writing enhanced artifacts",
      stageKey: "export",
      stagePct: 20
    });

    const artifacts = await writeArtifacts(transcriptRecord, artifactDir);

    await updateJobImmediate(jobId, (current) => {
      completeStageTiming(current, current.progress?.stageKey);
      current.status = "completed";
      current.stage = "Processing complete";
      current.enhancementStatus = "completed";
      current.artifacts = artifacts;
      current.warnings = [...current.warnings, ...warnings];
      appendLog(current, "Enhancement processing complete.");
      current.progress = {
        ...(current.progress ?? buildDefaultProgress(current.createdAt)),
        stageKey: "export",
        stagePct: 100,
        overallPct: 100,
        elapsedSeconds: Math.max(
          0,
          Math.round(
            (Date.now() - new Date((current.progress ?? buildDefaultProgress(current.createdAt)).startedAt ?? current.createdAt).getTime()) / 1000
          )
        ),
        etaSeconds: 0
      };
    });
  } catch (error) {
    await updateJobImmediate(jobId, (current) => {
      completeStageTiming(current, current.progress?.stageKey);
      current.status = "failed";
      current.stage = "Enhancement processing failed";
      current.enhancementStatus = "completed";
      current.error = error instanceof Error ? error.message : "Unknown enhancement error";
      appendLog(current, current.error);
    });
  }
}

async function processSummaryRetry(jobId: string): Promise<void> {
  const job = jobStore.get(jobId);
  if (!job?.transcriptPath) {
    throw new Error("No cached transcript available.");
  }

  const action: PostCompletionAction = {
    stageKey: "summarize",
    stageLabel: "Regenerating AI summary"
  };

  const processingProfile = job.processing ?? buildDefaultProcessing();
  const telemetry = buildEnhancementTelemetryContext(["summarize"], processingProfile, job.durationSeconds, {
    includeExport: false
  });

  try {
    const transcriptRecord = await readJsonFile<TranscriptRecord>(job.transcriptPath);
    const jobDir = jobStore.getJobDir(jobId);
    const summaryResult = await generateSummary(
      transcriptRecord,
      {
        onLog: (line) => applyTelemetryUpdate(jobId, telemetry, {
          stage: action.stageLabel,
          stageKey: "summarize",
          logLine: `[summary-retry] ${line}`
        }),
        onProgress: (stagePct) => applyTelemetryUpdate(jobId, telemetry, {
          stage: action.stageLabel,
          stageKey: "summarize",
          stagePct
        })
      },
      { preset: job.enhancementConfig?.summaryPreset, force: true }
    );

    if (!summaryResult.summary) {
      throw new Error(summaryResult.warnings.join("; ") || "Summary generation failed.");
    }

    transcriptRecord.summary = summaryResult.summary;
    transcriptRecord.summaryDiagnostics = summaryResult.summaryDiagnostics;
    const summaryPath = path.join(jobDir, "summary.json");
    await writeJsonFile(summaryPath, summaryResult.summary);
    await writeJsonFile(job.transcriptPath, transcriptRecord);
    jobStore.setTranscript(jobId, transcriptRecord);

    await updateJobImmediate(jobId, (current) => {
      current.summaryPath = summaryPath;
      current.summaryDiagnostics = summaryResult.summaryDiagnostics;
      current.warnings = current.warnings.filter((warning) => !warning.startsWith("AI summary skipped"));
      current.warnings.push(...summaryResult.warnings);
    });

    await completePostCompletionAction(jobId, action);
  } catch (error) {
    await failPostCompletionAction(
      jobId,
      action,
      error instanceof Error ? error.message : "Summary regeneration failed."
    );
  }
}

async function processDiarizationRetry(jobId: string): Promise<void> {
  const job = jobStore.get(jobId);
  if (!job?.transcriptPath || !job.normalizedAudioPath) {
    throw new Error("No cached transcript or audio available.");
  }

  const action: PostCompletionAction = {
    stageKey: "diarize",
    stageLabel: "Re-running speaker identification",
    exportLabel: "Writing enhanced artifacts"
  };
  const processingProfile = job.processing ?? buildDefaultProcessing();
  const telemetry = buildEnhancementTelemetryContext(["diarize"], processingProfile, job.durationSeconds);

  try {
    const transcriptRecord = await readJsonFile<TranscriptRecord>(job.transcriptPath);
    const jobDir = jobStore.getJobDir(jobId);
    const workingDir = path.join(jobDir, "working");
    const artifactDir = jobStore.getArtifactDir(jobId);
    const rawSegments = transcriptRecord.source.segments.map((segment) => ({ ...segment, speaker: undefined }));

    const diarization = await applyOptionalDiarization(
      job.normalizedAudioPath,
      path.join(workingDir, "diarization"),
      rawSegments,
      {
        durationSeconds: job.durationSeconds,
        onLog: (line) => applyTelemetryUpdate(jobId, telemetry, {
          stage: action.stageLabel,
          stageKey: "diarize",
          logLine: `[diarize-retry] ${line}`
        }),
        onProgress: (stagePct) => applyTelemetryUpdate(jobId, telemetry, {
          stage: action.stageLabel,
          stageKey: "diarize",
          stagePct
        })
      }
    );

    transcriptRecord.source.segments = diarization.segments;
    await writeJsonFile(job.transcriptPath, transcriptRecord);
    jobStore.setTranscript(jobId, transcriptRecord);

    applyTelemetryUpdate(jobId, telemetry, {
      stage: action.exportLabel,
      stageKey: "export",
      stagePct: 20
    });

    const artifacts = await writeArtifacts(transcriptRecord, artifactDir);
    const hasSpeakers = diarization.segments.some((segment) => segment.speaker);

    await updateJobImmediate(jobId, (current) => {
      current.artifacts = artifacts;
      current.warnings = current.warnings.filter((warning) => !warning.toLowerCase().includes("diarization"));
      current.warnings.push(...diarization.warnings);
    });

    await completePostCompletionAction(jobId, action, {
      stageStatus: hasSpeakers
        ? { status: "completed" }
        : { status: "failed", error: "Diarization did not produce speaker labels" }
    });
  } catch (error) {
    await failPostCompletionAction(
      jobId,
      action,
      error instanceof Error ? error.message : "Speaker identification retry failed."
    );
  }
}

async function processTranslationRetry(jobId: string): Promise<void> {
  const job = jobStore.get(jobId);
  if (!job?.transcriptPath || !job.normalizedAudioPath) {
    throw new Error("No cached transcript or audio available.");
  }

  const action: PostCompletionAction = {
    stageKey: "translate",
    stageLabel: "Generating English translation",
    exportLabel: "Writing enhanced artifacts"
  };
  const processingProfile = {
    ...(job.processing ?? buildDefaultProcessing()),
    translationEnabled: true
  };
  const telemetry = buildEnhancementTelemetryContext(["translate"], processingProfile, job.durationSeconds);

  try {
    const transcriptRecord = await readJsonFile<TranscriptRecord>(job.transcriptPath);
    const jobDir = jobStore.getJobDir(jobId);
    const workingDir = path.join(jobDir, "working");
    const artifactDir = jobStore.getArtifactDir(jobId);

    const english = await translateTranscript(transcriptRecord.source, {
      onLog: (line) => applyTelemetryUpdate(jobId, telemetry, {
        stage: action.stageLabel,
        stageKey: "translate",
        logLine: `[translate-retry] ${line}`
      }),
      onProgress: (stagePct) => applyTelemetryUpdate(jobId, telemetry, {
        stage: action.stageLabel,
        stageKey: "translate",
        stagePct
      })
    });

    transcriptRecord.english = english;
    await writeJsonFile(job.transcriptPath, transcriptRecord);
    jobStore.setTranscript(jobId, transcriptRecord);

    applyTelemetryUpdate(jobId, telemetry, {
      stage: action.exportLabel,
      stageKey: "export",
      stagePct: 20
    });

    const artifacts = await writeArtifacts(transcriptRecord, artifactDir);

    await updateJobImmediate(jobId, (current) => {
      current.artifacts = artifacts;
      current.processing = {
        ...(current.processing ?? buildDefaultProcessing()),
        translationEnabled: true
      };
    });

    await completePostCompletionAction(jobId, action);
  } catch (error) {
    await failPostCompletionAction(
      jobId,
      action,
      error instanceof Error ? error.message : "Translation retry failed."
    );
  }
}

app.post("/api/uploads", uploadSingle, async (req, res) => {
  const uploadedFile = req.file;

  if (!uploadedFile) {
    res.status(400).send("Expected a media file in the `media` field.");
    return;
  }

  const originalName = normalizeUploadFilename(uploadedFile.originalname);
  const sourceOrigin = (req.body?.sourceOrigin === "recording" ? "recording" : "upload") as SourceOrigin;
  const jobId = uuidv4();
  const jobDir = jobStore.getJobDir(jobId);
  const uploadsDir = path.join(jobDir, "uploads");
  await ensureDir(uploadsDir);

  const extension =
    path.extname(originalName) || `.${mime.extension(uploadedFile.mimetype) || "bin"}`;
  const storedPath = path.join(uploadsDir, `source${extension}`);
  await fs.rename(uploadedFile.path, storedPath);

  const now = new Date().toISOString();
  const job: JobManifest = {
    id: jobId,
    status: "queued",
    stage: "Queued for processing",
    createdAt: now,
    updatedAt: now,
    sourceOrigin,
    sourceMedia: {
      originalName,
      mimeType: uploadedFile.mimetype,
      sizeBytes: uploadedFile.size,
      storedPath
    },
    warnings: [],
    logs: ["Upload stored. Waiting for worker start."],
    progress: buildDefaultProgress(now),
    processing: buildDefaultProcessing(),
    artifacts: {
      source: [],
      english: []
    }
  };

  await jobStore.save(job);
  jobQueue.enqueue(() => processBaseJob(jobId));

  res.status(202).json({ jobId });
});

app.get("/api/jobs", async (req, res) => {
  const statusFilter = req.query.status as string;
  let allJobs = jobStore.getAll().map(makeJobResponse);

  if (statusFilter) {
    allJobs = allJobs.filter(j => j.status === statusFilter);
  }

  allJobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json(allJobs);
});

app.get("/api/jobs/:jobId", async (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) {
    res.status(404).send("Job not found.");
    return;
  }

  res.json(makeJobResponse(job));
});

app.delete("/api/jobs/:jobId", async (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) {
    res.status(404).send("Job not found.");
    return;
  }
  await jobStore.delete(req.params.jobId);
  res.status(204).send();
});

app.post("/api/jobs/:jobId/enhancements", async (req, res) => {
  const jobId = req.params.jobId;
  const job = jobStore.get(jobId);

  if (!job) {
    res.status(404).send("Job not found.");
    return;
  }

  if (job.enhancementStatus !== "awaiting_selection") {
    res.status(400).send("Job is not awaiting enhancement selection.");
    return;
  }

  const body = req.body as Partial<EnhancementConfig>;
  const validStages: EnhancementStageKey[] = ["translate", "diarize", "summarize"];
  const stages = (body.stages ?? []).filter(
    (s): s is EnhancementStageKey => validStages.includes(s as EnhancementStageKey)
  );

  const enhancementConfig: EnhancementConfig = {
    stages,
    summaryPreset: body.summaryPreset,
    translationLanguage: body.translationLanguage ?? "en"
  };

  await updateJobImmediate(jobId, (current) => {
    current.enhancementConfig = enhancementConfig;
  });

  if (stages.length === 0) {
    await updateJobImmediate(jobId, (current) => {
      current.status = "completed";
      current.stage = "Processing complete";
      current.enhancementStatus = "skipped";
      appendLog(current, "Enhancements skipped by user.");
    });
    res.json(makeJobResponse(jobStore.get(jobId)!));
    return;
  }

  jobQueue.enqueue(() => processEnhancements(jobId));
  res.json(makeJobResponse(jobStore.get(jobId)!));
});

app.get("/api/jobs/:jobId/audio", async (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job || !job.normalizedAudioPath) {
    res.status(404).send("Audio not found or job not ready.");
    return;
  }

  try {
    const stat = await fs.stat(job.normalizedAudioPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        res.status(416).send("Requested range not satisfiable");
        return;
      }

      const chunksize = end - start + 1;
      const file = createReadStream(job.normalizedAudioPath, { start, end });
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": "audio/wav",
      });
      file.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": "audio/wav",
        "Accept-Ranges": "bytes",
      });
      createReadStream(job.normalizedAudioPath).pipe(res);
    }
  } catch (err) {
    res.status(500).send("Error reading audio file.");
  }
});

// --- SSE endpoint for real-time job updates ---
app.get("/api/jobs/:jobId/events", (req, res) => {
  const jobId = req.params.jobId;
  const job = jobStore.get(jobId);
  if (!job) {
    res.status(404).send("Job not found.");
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  // Send current state immediately
  res.write(`data: ${JSON.stringify(makeJobResponse(job))}\n\n`);

  // Push updates as they happen
  const listener = (updatedJob: JobManifest) => {
    res.write(`data: ${JSON.stringify(makeJobResponse(updatedJob))}\n\n`);
  };
  jobStore.addListener(jobId, listener);

  // Clean up when client disconnects
  req.on("close", () => {
    jobStore.removeListener(jobId, listener);
  });
});

app.get("/api/jobs/:jobId/transcript", async (req, res) => {
  const jobId = req.params.jobId;
  const job = jobStore.get(jobId);
  if (!job?.transcriptPath && !job?.transcriptReady) {
    res.status(404).send("Transcript not ready.");
    return;
  }

  if (!job.transcriptPath) {
    res.status(404).send("Transcript not ready.");
    return;
  }

  const cached = jobStore.getTranscript(jobId);
  if (cached) {
    res.json(cached);
    return;
  }

  const transcript = await readJsonFile<TranscriptRecord>(job.transcriptPath);
  jobStore.setTranscript(jobId, transcript);
  res.json(transcript);
});

app.get("/api/jobs/:jobId/summary", async (req, res) => {
  const jobId = req.params.jobId;
  const job = jobStore.get(jobId);

  if (!job) {
    res.status(404).send("Job not found.");
    return;
  }

  if (!job.summaryPath) {
    // Check if job finished successfully but summary was skipped/failed
    if (job.status === "completed") {
      res.status(404).send("No summary generated for this job.");
      return;
    }
    res.status(404).send("Summary not ready.");
    return;
  }

  // Check in-memory cache first (attached to transcript record)
  const cached = jobStore.getTranscript(jobId);
  if (cached?.summary) {
    res.json(cached.summary);
    return;
  }

  // Fall back to disk
  try {
    const summary = await readJsonFile(job.summaryPath);
    res.json(summary);
  } catch (err) {
    res.status(500).send("Failed to read summary data.");
  }
});

// --- Retry endpoints (use cached transcript, skip re-transcription) ---

app.post("/api/jobs/:jobId/retry/summarize", async (req, res) => {
  const jobId = req.params.jobId;
  const job = jobStore.get(jobId);

  if (!job || job.status !== "completed") {
    res.status(400).send("Job must be completed before retrying summarization.");
    return;
  }

  if (!job.transcriptPath) {
    res.status(400).send("No cached transcript available.");
    return;
  }

  try {
    await startPostCompletionAction(jobId, {
      stageKey: "summarize",
      stageLabel: "Regenerating AI summary"
    });
    jobQueue.enqueue(() => processSummaryRetry(jobId));
    res.status(202).json(makeJobResponse(jobStore.get(jobId)!));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Retry failed.";
    res.status(message.includes("already running") ? 409 : 500).send(message);
  }
});

app.post("/api/jobs/:jobId/retry/diarize", async (req, res) => {
  const jobId = req.params.jobId;
  const job = jobStore.get(jobId);

  if (!job || job.status !== "completed") {
    res.status(400).send("Job must be completed before retrying diarization.");
    return;
  }

  if (!job.transcriptPath || !job.normalizedAudioPath) {
    res.status(400).send("No cached transcript or audio available.");
    return;
  }

  try {
    await startPostCompletionAction(jobId, {
      stageKey: "diarize",
      stageLabel: "Re-running speaker identification",
      exportLabel: "Writing enhanced artifacts"
    });
    jobQueue.enqueue(() => processDiarizationRetry(jobId));
    res.status(202).json(makeJobResponse(jobStore.get(jobId)!));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Retry failed.";
    res.status(message.includes("already running") ? 409 : 500).send(message);
  }
});

app.post("/api/jobs/:jobId/retry/translate", async (req, res) => {
  const jobId = req.params.jobId;
  const job = jobStore.get(jobId);

  if (!job || job.status !== "completed") {
    res.status(400).send("Job must be completed before retrying translation.");
    return;
  }

  if (!job.transcriptPath || !job.normalizedAudioPath) {
    res.status(400).send("No cached transcript or audio available.");
    return;
  }

  try {
    await startPostCompletionAction(jobId, {
      stageKey: "translate",
      stageLabel: "Generating English translation",
      exportLabel: "Writing enhanced artifacts"
    });
    jobQueue.enqueue(() => processTranslationRetry(jobId));
    res.status(202).json(makeJobResponse(jobStore.get(jobId)!));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Retry failed.";
    res.status(message.includes("already running") ? 409 : 500).send(message);
  }
});

app.get("/api/jobs/:jobId/export", async (req, res) => {
  const format = String(req.query.format ?? "");
  const variant = String(req.query.variant ?? "");
  const job = jobStore.get(req.params.jobId);

  if (!job) {
    res.status(404).send("Job not found.");
    return;
  }

  if (!["txt", "srt", "json"].includes(format)) {
    res.status(400).send("Unsupported export format.");
    return;
  }

  if (!["source", "english"].includes(variant)) {
    res.status(400).send("Unsupported transcript variant.");
    return;
  }

  const artifactList = variant === "source" ? job.artifacts.source : job.artifacts.english;
  const artifactPath = artifactList.find((candidate) => candidate.endsWith(`transcript.${format}`));

  if (!artifactPath) {
    res.status(404).send("Requested artifact is not available.");
    return;
  }

  res.download(artifactPath);
});

async function main(): Promise<void> {
  await jobStore.init();
  await ensureDir(path.join(config.storageRoot, ".tmp"));

  app.listen(config.port, () => {
    console.log(`Notadio backend listening on http://localhost:${config.port}`);
  });

  // Flush pending writes on graceful shutdown
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      await jobStore.flushAll();
      process.exit(0);
    });
  }
}

void main();
