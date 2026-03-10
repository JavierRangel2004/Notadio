import fs from "node:fs/promises";
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
import { transcribeAudio } from "./services/transcriptionService.js";
import { generateSummary } from "./services/summaryService.js";
import { jobStore } from "./store/jobStore.js";
import { ensureDir, readJsonFile, writeJsonFile } from "./utils/fs.js";
import { JobManifest, JobProcessingProfile, JobProgress, TranscriptRecord } from "./types.js";
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

function cloneJob(job: JobManifest): JobManifest {
  return {
    ...job,
    warnings: [...job.warnings],
    logs: [...(job.logs ?? [])],
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

function buildTelemetryContext(processing: JobProcessingProfile): TelemetryContext {
  const stages: StageDefinition[] = [
    { key: "normalize", weight: 15 },
    { key: "transcribe", weight: 55 }
  ];

  if (processing.translationEnabled) {
    stages.push({ key: "translate", weight: 17 });
  }

  if (config.diarizationCommand) {
    stages.push({ key: "diarize", weight: 5 });
  }

  if (config.enableSummary) {
    stages.push({ key: "summarize", weight: 8 });
  }

  stages.push({ key: "export", weight: 3 });
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

async function processJob(jobId: string): Promise<void> {
  const processingProfile = detectProcessingProfile();
  const telemetry = buildTelemetryContext(processingProfile);

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

    applyTelemetryUpdate(jobId, telemetry, {
      stage: "Running local Whisper transcription",
      stageKey: "transcribe",
      stagePct: 0,
      logLine: `Whisper thread recommendation: ${processingProfile.threads}`
    });

    const transcriptVariants = await transcribeAudio(normalization.outputPath, path.join(workingDir, "whisper"), {
      durationSeconds: normalization.durationSeconds,
      processingProfile,
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
        }),
      onTranslationLog: (line: string) =>
        applyTelemetryUpdate(jobId, telemetry, {
          stage: "Generating English translation",
          stageKey: "translate",
          logLine: line
        }),
      onTranslationProgress: (stagePct: number) =>
        applyTelemetryUpdate(jobId, telemetry, {
          stage: "Generating English translation",
          stageKey: "translate",
          stagePct
        })
    });

    applyTelemetryUpdate(jobId, telemetry, {
      stage: config.diarizationCommand ? "Applying speaker diarization" : "Writing transcript artifacts",
      stageKey: config.diarizationCommand ? "diarize" : "export",
      stagePct: 0,
      processing: transcriptVariants.processing
    });

    const diarization = await applyOptionalDiarization(
      normalization.outputPath,
      path.join(workingDir, "diarization"),
      transcriptVariants.source.segments,
      {
        onLog: (line) =>
          applyTelemetryUpdate(jobId, telemetry, {
            stage: "Applying speaker diarization",
            stageKey: "diarize",
            logLine: line
          }),
        onProgress: (stagePct) =>
          applyTelemetryUpdate(jobId, telemetry, {
            stage: "Applying speaker diarization",
            stageKey: "diarize",
            stagePct
          })
      }
    );

    const latestJob = jobStore.get(jobId);
    const warnings = [
      ...(latestJob?.warnings ?? []),
      ...transcriptVariants.warnings,
      ...diarization.warnings
    ];
    if (transcriptVariants.source.segments.length === 0) {
      throw new Error("Transcription completed without parsed source segments.");
    }

    const source = {
      ...transcriptVariants.source,
      segments: diarization.segments
    };

    const transcriptRecord: TranscriptRecord = {
      jobId,
      sourceMedia: {
        originalName: job.sourceMedia.originalName,
        mimeType: job.sourceMedia.mimeType,
        sizeBytes: job.sourceMedia.sizeBytes
      },
      durationSeconds: source.segments.at(-1)?.end ?? normalization.durationSeconds,
      detectedLanguage: source.language,
      warnings,
      source,
      english: transcriptVariants.english
    };

    if (!transcriptRecord.source.text.trim() || transcriptRecord.source.segments.length === 0) {
      throw new Error("Transcript was generated but contains no source transcript content.");
    }

    applyTelemetryUpdate(jobId, telemetry, {
      stage: config.enableSummary ? "Generating AI meeting summary" : "Writing transcript artifacts",
      stageKey: config.enableSummary ? "summarize" : "export",
      stagePct: 0
    });

    const summaryResult = await generateSummary(transcriptRecord, {
      onLog: (line) => applyTelemetryUpdate(jobId, telemetry, { stageKey: "summarize", logLine: line }),
      onProgress: (stagePct) => applyTelemetryUpdate(jobId, telemetry, {
        stage: "Generating AI meeting summary",
        stageKey: "summarize",
        stagePct
      })
    });

    if (summaryResult.summary) {
      transcriptRecord.summary = summaryResult.summary;
      const summaryPath = path.join(jobDir, "summary.json");
      await writeJsonFile(summaryPath, transcriptRecord.summary);
      await updateJobImmediate(jobId, (current) => {
        current.summaryPath = summaryPath;
      });
    }

    warnings.push(...summaryResult.warnings);

    const transcriptPath = path.join(jobDir, "transcript.json");
    await writeJsonFile(transcriptPath, transcriptRecord);

    // Cache transcript in memory for instant reads
    jobStore.setTranscript(jobId, transcriptRecord);

    applyTelemetryUpdate(jobId, telemetry, {
      stage: "Writing transcript artifacts",
      stageKey: "export",
      stagePct: 20
    });

    const artifacts = await writeArtifacts(transcriptRecord, artifactDir);

    await updateJobImmediate(jobId, (current) => {
      current.status = "completed";
      current.stage = "Transcript ready";
      current.transcriptPath = transcriptPath;
      current.detectedLanguage = transcriptRecord.detectedLanguage;
      current.durationSeconds = transcriptRecord.durationSeconds;
      current.warnings = warnings;
      current.artifacts = artifacts;
      appendLog(current, "Transcript artifacts written successfully.");
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
      current.status = "failed";
      current.stage = "Processing failed";
      current.error = error instanceof Error ? error.message : "Unknown processing error";
      appendLog(current, current.error);
    });
  }
}

