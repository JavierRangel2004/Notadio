import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { detectProcessingProfile } from "./deviceProfileService.js";
import { JobProcessingProfile, TranscriptSegment, TranscriptVariant } from "../types.js";
import { ensureDir, readJsonFile } from "../utils/fs.js";
import { parseArgs, runCommand } from "../utils/process.js";

type TranscribeResult = {
  source: TranscriptVariant;
  english?: TranscriptVariant;
  warnings: string[];
  processing: JobProcessingProfile;
};

type WhisperTranscriptionEntry = {
  text?: unknown;
  start?: unknown;
  end?: unknown;
  offsets?: {
    from?: unknown;
    to?: unknown;
  };
};

type WhisperOutput = {
  language?: string;
  result?: { language?: string };
  transcript?: { language?: string; segments?: unknown[] };
  segments?: unknown[];
  transcription?: WhisperTranscriptionEntry[];
};

type WhisperCallbacks = {
  onLog?: (line: string) => void;
  onProgress?: (stagePct: number) => void;
};

type WhisperTaskOptions = {
  durationSeconds?: number;
  processingProfile: JobProcessingProfile;
  allowEmpty?: boolean;
} & WhisperCallbacks;

const WHISPER_SEGMENT_LOG_PATTERN = /^\[\d{2}:\d{2}(?::\d{2})?\.\d+\s+-->\s+\d{2}:\d{2}(?::\d{2})?\.\d+\]/;

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

