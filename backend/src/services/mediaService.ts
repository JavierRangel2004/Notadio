import path from "node:path";
import { config } from "../config.js";
import { ensureDir } from "../utils/fs.js";
import { runCommand } from "../utils/process.js";

type NormalizationCallbacks = {
  onLog?: (line: string) => void;
  onProgress?: (stagePct: number) => void;
};

function timestampToSeconds(rawValue: string): number {
  const [hours, minutes, seconds] = rawValue.split(":");
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export async function normalizeMediaToWav(
  inputPath: string,
  outputDir: string,
  callbacks: NormalizationCallbacks = {}
): Promise<{ outputPath: string; durationSeconds?: number }> {
  await ensureDir(outputDir);
  const outputPath = path.join(outputDir, "normalized.wav");
  let totalDurationSeconds: number | undefined;

  await runCommand(config.ffmpegPath, [
    "-y",
    "-i",
    inputPath,
    "-ar",
    "16000",
    "-ac",
    "1",
    "-c:a",
    "pcm_s16le",
    outputPath
  ], {
    onStderrLine: (line) => {
      callbacks.onLog?.(line);

      const durationMatch = line.match(/Duration:\s*(\d+:\d+:\d+(?:\.\d+)?)/i);
      if (durationMatch) {
        totalDurationSeconds = timestampToSeconds(durationMatch[1]);
      }

      const timeMatch = line.match(/time=(\d+:\d+:\d+(?:\.\d+)?)/i);
      if (timeMatch && totalDurationSeconds && totalDurationSeconds > 0) {
        const stagePct = Math.min(99, (timestampToSeconds(timeMatch[1]) / totalDurationSeconds) * 100);
        callbacks.onProgress?.(stagePct);
      }
    }
  });

  callbacks.onProgress?.(100);
  return { outputPath, durationSeconds: totalDurationSeconds };
}
