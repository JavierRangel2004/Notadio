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
import { jobStore } from "./store/jobStore.js";
import { ensureDir, readJsonFile, writeJsonFile } from "./utils/fs.js";
import { JobManifest, JobProcessingProfile, JobProgress, TranscriptRecord } from "./types.js";

const app = express();
const upload = multer({ dest: path.join(config.storageRoot, ".tmp") });
const uploadSingle = upload.single("media") as unknown as RequestHandler;

type PipelineStageKey = "queued" | "normalize" | "transcribe" | "translate" | "diarize" | "export";

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

async function updateJob(jobId: string, updater: (job: JobManifest) => JobManifest): Promise<JobManifest> {
  const current = jobStore.get(jobId);
  if (!current) {
    throw new Error(`Job ${jobId} not found`);
  }

  const next = updater(cloneJob(current));
  next.updatedAt = new Date().toISOString();
  await jobStore.save(next);
  return next;
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

function appendLog(job: JobManifest, line: string): void {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  job.logs = [...(job.logs ?? []), trimmed].slice(-config.jobLogLimit);
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

async function applyTelemetryUpdate(
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
): Promise<void> {
  await updateJob(jobId, (job) => {
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

    return job;
  });
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

    await applyTelemetryUpdate(jobId, telemetry, {
      status: "processing",
      stage: "Normalizing media for transcription",
      stageKey: "queued",
      stagePct: 100,
      processing: processingProfile,
      logLine: `Detected processing profile: ${processingProfile.profile} (${processingProfile.deviceSummary})`
    });

    await applyTelemetryUpdate(jobId, telemetry, {
      status: "processing",
      stage: "Normalizing media for transcription",
      stageKey: "normalize",
      stagePct: 0
    });

    const normalization = await normalizeMediaToWav(job.sourceMedia.storedPath, workingDir, {
      onLog: (line) => void applyTelemetryUpdate(jobId, telemetry, { stageKey: "normalize", logLine: line }),
      onProgress: (stagePct) =>
        void applyTelemetryUpdate(jobId, telemetry, {
          stage: "Normalizing media for transcription",
          stageKey: "normalize",
          stagePct
        })
    });

    await updateJob(jobId, (current) => {
      current.normalizedAudioPath = normalization.outputPath;
      current.durationSeconds = normalization.durationSeconds;
      return current;
    });

    await applyTelemetryUpdate(jobId, telemetry, {
      stage: "Running local Whisper transcription",
      stageKey: "transcribe",
      stagePct: 0,
      logLine: `Whisper thread recommendation: ${processingProfile.threads}`
    });

    const transcriptVariants = await transcribeAudio(normalization.outputPath, path.join(workingDir, "whisper"), {
      durationSeconds: normalization.durationSeconds,
      processingProfile,
      onSourceLog: (line: string) =>
        void applyTelemetryUpdate(jobId, telemetry, {
          stage: "Running local Whisper transcription",
          stageKey: "transcribe",
          logLine: line
        }),
      onSourceProgress: (stagePct: number) =>
        void applyTelemetryUpdate(jobId, telemetry, {
          stage: "Running local Whisper transcription",
          stageKey: "transcribe",
          stagePct
        }),
      onTranslationLog: (line: string) =>
        void applyTelemetryUpdate(jobId, telemetry, {
          stage: "Generating English translation",
          stageKey: "translate",
          logLine: line
        }),
      onTranslationProgress: (stagePct: number) =>
        void applyTelemetryUpdate(jobId, telemetry, {
          stage: "Generating English translation",
          stageKey: "translate",
          stagePct
        })
    });

    await applyTelemetryUpdate(jobId, telemetry, {
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
          void applyTelemetryUpdate(jobId, telemetry, {
            stage: "Applying speaker diarization",
            stageKey: "diarize",
            logLine: line
          }),
        onProgress: (stagePct) =>
          void applyTelemetryUpdate(jobId, telemetry, {
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

    const transcriptPath = path.join(jobDir, "transcript.json");
    await writeJsonFile(transcriptPath, transcriptRecord);

    await applyTelemetryUpdate(jobId, telemetry, {
      stage: "Writing transcript artifacts",
      stageKey: "export",
      stagePct: 20
    });

    const artifacts = await writeArtifacts(transcriptRecord, artifactDir);

    await updateJob(jobId, (current) => {
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
      return current;
    });
  } catch (error) {
    await updateJob(jobId, (current) => {
      current.status = "failed";
      current.stage = "Processing failed";
      current.error = error instanceof Error ? error.message : "Unknown processing error";
      appendLog(current, current.error);
      return current;
    });
  }
}

app.post("/api/uploads", uploadSingle, async (req, res) => {
  const uploadedFile = req.file;

  if (!uploadedFile) {
    res.status(400).send("Expected a media file in the `media` field.");
    return;
  }

  const jobId = uuidv4();
  const jobDir = jobStore.getJobDir(jobId);
  const uploadsDir = path.join(jobDir, "uploads");
  await ensureDir(uploadsDir);

  const extension =
    path.extname(uploadedFile.originalname) || `.${mime.extension(uploadedFile.mimetype) || "bin"}`;
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
      originalName: uploadedFile.originalname,
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
  void processJob(jobId);

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

app.get("/api/jobs/:jobId/transcript", async (req, res) => {
  const job = jobStore.get(req.params.jobId);
  if (!job?.transcriptPath) {
    res.status(404).send("Transcript not ready.");
    return;
  }

  const transcript = await readJsonFile<TranscriptRecord>(job.transcriptPath);
  res.json(transcript);
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
}

void main();
