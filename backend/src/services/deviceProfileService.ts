import os from "node:os";
import { spawnSync } from "node:child_process";
import { config } from "../config.js";
import { JobProcessingProfile } from "../types.js";

function clampThreads(value: number, cores: number): number {
  return Math.max(1, Math.min(Math.max(1, cores), Math.floor(value)));
}

function hasNvidiaGpu(): boolean {
  try {
    const result = spawnSync("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    return result.status === 0 && Boolean(result.stdout.toString().trim());
  } catch {
    return false;
  }
}

export function detectProcessingProfile(): JobProcessingProfile {
  const platform = os.platform();
  const arch = os.arch();
  const logicalCores = os.cpus().length || 1;
  const requestedProfile = config.whisperPerfProfile;
  const gpuAvailable = platform === "win32" && hasNvidiaGpu();

  let profile = requestedProfile;
  if (requestedProfile === "auto") {
    if (platform === "darwin" && arch === "arm64") {
      profile = "balanced";
    } else if (gpuAvailable) {
      profile = "speed";
    } else if (logicalCores <= 4) {
      profile = "quality";
    } else {
      profile = "balanced";
    }
  }

  const recommendedThreads =
    config.whisperThreads ??
    (() => {
      switch (profile) {
        case "speed":
          return clampThreads(Math.max(2, logicalCores - 1), logicalCores);
        case "quality":
          return clampThreads(Math.max(1, logicalCores / 2), logicalCores);
        default:
          return clampThreads(Math.max(2, logicalCores * 0.75), logicalCores);
      }
    })();

  const deviceLabels = [platform, arch, `${logicalCores} logical cores`];
  if (platform === "darwin" && arch === "arm64") {
    deviceLabels.unshift("Apple Silicon");
  } else if (gpuAvailable) {
    deviceLabels.push("NVIDIA GPU detected");
  }

  return {
    profile,
    deviceSummary: deviceLabels.join(" | "),
    threads: recommendedThreads,
    translationEnabled: config.enableEnglishTranslation,
    runtimeBackend: "pending",
    runtimeSummary: "Waiting for Whisper runtime telemetry",
    capabilityWarnings: []
  };
}