function normalizeTranscriptionEntries(entries: WhisperTranscriptionEntry[]): TranscriptSegment[] {
  return entries
    .map((entry) => {
      const text = String(entry.text ?? "").trim();
      if (!text) {
        return undefined;
      }

      const start = entry.offsets?.from !== undefined ? toNumber(entry.offsets.from) / 1000 : toNumber(entry.start);
      const end = entry.offsets?.to !== undefined ? toNumber(entry.offsets.to) / 1000 : toNumber(entry.end);

      return {
        start,
        end,
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

  if (Array.isArray(payload.transcription)) {
    return normalizeTranscriptionEntries(payload.transcription);
  }

  return [];
}

export function parseWhisperOutput(payload: WhisperOutput, allowEmpty = false): TranscriptVariant {
  const segments = extractSegments(payload);
  if (segments.length === 0 && !allowEmpty) {
    throw new Error("Whisper output was generated but could not be parsed into transcript segments.");
  }

  return {
    language: extractLanguage(payload),
    text: segments.map((segment) => segment.text).join(" ").trim(),
    segments
  };
}

function hasThreadArg(args: string[]): boolean {
  return args.some((arg) => arg === "-t" || arg === "--threads" || arg.startsWith("--threads="));
}

function withPerformanceArgs(args: string[], profile: JobProcessingProfile): string[] {
  if (hasThreadArg(args)) {
    return args;
  }

  return [...args, "-t", String(profile.threads)];
}

function estimateWhisperStagePct(
  elapsedSeconds: number,
  durationSeconds: number | undefined,
  mode: "transcribe" | "translate"
): number {
  const fallbackRuntime = mode === "translate" ? 45 : 75;
  const expectedRuntime = durationSeconds
    ? Math.max(20, durationSeconds * (mode === "translate" ? 0.35 : 0.6))
    : fallbackRuntime;
  return Math.min(96, (elapsedSeconds / expectedRuntime) * 100);
}

function parseProgressLine(line: string): number | undefined {
  const match =
    line.match(/(?:progress|decode|encoded|transcrib\w*)[^0-9]*(\d{1,3}(?:\.\d+)?)%/i) ??
    line.match(/\b(\d{1,3}(?:\.\d+)?)%/);
  if (!match) {
    return undefined;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : undefined;
}

function shouldSurfaceWhisperLogLine(line: string): boolean {
  return !WHISPER_SEGMENT_LOG_PATTERN.test(line.trim());
}

async function runWhisperTask(
  inputPath: string,
  outputBase: string,
  mode: "transcribe" | "translate",
  options: WhisperTaskOptions
): Promise<TranscriptVariant> {
  if (!config.whisperModelPath) {
    throw new Error("WHISPER_MODEL_PATH is not configured.");
  }

  await ensureDir(path.dirname(outputBase));

  const template = mode === "translate" ? config.whisperTranslateArgs : config.whisperArgs;
  const args = withPerformanceArgs(
    parseArgs(template, {
      input: inputPath,
      model: config.whisperModelPath,
      outputBase
    }),
    options.processingProfile
  );

  const startedAt = Date.now();
  let lastExplicitPct = 0;
  const heartbeat = setInterval(() => {
    if (lastExplicitPct >= 100) {
      return;
    }

    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const estimatedPct = estimateWhisperStagePct(elapsedSeconds, options.durationSeconds, mode);
    if (estimatedPct > lastExplicitPct) {
      options.onProgress?.(estimatedPct);
    }
  }, 2000);

  try {
    await runCommand(config.whisperCommand, args, {
      onStdoutLine: (line) => {
        if (shouldSurfaceWhisperLogLine(line)) {
          options.onLog?.(line);
        }
        const pct = parseProgressLine(line);
        if (pct !== undefined) {
          lastExplicitPct = pct;
          options.onProgress?.(pct);
        }
      },
      onStderrLine: (line) => {
        if (shouldSurfaceWhisperLogLine(line)) {
          options.onLog?.(line);
        }
        const pct = parseProgressLine(line);
        if (pct !== undefined) {
          lastExplicitPct = pct;
          options.onProgress?.(pct);
        }
      }
    });
  } finally {
    clearInterval(heartbeat);
  }

  const jsonPath = `${outputBase}.json`;
  const payload = await readJsonFile<WhisperOutput>(jsonPath);
  const variant = parseWhisperOutput(payload, options.allowEmpty);
  options.onProgress?.(100);
  return variant;
}

export async function translateAudio(
  inputPath: string,
  workDir: string,
  options: {
    durationSeconds?: number;
    processingProfile?: JobProcessingProfile;
    onLog?: (line: string) => void;
    onProgress?: (stagePct: number) => void;
  } = {}
): Promise<TranscriptVariant> {
  await ensureDir(workDir);
  const processing = options.processingProfile ?? detectProcessingProfile();

  return runWhisperTask(inputPath, path.join(workDir, "english"), "translate", {
    durationSeconds: options.durationSeconds,
    processingProfile: processing,
    onLog: options.onLog,
    onProgress: options.onProgress,
    allowEmpty: true
  });
}

export async function transcribeAudio(
  inputPath: string,
  workDir: string,
  options: {
    durationSeconds?: number;
    processingProfile?: JobProcessingProfile;
    onSourceLog?: (line: string) => void;
    onSourceProgress?: (stagePct: number) => void;
    onTranslationLog?: (line: string) => void;
    onTranslationProgress?: (stagePct: number) => void;
  } = {}
): Promise<TranscribeResult> {
  await ensureDir(workDir);
  const warnings: string[] = [];
  const processing = options.processingProfile ?? detectProcessingProfile();

  const sourceTaskOptions: WhisperTaskOptions = {
    durationSeconds: options.durationSeconds,
    processingProfile: processing,
    onLog: options.onSourceLog,
    onProgress: options.onSourceProgress
  };

  const translateTaskOptions: WhisperTaskOptions = {
    durationSeconds: options.durationSeconds,
    processingProfile: processing,
    onLog: options.onTranslationLog,
    onProgress: options.onTranslationProgress,
    allowEmpty: true
  };

  // Parallel mode: run transcription and translation concurrently
  if (processing.translationEnabled && config.whisperParallel) {
    const [sourceResult, translationResult] = await Promise.allSettled([
      runWhisperTask(inputPath, path.join(workDir, "source"), "transcribe", sourceTaskOptions),
      runWhisperTask(inputPath, path.join(workDir, "english"), "translate", translateTaskOptions)
    ]);

    if (sourceResult.status === "rejected") {
      throw sourceResult.reason;
    }

    let english: TranscriptVariant | undefined;
    if (translationResult.status === "fulfilled") {
      english = translationResult.value;
    } else {
      const message =
        translationResult.reason instanceof Error
          ? `English translation export was skipped: ${translationResult.reason.message}`
          : "English translation export was skipped.";
      warnings.push(message);
      await fs.writeFile(path.join(workDir, "english.error.txt"), message, "utf-8");
    }

    return { source: sourceResult.value, english, warnings, processing };
  }

  // Sequential mode (default): run transcription first, then translation
  const source = await runWhisperTask(inputPath, path.join(workDir, "source"), "transcribe", sourceTaskOptions);

  let english: TranscriptVariant | undefined;
  if (processing.translationEnabled) {
    try {
      english = await runWhisperTask(inputPath, path.join(workDir, "english"), "translate", translateTaskOptions);
    } catch (error) {
      const message =
        error instanceof Error
          ? `English translation export was skipped: ${error.message}`
          : "English translation export was skipped.";
      warnings.push(message);
      await fs.writeFile(path.join(workDir, "english.error.txt"), message, "utf-8");
    }
  }

  return { source, english, warnings, processing };
}
