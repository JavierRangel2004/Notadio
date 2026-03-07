import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), "..", ".env") });
dotenv.config();

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export const config = {
  port: Number(process.env.PORT ?? "8787"),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  storageRoot: path.resolve(process.cwd(), process.env.STORAGE_ROOT ?? "../data"),
  ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
  whisperCommand: process.env.WHISPER_COMMAND ?? "whisper-cli",
  whisperModelPath: process.env.WHISPER_MODEL_PATH ?? "",
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
  diarizationCommand: process.env.DIARIZATION_COMMAND ?? "",
  diarizationArgs: process.env.DIARIZATION_ARGS ?? '--input "{input}" --output "{outputFile}"'
};
