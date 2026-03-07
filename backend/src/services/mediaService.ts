import path from "node:path";
import { config } from "../config.js";
import { ensureDir } from "../utils/fs.js";
import { runCommand } from "../utils/process.js";

export async function normalizeMediaToWav(inputPath: string, outputDir: string): Promise<string> {
  await ensureDir(outputDir);
  const outputPath = path.join(outputDir, "normalized.wav");

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
  ]);

  return outputPath;
}