app.post("/api/uploads", uploadSingle, async (req, res) => {
  const uploadedFile = req.file;

  if (!uploadedFile) {
    res.status(400).send("Expected a media file in the `media` field.");
    return;
  }

  const originalName = normalizeUploadFilename(uploadedFile.originalname);
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
  jobQueue.enqueue(() => processJob(jobId));

  res.status(202).json({ jobId });
});

app.get("/api/jobs/:jobId", async (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) {
    res.status(404).send("Job not found.");
    return;
  }

  res.json(makeJobResponse(job));
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
  if (!job?.transcriptPath) {
    res.status(404).send("Transcript not ready.");
    return;
  }

  // Check in-memory cache first
  const cached = jobStore.getTranscript(jobId);
  if (cached) {
    res.json(cached);
    return;
  }

  // Fall back to disk, then cache
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
    const transcriptRecord = await readJsonFile<TranscriptRecord>(job.transcriptPath);
    const jobDir = jobStore.getJobDir(jobId);

    const summaryResult = await generateSummary(transcriptRecord);

    if (summaryResult.summary) {
      transcriptRecord.summary = summaryResult.summary;
      const summaryPath = path.join(jobDir, "summary.json");
      await writeJsonFile(summaryPath, summaryResult.summary);
      await writeJsonFile(job.transcriptPath, transcriptRecord);
      jobStore.setTranscript(jobId, transcriptRecord);

      await updateJobImmediate(jobId, (current) => {
        current.summaryPath = summaryPath;
        // Remove the old summary warning if present
        current.warnings = current.warnings.filter(w => !w.startsWith("AI summary skipped"));
        current.warnings.push(...summaryResult.warnings);
      });

      res.json(summaryResult.summary);
    } else {
      res.status(500).json({ error: summaryResult.warnings.join("; ") || "Summary generation failed." });
    }
  } catch (error) {
    res.status(500).send(error instanceof Error ? error.message : "Retry failed.");
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
    const transcriptRecord = await readJsonFile<TranscriptRecord>(job.transcriptPath);
    const jobDir = jobStore.getJobDir(jobId);
    const workingDir = path.join(jobDir, "working");

    // Strip old speaker labels before re-diarizing
    const rawSegments = transcriptRecord.source.segments.map(s => ({ ...s, speaker: undefined }));

    const diarization = await applyOptionalDiarization(
      job.normalizedAudioPath,
      path.join(workingDir, "diarization"),
      rawSegments
    );

    transcriptRecord.source.segments = diarization.segments;
    await writeJsonFile(job.transcriptPath, transcriptRecord);
    jobStore.setTranscript(jobId, transcriptRecord);

    await updateJobImmediate(jobId, (current) => {
      // Remove old diarization warnings
      current.warnings = current.warnings.filter(w => !w.includes("diarization"));
      current.warnings.push(...diarization.warnings);
    });

    res.json({ warnings: diarization.warnings, segmentCount: diarization.segments.length });
  } catch (error) {
    res.status(500).send(error instanceof Error ? error.message : "Retry failed.");
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
