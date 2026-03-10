import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { TranscriptSegment } from "../types.js";
import { ensureDir, readJsonFile } from "../utils/fs.js";
import { parseArgs, runCommand } from "../utils/process.js";

type SpeakerSlice = {
  start: number;
  end: number;
  speaker: string;
};

function estimateDiarizationStagePct(elapsedSeconds: number, durationSeconds: number | undefined): number {
  const expectedRuntime = durationSeconds ? Math.max(45, durationSeconds * 0.15) : 120;
  return Math.min(95, (elapsedSeconds / expectedRuntime) * 100);
}

function pickSpeaker(segment: TranscriptSegment, speakers: SpeakerSlice[]): string | undefined {
  let bestSpeaker: string | undefined;
  let bestOverlap = 0;

  for (const speakerSlice of speakers) {
    const overlap = Math.min(segment.end, speakerSlice.end) - Math.max(segment.start, speakerSlice.start);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      bestSpeaker = speakerSlice.speaker;
    }
  }

  return bestSpeaker;
}

export async function applyOptionalDiarization(
  audioPath: string,
  workDir: string,
  segments: TranscriptSegment[],
  callbacks: {
    durationSeconds?: number;
    onLog?: (line: string) => void;
    onProgress?: (stagePct: number) => void;
  } = {}
): Promise<{ warnings: string[]; segments: TranscriptSegment[] }> {
  if (!config.diarizationCommand) {
    return {
      warnings: ["Speaker labels were skipped because no diarization command is configured."],
      segments
    };
  }

  await ensureDir(workDir);
  const outputFile = path.join(workDir, "diarization.json");
  const args = parseArgs(config.diarizationArgs, {
    input: audioPath,
    outputFile,
    projectRoot: config.projectRoot
  });

  try {
    const startedAt = Date.now();
    let lastProgress = 0;
    const heartbeat = setInterval(() => {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      const progress = estimateDiarizationStagePct(elapsedSeconds, callbacks.durationSeconds);
      if (progress > lastProgress) {
        lastProgress = progress;
        callbacks.onProgress?.(progress);
      }
    }, 2000);

    try {
      await runCommand(config.diarizationCommand, args, {
        cwd: config.projectRoot,
        onStdoutLine: (line) => callbacks.onLog?.(line),
        onStderrLine: (line) => callbacks.onLog?.(line)
      });
    } finally {
      clearInterval(heartbeat);
    }

    const payload = await readJsonFile<{ segments?: SpeakerSlice[] } | SpeakerSlice[]>(outputFile);
    const speakerSlices = Array.isArray(payload) ? payload : payload.segments ?? [];
    callbacks.onLog?.(`Diarization complete. Found ${speakerSlices.length} segments.`);
    callbacks.onProgress?.(100);

    return {
      warnings: [],
      segments: segments.map((segment) => ({
        ...segment,
        speaker: pickSpeaker(segment, speakerSlices)
      }))
    };
  } catch (error) {
    await fs.rm(outputFile, { force: true }).catch(() => undefined);
    return {
      warnings: [
        error instanceof Error
          ? `Speaker labels were skipped because diarization failed: ${error.message}`
          : "Speaker labels were skipped because diarization failed."
      ],
      segments
    };
  }
}
