import fs from "node:fs/promises";
import path from "node:path";
import express, { type RequestHandler } from "express";
import cors from "cors";
import multer from "multer";
import mime from "mime-types";
import { v4 as uuidv4 } from "uuid";
import { config } from "./config.js";
import { JobManifest, TranscriptRecord } from "./types.js";
import { jobStore } from "./store/jobStore.js";
import { ensureDir, readJsonFile, writeJsonFile } from "./utils/fs.js";
import { normalizeMediaToWav } from "./services/mediaService.js";
import { transcribeAudio } from "./services/transcriptionService.js";
import { applyOptionalDiarization } from "./services/diarizationService.js";
import { writeArtifacts } from "./services/exportService.js";

const app = express();
const upload = multer({ dest: path.join(config.storageRoot, ".tmp") });
const uploadSingle = upload.single("media") as unknown as RequestHandler;

app.use(cors({ origin: config.webOrigin }));
app.use(express.json());

function makeJobResponse(job: JobManifest) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    sourceMedia: job.sourceMedia
      ? {
          originalName: job.sourceMedia.originalName,
          mimeType: job.sourceMedia.mimeType,
          sizeBytes: job.sourceMedia.sizeBytes
        }
      : undefined,
    detectedLanguage: job.detectedLanguage,
    durationSeconds: job.durationSeconds,
    warnings: job.warnings,
    error: job.error,
    artifacts: job.artifacts
  };
}

async function updateJob(jobId: string, updater: (job: JobManifest) => JobManifest): Promise<JobManifest> {
  const current = jobStore.get(jobId);
  if (!current) {
    throw new Error(`Job ${jobId} not found`);
  }

  const next = updater({
    ...current,
    warnings: [...current.warnings],
    artifacts: {
      source: [...current.artifacts.source],
      english: [...current.artifacts.english]
    }
  });

  next.updatedAt = new Date().toISOString();
  await jobStore.save(next);
  return next;
}

async function processJob(jobId: string): Promise<void> {
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

    await updateJob(jobId, (current) => ({
      ...current,
      status: "processing",
      stage: "Normalizing media for transcription"
    }));

    const normalizedAudioPath = await normalizeMediaToWav(job.sourceMedia.storedPath, workingDir);
    await updateJob(jobId, (current) => ({
      ...current,
      normalizedAudioPath,
      stage: "Running local Whisper transcription"
    }));

    const transcriptVariants = await transcribeAudio(normalizedAudioPath, path.join(workingDir, "whisper"));
    const diarization = await applyOptionalDiarization(
      normalizedAudioPath,
      path.join(workingDir, "diarization"),
      transcriptVariants.source.segments
    );

    const warnings = [...job.warnings, ...transcriptVariants.warnings, ...diarization.warnings];
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
      durationSeconds: source.segments.at(-1)?.end,
      detectedLanguage: source.language,
      warnings,
      source,
      english: transcriptVariants.english
    };

    const transcriptPath = path.join(jobDir, "transcript.json");
    await writeJsonFile(transcriptPath, transcriptRecord);
    const artifacts = await writeArtifacts(transcriptRecord, artifactDir);

    await updateJob(jobId, (current) => ({
      ...current,
      status: "completed",
      stage: "Transcript ready",
      transcriptPath,
      detectedLanguage: transcriptRecord.detectedLanguage,
      durationSeconds: transcriptRecord.durationSeconds,
      warnings,
      artifacts
    }));
  } catch (error) {
    await updateJob(jobId, (current) => ({
      ...current,
      status: "failed",
      stage: "Processing failed",
      error: error instanceof Error ? error.message : "Unknown processing error"
    }));
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
