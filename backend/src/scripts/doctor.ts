import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { config } from "../config.js";
import { parseArgs } from "../utils/process.js";

type CheckStatus = "ok" | "warn" | "fail";

type CheckResult = {
  status: CheckStatus;
  label: string;
  detail: string;
};

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

function runCommandCheck(command: string, args: string[]): { ok: boolean; detail: string } {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (result.error) {
    return { ok: false, detail: result.error.message };
  }

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.status === 0 || /\busage\b/i.test(output)) {
    return { ok: true, detail: output.split("\n")[0] ?? "Command succeeded." };
  }

  return {
    ok: false,
    detail: output.split("\n")[0] ?? `${command} exited with code ${result.status ?? "unknown"}`
  };
}

async function checkOptionalDiarization(results: CheckResult[]): Promise<void> {
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

async function checkOptionalSummary(results: CheckResult[]): Promise<void> {
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

async function main(): Promise<void> {
  const results: CheckResult[] = [];
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
  if (!whisperCommandExists) {
    results.push({
      status: "fail",
      label: "whisper command",
      detail: `Configured path does not exist: ${config.whisperCommand}`
    });
  } else {
    const whisperCheck = runCommandCheck(config.whisperCommand, ["-h"]);
    results.push({
      status: whisperCheck.ok ? "ok" : "fail",
      label: "whisper command",
      detail: whisperCheck.detail
    });
  }

  results.push({
    status: config.whisperModelPath && (await pathExists(config.whisperModelPath)) ? "ok" : "fail",
    label: "whisper model",
    detail: config.whisperModelPath
      ? config.whisperModelPath
      : "WHISPER_MODEL_PATH is not configured."
  });

  await checkOptionalDiarization(results);
  await checkOptionalSummary(results);

  console.log(`Project root: ${config.projectRoot}`);
  console.log(`Backend root: ${config.backendRoot}`);
  console.log("");

  for (const result of results) {
    console.log(`[${result.status.toUpperCase()}] ${result.label}: ${result.detail}`);
  }

  const failed = results.some((result) => result.status === "fail");
  if (failed) {
    process.exitCode = 1;
  }
}

void main();
