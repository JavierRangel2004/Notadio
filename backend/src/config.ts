import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const configFileDir = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(configFileDir, "..");
const projectRoot = path.resolve(backendRoot, "..");

dotenv.config({ path: path.join(projectRoot, ".env") });
dotenv.config({ path: path.join(backendRoot, ".env") });
dotenv.config();

function expandHomeDir(value: string): string {
  if (!value.startsWith("~")) {
    return value;
  }

  const homeDir = process.env.HOME ?? process.env.USERPROFILE;
  if (!homeDir) {
    return value;
  }

  if (value === "~") {
    return homeDir;
  }

  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(homeDir, value.slice(2));
  }

  return value;
}

function isPathLike(value: string): boolean {
  return (
    value.startsWith(".") ||
    value.startsWith("~") ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    value.includes("/") ||
    value.includes("\\") ||
    /^[A-Za-z]:[\\/]/.test(value)
  );
}

function resolveProjectPath(value: string | undefined, fallback: string): string {
  const rawValue = (value ?? fallback).trim();
  const expandedValue = expandHomeDir(rawValue);
  return path.isAbsolute(expandedValue) ? expandedValue : path.resolve(projectRoot, expandedValue);
}

function resolveCommandPath(value: string | undefined, fallback: string): string {
  const rawValue = (value ?? fallback).trim();
  if (!rawValue || !isPathLike(rawValue)) {
    return rawValue;
  }

  return resolveProjectPath(rawValue, fallback);
}

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function readNumber(value: string | undefined, fallback: number, options: { min?: number; max?: number } = {}): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (options.min !== undefined && parsed < options.min) {
    return options.min;
  }

  if (options.max !== undefined && parsed > options.max) {
    return options.max;
  }

  return parsed;
}

function readOptionalNumber(
  value: string | undefined,
  options: { min?: number; max?: number } = {}
): number | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return readNumber(value, parsed, options);
}

export const config = {
  backendRoot,
  projectRoot,
  port: Number(process.env.PORT ?? "8787"),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  storageRoot: resolveProjectPath(process.env.STORAGE_ROOT, "data"),
  ffmpegPath: resolveCommandPath(process.env.FFMPEG_PATH, "ffmpeg"),
  whisperCommand: resolveCommandPath(process.env.WHISPER_COMMAND, "whisper-cli"),
  whisperModelPath: process.env.WHISPER_MODEL_PATH ? resolveProjectPath(process.env.WHISPER_MODEL_PATH, "") : "",
  whisperArgs:
    process.env.WHISPER_ARGS ??
    '-m "{model}" -f "{input}" --output-json --output-srt --output-file "{outputBase}" --language auto',
  whisperTranslateArgs:
    process.env.WHISPER_TRANSLATE_ARGS ??
    '-m "{model}" -f "{input}" --output-json --output-file "{outputBase}" --language auto --translate',
  whisperPerfProfile: process.env.WHISPER_PERF_PROFILE ?? "auto",
  whisperThreads: process.env.WHISPER_THREADS ? Number(process.env.WHISPER_THREADS) : undefined,
  enableEnglishTranslation: readBoolean(process.env.ENABLE_ENGLISH_TRANSLATION, true),
  jobLogLimit: Number(process.env.JOB_LOG_LIMIT ?? "300"),
  diarizationCommand: resolveCommandPath(process.env.DIARIZATION_COMMAND, ""),
  diarizationArgs:
    process.env.DIARIZATION_ARGS ??
    '"{projectRoot}/scripts/diarize_audio.py" --input "{input}" --output "{outputFile}"',
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  ollamaModel: process.env.OLLAMA_MODEL ?? "llama3.2",
  enableSummary: readBoolean(process.env.ENABLE_SUMMARY, true),
  summaryChunkConcurrency: readNumber(process.env.SUMMARY_CHUNK_CONCURRENCY, 2, { min: 1, max: 8 }),
  summaryReduceMinPartials: readNumber(process.env.SUMMARY_REDUCE_MIN_PARTIALS, 3, { min: 2, max: 12 }),
  summaryDirectCharLimit: readNumber(process.env.SUMMARY_DIRECT_CHAR_LIMIT, 12000, { min: 2000, max: 120000 }),
  summaryChunkCharLimit: readNumber(process.env.SUMMARY_CHUNK_CHAR_LIMIT, 8000, { min: 1000, max: 32000 }),
  summaryMaxInputChars: readNumber(process.env.SUMMARY_MAX_INPUT_CHARS, 48000, { min: 4000, max: 160000 }),
  summaryBlockMaxChars: readNumber(process.env.SUMMARY_BLOCK_MAX_CHARS, 420, { min: 120, max: 4000 }),
  summaryOllamaNumPredict: readOptionalNumber(process.env.SUMMARY_OLLAMA_NUM_PREDICT, { min: 64, max: 4096 }),
  summaryOllamaNumCtx: readOptionalNumber(process.env.SUMMARY_OLLAMA_NUM_CTX, { min: 512, max: 65536 }),
  summaryOllamaKeepAlive: process.env.SUMMARY_OLLAMA_KEEP_ALIVE?.trim() || undefined,
  whisperParallel: readBoolean(process.env.WHISPER_PARALLEL, false),
  maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS ?? "1")
};
