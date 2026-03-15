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
const TRANSLATION_BATCH_MAX_SEGMENTS = 12;
const TRANSLATION_BATCH_MAX_CHARS = 2200;

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

function extractJsonCandidate(response: string): string {
  const fencedMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch) {
    return fencedMatch[1].trim();
  }

  const trimmed = response.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart !== -1 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1).trim();
  }

  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    return trimmed.slice(arrayStart, arrayEnd + 1).trim();
  }

  return trimmed;
}

function repairJson(jsonString: string): string {
  return jsonString
    .replace(/^\uFEFF/, "")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
}

function parseJsonFromLlmResponse(response: string): Record<string, unknown> {
  const jsonString = extractJsonCandidate(response);

  try {
    return JSON.parse(jsonString) as Record<string, unknown>;
  } catch {
    try {
      return JSON.parse(repairJson(jsonString)) as Record<string, unknown>;
    } catch {
      throw new Error("Failed to parse translation response as JSON.");
    }
  }
}

function chunkSegments(segments: TranscriptSegment[]): TranscriptSegment[][] {
  const chunks: TranscriptSegment[][] = [];
  let currentChunk: TranscriptSegment[] = [];
  let currentChars = 0;

  for (const segment of segments) {
    const segmentChars = segment.text.length;
    const nextChars = currentChars + segmentChars;
    if (
      currentChunk.length > 0 &&
      (currentChunk.length >= TRANSLATION_BATCH_MAX_SEGMENTS || nextChars > TRANSLATION_BATCH_MAX_CHARS)
    ) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentChars = 0;
    }

    currentChunk.push(segment);
    currentChars += segmentChars;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function buildTranslationPrompt(batch: TranscriptSegment[]): string {
  const serializedBatch = JSON.stringify(
    batch.map((segment, index) => ({
      index,
      speaker: segment.speaker ?? null,
      start: segment.start,
      end: segment.end,
      text: segment.text
    })),
    null,
    2
  );

  return `You translate transcript segments from Spanish to English.
Return ONLY valid JSON with this exact shape:
{"translations":[{"index":0,"text":"..."}]}

Rules:
1. Keep exactly one output item per input segment.
2. Preserve the original ordering and indexes.
3. Translate only the text field into natural English.
4. Do not summarize, merge, omit, add timestamps, or add speaker labels.
5. If a segment is already English, keep it natural English.

Segments:
${serializedBatch}`;
}

async function requestStructuredTranslation(batch: TranscriptSegment[]): Promise<string[]> {
  const prompt = buildTranslationPrompt(batch);
  const response = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ollamaModel,
      prompt,
      format: "json",
      stream: false,
      options: {
        temperature: 0.1
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama HTTP ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  if (typeof data?.response !== "string" || !data.response.trim()) {
    throw new Error("Ollama returned an empty translation response.");
  }

  const payload = parseJsonFromLlmResponse(data.response);
  const translationsRaw = payload.translations;
  if (!Array.isArray(translationsRaw)) {
    throw new Error("Translation response did not include a translations array.");
  }

  if (translationsRaw.length !== batch.length) {
    throw new Error(`Translation returned ${translationsRaw.length} segments for ${batch.length} inputs.`);
  }

  return translationsRaw.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`Translation item ${index} is not an object.`);
    }

    const candidate = item as Record<string, unknown>;
    if (candidate.index !== index) {
      throw new Error(`Translation item index mismatch at position ${index}.`);
    }

    const text = typeof candidate.text === "string" ? candidate.text.trim() : "";
    if (!text) {
      throw new Error(`Translation item ${index} is empty.`);
    }

    return text;
  });
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

export async function translateTranscript(
  source: TranscriptVariant,
  options: {
    onLog?: (line: string) => void;
    onProgress?: (stagePct: number) => void;
  } = {}
): Promise<TranscriptVariant> {
  if (source.segments.length === 0) {
    throw new Error("Source transcript has no segments to translate.");
  }

  const batches = chunkSegments(source.segments);
  const translatedSegments: TranscriptSegment[] = [];
  options.onLog?.(`Translating transcript text to English in ${batches.length} batch${batches.length === 1 ? "" : "es"}.`);
  options.onProgress?.(0);

  for (const [batchIndex, batch] of batches.entries()) {
    options.onLog?.(`Translating transcript batch ${batchIndex + 1}/${batches.length} (${batch.length} segments).`);
    const translatedTexts = await requestStructuredTranslation(batch);
    translatedSegments.push(
      ...batch.map((segment, index) => ({
        ...segment,
        text: translatedTexts[index]!
      }))
    );

    const progress = Math.round(((batchIndex + 1) / batches.length) * 100);
    options.onProgress?.(progress);
  }

  return {
    language: "en",
    text: translatedSegments.map((segment) => segment.text).join(" ").trim(),
    segments: translatedSegments
  };
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

  const source = await runWhisperTask(inputPath, path.join(workDir, "source"), "transcribe", sourceTaskOptions);

  let english: TranscriptVariant | undefined;
  if (processing.translationEnabled) {
    try {
      english = await translateTranscript(source, {
        onLog: options.onTranslationLog,
        onProgress: options.onTranslationProgress
      });
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
