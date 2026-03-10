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
  whisperParallel: readBoolean(process.env.WHISPER_PARALLEL, false),
  maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS ?? "1")
};
