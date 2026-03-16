import os from "node:os";
import { spawnSync } from "node:child_process";
import { config } from "../config.js";
import {
  JobProcessingProfile,
  RuntimeBackend,
  RuntimeClass,
  TranslationPath,
  TranslationStrategy
} from "../types.js";

function clampThreads(value: number, cores: number): number {
  return Math.max(1, Math.min(Math.max(1, cores), Math.floor(value)));
}

function commandExists(command: string): boolean {
  try {
    const checker = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(checker, [command], {
      stdio: ["ignore", "ignore", "ignore"]
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function hasNvidiaGpu(): boolean {
  try {
    const result = spawnSync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    return result.status === 0 && Boolean(result.stdout.toString().trim());
  } catch {
    return false;
  }
}

export function classifyRuntime(
  platform = os.platform(),
  arch = os.arch(),
  gpuDetected = platform === "win32" && hasNvidiaGpu()
): RuntimeClass {
  if (platform === "win32") {
    return gpuDetected ? "windows-gpu" : "windows-cpu";
  }

  if (platform === "darwin") {
    return arch === "arm64" ? "macos-arm" : "macos-intel";
  }

  return "other";
}

export function getExpectedBackend(runtimeClass: RuntimeClass): RuntimeBackend {
  switch (runtimeClass) {
    case "windows-gpu":
      return "cuda";
    case "macos-arm":
      return "metal";
    default:
      return "cpu";
  }
}

function getProfileForRuntime(runtimeClass: RuntimeClass, logicalCores: number): string {
  switch (runtimeClass) {
    case "windows-gpu":
      return "speed";
    case "macos-arm":
      return "balanced";
    case "windows-cpu":
    case "macos-intel":
      return logicalCores <= 4 ? "quality" : "balanced";
    default:
      return logicalCores <= 4 ? "quality" : "balanced";
  }
}

function getRecommendedThreads(runtimeClass: RuntimeClass, logicalCores: number, profile: string): number {
  switch (runtimeClass) {
    case "windows-gpu":
      return clampThreads(Math.max(4, logicalCores - 1), logicalCores);
    case "macos-arm":
      return clampThreads(Math.max(4, logicalCores * 0.75), logicalCores);
    case "macos-intel":
      return clampThreads(Math.max(2, logicalCores * 0.5), logicalCores);
    case "windows-cpu":
      return profile === "quality"
        ? clampThreads(Math.max(2, logicalCores * 0.5), logicalCores)
        : clampThreads(Math.max(2, logicalCores * 0.65), logicalCores);
    default:
      switch (profile) {
        case "speed":
          return clampThreads(Math.max(2, logicalCores - 1), logicalCores);
        case "quality":
          return clampThreads(Math.max(1, logicalCores / 2), logicalCores);
        default:
          return clampThreads(Math.max(2, logicalCores * 0.75), logicalCores);
      }
  }
}

export function selectTranslationPath(
  strategy: TranslationStrategy,
  runtimeClass: RuntimeClass,
  translationEnabled: boolean
): TranslationPath {
  if (!translationEnabled) {
    return "disabled";
  }

  switch (strategy) {
    case "ollama-first":
      return "ollama";
    case "hybrid":
      return runtimeClass === "windows-gpu" || runtimeClass === "macos-arm" ? "whisper" : "ollama";
    default:
      return "whisper";
  }
}

function buildDeviceSummary(runtimeClass: RuntimeClass, platform: string, arch: string, logicalCores: number): string {
  const labels = [platform, arch, `${logicalCores} logical cores`];

  switch (runtimeClass) {
    case "windows-gpu":
      labels.unshift("Windows GPU");
      labels.push("NVIDIA GPU detected");
      break;
    case "windows-cpu":
      labels.unshift("Windows CPU");
      break;
    case "macos-arm":
      labels.unshift("Apple Silicon");
      break;
    case "macos-intel":
      labels.unshift("Intel Mac");
      break;
    default:
      labels.unshift("Generic host");
      break;
  }

  return labels.join(" | ");
}

export function collectCapabilityWarnings(
  processing: Pick<JobProcessingProfile, "runtimeClass" | "hostGpuDetected" | "expectedBackend" | "translationPath">
): string[] {
  const warnings: string[] = [];

  if (processing.runtimeClass === "windows-gpu" && !processing.hostGpuDetected) {
    warnings.push("Windows GPU profile expected an NVIDIA GPU, but no GPU was detected.");
  }

  if (processing.translationPath === "ollama") {
    warnings.push("English translation is configured to use Ollama. Missing Ollama runtime or model pull will block translation.");
  }

  if (processing.expectedBackend === "cpu" && processing.runtimeClass === "macos-intel") {
    warnings.push("Intel Macs use the CPU path. Use a smaller Whisper model if large models are too slow.");
  }

  return warnings;
}

export function detectProcessingProfile(): JobProcessingProfile {
  const platform = os.platform();
  const arch = os.arch();
  const logicalCores = os.cpus().length || 1;
  const requestedProfile = config.whisperPerfProfile;
  const hostGpuDetected = platform === "win32" && hasNvidiaGpu();
  const runtimeClass = classifyRuntime(platform, arch, hostGpuDetected);
  const expectedBackend = getExpectedBackend(runtimeClass);

  const profile = requestedProfile === "auto"
    ? getProfileForRuntime(runtimeClass, logicalCores)
    : requestedProfile;

  const threads = config.whisperThreads ?? getRecommendedThreads(runtimeClass, logicalCores, profile);
  const translationPath = selectTranslationPath(config.translationStrategy, runtimeClass, config.enableEnglishTranslation);
  const processing: JobProcessingProfile = {
    profile,
    deviceSummary: buildDeviceSummary(runtimeClass, platform, arch, logicalCores),
    threads,
    translationEnabled: config.enableEnglishTranslation,
    runtimeClass,
    hostGpuDetected,
    expectedBackend,
    translationStrategy: config.translationStrategy,
    translationPath,
    readinessStatus: "ok",
    runtimeBackend: "pending",
    runtimeSummary: "Waiting for Whisper runtime telemetry",
    capabilityWarnings: []
  };

  const warnings = collectCapabilityWarnings(processing);
  processing.capabilityWarnings = warnings;
  if (warnings.length > 0) {
    processing.readinessStatus = "warn";
  }

  if ((config.whisperCommand === "whisper-cli" && !commandExists("whisper-cli")) || !config.whisperModelPath) {
    processing.readinessStatus = "fail";
  }

  return processing;
}
