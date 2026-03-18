import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { config } from "../config.js";
import { detectProcessingProfile } from "./deviceProfileService.js";
import { ReadinessCheck, ReadinessReport } from "../types.js";
import { parseArgs } from "../utils/process.js";

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

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function runCommandCheck(command: string, args: string[]): { ok: boolean; detail: string; output: string } {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error) {
    return { ok: false, detail: result.error.message, output: "" };
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.status === 0 || /\busage\b/i.test(output)) {
    return { ok: true, detail: output.split("\n")[0] ?? "Command succeeded.", output };
  }

  return {
    ok: false,
    detail: output.split("\n")[0] ?? `${command} exited with code ${result.status ?? "unknown"}`,
    output
  };
}

function inferWhisperBackendSupport(output: string): { cuda: boolean; metal: boolean } {
  const normalized = output.toLowerCase();
  return {
    cuda: normalized.includes("cuda"),
    metal: normalized.includes("metal")
  };
}

function inferMetalFromLinkageOutput(output: string): boolean {
  const normalized = output.toLowerCase();
  return normalized.includes("libggml-metal") || normalized.includes("metal.framework");
}

function resolveExecutablePath(command: string): string | null {
  if (isPathLike(command)) {
    return command;
  }

  const result = spawnSync("which", [command], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  const resolved = (result.stdout ?? "").trim().split("\n")[0]?.trim();
  return resolved || null;
}

function detectWhisperMetalLinkage(command: string): boolean {
  if (process.platform !== "darwin") {
    return false;
  }

  const executablePath = resolveExecutablePath(command);
  if (!executablePath) {
    return false;
  }

  const linkageCheck = runCommandCheck("otool", ["-L", executablePath]);
  return inferMetalFromLinkageOutput(linkageCheck.output);
}

async function checkOptionalDiarization(results: ReadinessCheck[]): Promise<void> {
  if (!config.diarizationCommand) {
    results.push({
      status: "warn",
      label: "Diarization",
      detail: "Disabled. Set DIARIZATION_COMMAND after running scripts/setup-diarization.sh."
    });
    return;
  }

  if (isPathLike(config.diarizationCommand) && !(await pathExists(config.diarizationCommand))) {
    results.push({
      status: "fail",
      label: "Diarization command",
      detail: `Configured path does not exist: ${config.diarizationCommand}`
    });
    return;
  }

  const renderedArgs = parseArgs(config.diarizationArgs, {
    projectRoot: config.projectRoot,
    input: path.join(config.projectRoot, "doctor-input.wav"),
    outputFile: path.join(config.projectRoot, "doctor-output.json")
  });

  const scriptArg = renderedArgs.find((arg) => arg.endsWith(".py"));
  if (scriptArg && !(await pathExists(scriptArg))) {
    results.push({
      status: "fail",
      label: "Diarization script",
      detail: `Configured script path does not exist: ${scriptArg}`
    });
    return;
  }

  const pythonLike = /python/i.test(path.basename(config.diarizationCommand));
  if (!pythonLike) {
    results.push({
      status: "ok",
      label: "Diarization",
      detail: `Configured command: ${config.diarizationCommand}`
    });
    return;
  }

  const check = runCommandCheck(config.diarizationCommand, ["-c", "from diarize import diarize; print('diarize-ok')"]);
  results.push({
    status: check.ok ? "ok" : "fail",
    label: "Diarization",
    detail: check.ok ? "Python environment and diarize package are available." : check.detail
  });
}

async function checkOptionalSummary(results: ReadinessCheck[]): Promise<void> {
  if (!config.enableSummary) {
    results.push({
      status: "warn",
      label: "Meeting summary",
      detail: "Disabled. Set ENABLE_SUMMARY=true to enable Ollama summaries."
    });
    return;
  }

  try {
    const response = await fetch(`${config.ollamaBaseUrl}/api/tags`, {
      signal: AbortSignal.timeout(3000)
    });

    if (!response.ok) {
      results.push({
        status: "fail",
        label: "Ollama",
        detail: `HTTP ${response.status} from ${config.ollamaBaseUrl}/api/tags`
      });
      return;
    }

    const payload = await response.json() as { models?: Array<{ name?: string }> };
    const installedModels = (payload.models ?? []).map((model) => model.name).filter(Boolean) as string[];
    const hasConfiguredModel = installedModels.some((name) => name === config.ollamaModel || name.startsWith(`${config.ollamaModel}:`));

    results.push({
      status: hasConfiguredModel ? "ok" : "warn",
      label: "Ollama",
      detail: hasConfiguredModel
        ? `Reachable and model ${config.ollamaModel} is installed.`
        : `Reachable, but model ${config.ollamaModel} is not installed. Run: ollama pull ${config.ollamaModel}`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({
      status: "fail",
      label: "Ollama",
      detail: `Could not reach ${config.ollamaBaseUrl} (${message})`
    });
  }
}

export async function getReadinessReport(): Promise<ReadinessReport> {
  const processing = detectProcessingProfile();
  const results: ReadinessCheck[] = [];
  const envPath = path.join(config.projectRoot, ".env");
  const hasProjectEnv = await pathExists(envPath);

  results.push({
    status: hasProjectEnv ? "ok" : "warn",
    label: ".env",
    detail: hasProjectEnv
      ? `Loaded project env from ${envPath}`
      : `No .env file found at ${envPath}. Copy .env.example first.`
  });

  results.push({
    status: await pathExists(config.storageRoot) ? "ok" : "warn",
    label: "Storage root",
    detail: config.storageRoot
  });

  const ffmpegCheck = runCommandCheck(config.ffmpegPath, ["-version"]);
  results.push({
    status: ffmpegCheck.ok ? "ok" : "fail",
    label: "ffmpeg",
    detail: ffmpegCheck.detail
  });

  const whisperCommandExists =
    !isPathLike(config.whisperCommand) || (await pathExists(config.whisperCommand));
  let whisperSupport = { cuda: false, metal: false };

  if (!whisperCommandExists) {
    results.push({
      status: "fail",
      label: "whisper command",
      detail: `Configured path does not exist: ${config.whisperCommand}`
    });
  } else {
    const whisperCheck = runCommandCheck(config.whisperCommand, ["-h"]);
    whisperSupport = inferWhisperBackendSupport(whisperCheck.output);
    const metalDetectedFromLinkage =
      processing.runtimeClass === "macos-arm" && !whisperSupport.metal
        ? detectWhisperMetalLinkage(config.whisperCommand)
        : false;

    if (metalDetectedFromLinkage) {
      whisperSupport.metal = true;
    }

    results.push({
      status: whisperCheck.ok ? "ok" : "fail",
      label: "whisper command",
      detail: whisperCheck.detail
    });

    if (config.whisperEnableVad) {
      results.push({
        status: /--vad\b/i.test(whisperCheck.output) ? "ok" : "fail",
        label: "Whisper VAD support",
        detail: /--vad\b/i.test(whisperCheck.output)
          ? "Whisper help output includes VAD support."
          : "Configured whisper build does not appear to support --vad."
      });
    }
  }

  results.push({
    status: config.whisperModelPath && (await pathExists(config.whisperModelPath)) ? "ok" : "fail",
    label: "whisper model",
    detail: config.whisperModelPath
      ? config.whisperModelPath
      : "WHISPER_MODEL_PATH is not configured."
  });

  if (config.whisperEnableVad) {
    const hasVadModel = Boolean(config.whisperVadModelPath) && await pathExists(config.whisperVadModelPath);
    results.push({
      status: hasVadModel ? "ok" : "fail",
      label: "whisper VAD model",
      detail: hasVadModel
        ? config.whisperVadModelPath
        : config.whisperVadModelPath
          ? `Configured VAD model path does not exist: ${config.whisperVadModelPath}`
          : "WHISPER_VAD_MODEL_PATH is not configured."
    });
  }

  if (processing.runtimeClass === "windows-gpu") {
    results.push({
      status: whisperSupport.cuda ? "ok" : "warn",
      label: "Whisper CUDA support",
      detail: whisperSupport.cuda
        ? "Whisper help output appears to include CUDA support."
        : "Host GPU detected, but Whisper help output did not show CUDA support. A CPU-only build may be configured."
    });
  } else if (processing.runtimeClass === "macos-arm") {
    results.push({
      status: whisperSupport.metal ? "ok" : "warn",
      label: "Whisper Metal support",
      detail: whisperSupport.metal
        ? "Whisper build appears to include Metal support."
        : "Apple Silicon detected, but Whisper help output did not show Metal support."
    });
  }

  results.push({
    status: processing.translationPath === "ollama" ? "warn" : "ok",
    label: "Translation path",
    detail: processing.translationPath === "ollama"
      ? `English translation is set to ${processing.translationPath}. Ollama must be running and have ${config.ollamaModel} pulled.`
      : `English translation is set to ${processing.translationPath ?? "pending"}.`
  });

  await checkOptionalDiarization(results);
  await checkOptionalSummary(results);

  const hasFail = results.some((result) => result.status === "fail");
  const hasWarn = results.some((result) => result.status === "warn");
  processing.readinessStatus = hasFail ? "fail" : hasWarn ? "warn" : "ok";
  processing.capabilityWarnings = [
    ...(processing.capabilityWarnings ?? []),
    ...results.filter((result) => result.status !== "ok").map((result) => `${result.label}: ${result.detail}`)
  ];

  return {
    status: processing.readinessStatus,
    checks: results,
    processing
  };
}
