import fs from "node:fs/promises";
import path from "node:path";

export type DiskSpaceSnapshot = {
  path: string;
  freeBytes: number;
  totalBytes: number;
};

export type JobDiskRequirement = {
  sourceBytes: number;
  requiredBytes: number;
  multiplier: number;
  fixedHeadroomBytes: number;
};

export class InsufficientDiskSpaceError extends Error {
  readonly snapshot: DiskSpaceSnapshot;
  readonly requirement: JobDiskRequirement;
  readonly minFreeBytes: number;

  constructor(message: string, snapshot: DiskSpaceSnapshot, requirement: JobDiskRequirement, minFreeBytes: number) {
    super(message);
    this.name = "InsufficientDiskSpaceError";
    this.snapshot = snapshot;
    this.requirement = requirement;
    this.minFreeBytes = minFreeBytes;
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 100 || unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function estimateJobDiskBytes(
  sourceBytes: number,
  multiplier: number,
  fixedHeadroomBytes: number
): JobDiskRequirement {
  const normalizedSourceBytes = Math.max(0, Math.floor(sourceBytes));
  return {
    sourceBytes: normalizedSourceBytes,
    multiplier,
    fixedHeadroomBytes,
    requiredBytes: Math.ceil(normalizedSourceBytes * multiplier + fixedHeadroomBytes)
  };
}

export async function getDiskSpaceSnapshot(targetPath: string): Promise<DiskSpaceSnapshot> {
  const resolvedPath = path.resolve(targetPath);
  let probePath = resolvedPath;

  try {
    const stat = await fs.stat(probePath);
    if (!stat.isDirectory()) {
      probePath = path.dirname(probePath);
    }
  } catch {
    probePath = path.dirname(probePath);
  }

  const stats = await fs.statfs(probePath);
  return {
    path: probePath,
    freeBytes: stats.bavail * stats.bsize,
    totalBytes: stats.blocks * stats.bsize
  };
}

export async function assertDiskSpaceForJob(
  targetPath: string,
  sourceBytes: number,
  options: {
    multiplier: number;
    fixedHeadroomBytes: number;
    minFreeBytes: number;
  }
): Promise<{ snapshot: DiskSpaceSnapshot; requirement: JobDiskRequirement }> {
  const snapshot = await getDiskSpaceSnapshot(targetPath);
  const requirement = estimateJobDiskBytes(sourceBytes, options.multiplier, options.fixedHeadroomBytes);
  const neededBytes = requirement.requiredBytes + options.minFreeBytes;

  if (snapshot.freeBytes < neededBytes) {
    throw new InsufficientDiskSpaceError(
      `Insufficient disk space on ${snapshot.path}. Need ${formatBytes(neededBytes)} available (${formatBytes(requirement.requiredBytes)} for this job plus ${formatBytes(options.minFreeBytes)} headroom), but only ${formatBytes(snapshot.freeBytes)} is free.`,
      snapshot,
      requirement,
      options.minFreeBytes
    );
  }

  return { snapshot, requirement };
}
