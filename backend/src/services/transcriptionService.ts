import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { TranscriptSegment, TranscriptVariant } from "../types.js";
import { ensureDir, readJsonFile } from "../utils/fs.js";
import { parseArgs, runCommand } from "../utils/process.js";

type WhisperOutput = {
  language?: string;
  result?: { language?: string };
  transcript?: { language?: string; segments?: unknown[] };
  segments?: unknown[];
};

function toNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function normalizeSegments(rawSegments: unknown[]): TranscriptSegment[] {
  return rawSegments
    .map((segment) => {
      if (!segment || typeof segment !== "object") {
        return undefined;
      }

      const candidate = segment as Record<string, unknown>;
      const text = String(candidate.text ?? candidate.text_utf8 ?? "").trim();
      if (!text) {
        return undefined;
      }

      return {
        start: toNumber(candidate.start),
        end: toNumber(candidate.end),
        text
      } satisfies TranscriptSegment;
    })
    .filter((segment): segment is TranscriptSegment => Boolean(segment));
}

function extractLanguage(payload: WhisperOutput): string {
  return payload.language ?? payload.result?.language ?? payload.transcript?.language ?? "unknown";
}

function extractSegments(payload: WhisperOutput): TranscriptSegment[] {
  if (Array.isArray(payload.segments)) {
    return normalizeSegments(payload.segments);
  }

  if (Array.isArray(payload.transcript?.segments)) {
    return normalizeSegments(payload.transcript.segments);
  }

  return [];
}

async function runWhisperTask(
  inputPath: string,
  outputBase: string,
  mode: "transcribe" | "translate"
): Promise<TranscriptVariant> {
  if (!config.whisperModelPath) {
    throw new Error("WHISPER_MODEL_PATH is not configured.");
  }

  await ensureDir(path.dirname(outputBase));

  const args = parseArgs(mode === "translate" ? config.whisperTranslateArgs : config.whisperArgs, {
    input: inputPath,
    model: config.whisperModelPath,
    outputBase
  });

  await runCommand(config.whisperCommand, args);

  const jsonPath = `${outputBase}.json`;
  const payload = await readJsonFile<WhisperOutput>(jsonPath);
  const segments = extractSegments(payload);

  return {
    language: extractLanguage(payload),
    text: segments.map((segment) => segment.text).join(" ").trim(),
    segments
  };
}

export async function transcribeAudio(inputPath: string, workDir: string): Promise<{
  source: TranscriptVariant;
  english?: TranscriptVariant;
  warnings: string[];
}> {
  await ensureDir(workDir);
  const warnings: string[] = [];
  const source = await runWhisperTask(inputPath, path.join(workDir, "source"), "transcribe");

  let english: TranscriptVariant | undefined;
  try {
    english = await runWhisperTask(inputPath, path.join(workDir, "english"), "translate");
  } catch (error) {
    const message =
      error instanceof Error
        ? `English translation export was skipped: ${error.message}`
        : "English translation export was skipped.";
    warnings.push(message);
    await fs.writeFile(path.join(workDir, "english.error.txt"), message, "utf-8");
  }

  return { source, english, warnings };
}
