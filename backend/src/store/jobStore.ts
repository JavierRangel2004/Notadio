import fs from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { JobManifest, TranscriptRecord } from "../types.js";
import { ensureDir, readJsonFile, writeJsonFile } from "../utils/fs.js";

type JobListener = (job: JobManifest) => void;

class JobStore {
  private readonly jobs = new Map<string, JobManifest>();
  private readonly jobsRoot = path.join(config.storageRoot, "jobs");
  private readonly uploadsRoot = path.join(config.storageRoot, "uploads");
  private ready = false;

  private readonly pendingFlush = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners = new Map<string, Set<JobListener>>();
  private readonly transcriptCache = new Map<string, TranscriptRecord>();

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

  /** Update in-memory state and notify listeners. Does NOT write to disk. */
  update(job: JobManifest): void {
    this.jobs.set(job.id, job);
    this.notifyListeners(job);
  }

  /** Update in-memory state, notify listeners, and write to disk immediately. */
  async persist(job: JobManifest): Promise<void> {
    this.clearPendingFlush(job.id);
    this.jobs.set(job.id, job);
    this.notifyListeners(job);
    await writeJsonFile(this.getManifestPath(job.id), job);
  }

  /** Update in-memory state, notify listeners, and schedule a debounced disk write. */
  debouncedPersist(job: JobManifest, delayMs = 5000): void {
    this.clearPendingFlush(job.id);
    this.jobs.set(job.id, job);
    this.notifyListeners(job);
    const timer = setTimeout(() => {
      this.pendingFlush.delete(job.id);
      void writeJsonFile(this.getManifestPath(job.id), job);
    }, delayMs);
    this.pendingFlush.set(job.id, timer);
  }

  /** Backward-compatible save: immediate persist (used for critical transitions). */
  async save(job: JobManifest): Promise<void> {
    await this.persist(job);
  }

  /** Flush all pending debounced writes to disk immediately. */
  async flushAll(): Promise<void> {
    const flushPromises: Promise<void>[] = [];
    for (const [jobId, timer] of this.pendingFlush) {
      clearTimeout(timer);
      this.pendingFlush.delete(jobId);
      const job = this.jobs.get(jobId);
      if (job) {
        flushPromises.push(writeJsonFile(this.getManifestPath(jobId), job));
      }
    }
    await Promise.all(flushPromises);
  }

  // --- Listener infrastructure for SSE ---

  addListener(jobId: string, listener: JobListener): void {
    let set = this.listeners.get(jobId);
    if (!set) {
      set = new Set();
      this.listeners.set(jobId, set);
    }
    set.add(listener);
  }

  removeListener(jobId: string, listener: JobListener): void {
    const set = this.listeners.get(jobId);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      this.listeners.delete(jobId);
    }
  }

  // --- Transcript cache ---

  getTranscript(jobId: string): TranscriptRecord | undefined {
    return this.transcriptCache.get(jobId);
  }

  setTranscript(jobId: string, transcript: TranscriptRecord): void {
    this.transcriptCache.set(jobId, transcript);
  }

  // --- Private helpers ---

  private notifyListeners(job: JobManifest): void {
    const set = this.listeners.get(job.id);
    if (!set) return;
    for (const listener of set) {
      try {
        listener(job);
      } catch {
        // Listener errors should not break the store
      }
    }
  }

  private clearPendingFlush(jobId: string): void {
    const existing = this.pendingFlush.get(jobId);
    if (existing) {
      clearTimeout(existing);
      this.pendingFlush.delete(jobId);
    }
  }
}

export const jobStore = new JobStore();
