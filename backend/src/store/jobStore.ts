import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { JobManifest } from "../types.js";
import { ensureDir, readJsonFile, writeJsonFile } from "../utils/fs.js";

class JobStore {
  private readonly jobs = new Map<string, JobManifest>();
  private readonly jobsRoot = path.join(config.storageRoot, "jobs");
  private readonly uploadsRoot = path.join(config.storageRoot, "uploads");
  private ready = false;

  async init(): Promise<void> {
    if (this.ready) {
      return;
    }

    await ensureDir(this.jobsRoot);
    await ensureDir(this.uploadsRoot);

    const entries = await fs.readdir(this.jobsRoot, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const manifestPath = path.join(this.jobsRoot, entry.name, "job.json");
          try {
            const manifest = await readJsonFile<JobManifest>(manifestPath);
            this.jobs.set(manifest.id, manifest);
          } catch {
            return;
          }
        })
    );

    this.ready = true;
  }

  getUploadsRoot(): string {
    return this.uploadsRoot;
  }

  getJobDir(jobId: string): string {
    return path.join(this.jobsRoot, jobId);
  }

  getArtifactDir(jobId: string): string {
    return path.join(this.getJobDir(jobId), "artifacts");
  }

  getManifestPath(jobId: string): string {
    return path.join(this.getJobDir(jobId), "job.json");
  }

  get(jobId: string): JobManifest | undefined {
    return this.jobs.get(jobId);
  }

  async save(job: JobManifest): Promise<void> {
    this.jobs.set(job.id, job);
    await writeJsonFile(this.getManifestPath(job.id), job);
  }
}

export const jobStore = new JobStore();
