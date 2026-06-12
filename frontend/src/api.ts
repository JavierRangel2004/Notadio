export type JobStatus = "queued" | "processing" | "completed" | "failed";

export type SourceOrigin = "upload" | "recording" | "note";

export type SummaryPreset = "meeting" | "whatsappVoiceNote" | "genericMedia" | "contentCreation" | "analysisEssay";

export type SummaryContentType = "meeting" | "voiceNote" | "contentCreation" | "analysisEssay" | "genericMedia";

export type EnhancementStageKey = "translate" | "diarize" | "summarize";

export type EnhancementStageState = {
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  error?: string;
};

export type EnhancementConfig = {
  stages: EnhancementStageKey[];
  summaryPreset?: SummaryPreset;
  translationLanguage?: string;
};

export type EnhancementStatus = "awaiting_selection" | "running" | "completed" | "skipped";

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
  speaker?: string;
};

export type TranscriptVariant = {
  language: string;
  text: string;
  segments: TranscriptSegment[];
};

export type MeetingActionItem = {
  task: string;
  assignee?: string;
  deadline?: string;
  priority?: string;
  status?: string;
  notes?: string;
};

export type MeetingSummarySection = {
  title: string;
  summary: string;
  bullets: string[];
  priority?: string;
};

export type MeetingSummary = {
  headline?: string;
  brief: string;
  overview?: string;
  narrative?: string;
  contentType?: SummaryContentType;
  speakerIntent?: string;
  keyDecisions: string[];
  actionItems: MeetingActionItem[];
  coreClaims: string[];
  topics: string[];
  sections: MeetingSummarySection[];
  evidenceMoments: string[];
  followUps: string[];
  risks: string[];
  operationalNotes: string[];
  openQuestions: string[];
};

export type SummaryChunkStatus = "completed" | "failed" | "skipped";

export type SummaryChunkDiagnostic = {
  chunkIndex: number;
  inputChars: number;
  durationMs: number;
  status: SummaryChunkStatus;
  startedAt: string;
  completedAt: string;
  summarySections: number;
  actionItems: number;
  error?: string;
};

export type SummaryDiagnostics = {
  model: string;
  mode: "direct" | "chunked";
  inputChars: number;
  transcriptBlocks: number;
  sampled: boolean;
  chunkCount: number;
  chunkConcurrency: number;
  requestCount: number;
  partialCount: number;
  skippedChunkCount: number;
  failedChunkCount: number;
  totalDurationMs: number;
  directDurationMs?: number;
  reduceDurationMs?: number;
  mergeDurationMs?: number;
  fallbackDurationMs?: number;
  usedReduce: boolean;
  usedMergedPartials: boolean;
  usedFallback: boolean;
  fallbackReason?: string;
  startedAt: string;
  completedAt: string;
  chunks: SummaryChunkDiagnostic[];
};

export type StageTiming = {
  key: string;
  label: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
};

export type TranscriptPayload = {
  jobId: string;
  sourceMedia: {
    originalName: string;
    mimeType: string;
    sizeBytes: number;
  };
  durationSeconds?: number;
  detectedLanguage?: string;
  warnings: string[];
  source: TranscriptVariant;
  english?: TranscriptVariant;
  summary?: MeetingSummary;
  summaryDiagnostics?: SummaryDiagnostics;
};

export type JobProgress = {
  stageKey: string;
  overallPct: number;
  stagePct: number;
  etaSeconds?: number;
  startedAt?: string;
  elapsedSeconds: number;
};

export type RuntimeClass = "windows-gpu" | "windows-cpu" | "macos-arm" | "macos-intel" | "other";

export type RuntimeBackend = "pending" | "cpu" | "cuda" | "metal" | "gpu";

export type TranslationStrategy = "whisper-first" | "hybrid" | "ollama-first";

export type TranslationPath = "pending" | "disabled" | "whisper" | "ollama";

export type JobProcessingProfile = {
  profile: string;
  deviceSummary: string;
  threads: number;
  translationEnabled: boolean;
  runtimeClass?: RuntimeClass;
  hostGpuDetected?: boolean;
  expectedBackend?: RuntimeBackend;
  translationStrategy?: TranslationStrategy;
  translationPath?: TranslationPath;
  readinessStatus?: "ok" | "warn" | "fail";
  runtimeBackend?: RuntimeBackend;
  runtimeSummary?: string;
  capabilityWarnings?: string[];
};

export type ReadinessCheckStatus = "ok" | "warn" | "fail";

export type ReadinessCheck = {
  status: ReadinessCheckStatus;
  label: string;
  detail: string;
};

export type ReadinessReport = {
  status: ReadinessCheckStatus;
  checks: ReadinessCheck[];
  processing: JobProcessingProfile;
};

export type NoteConversionConfig = {
  vaultPath: string;
  notePath: string;
  voice?: string;
  provider?: string;
  model?: string;
};

export type JobPayload = {
  noteConversionConfig?: NoteConversionConfig;
  id: string;
  status: JobStatus;
  stage: string;
  createdAt: string;
  updatedAt: string;
  sourceOrigin?: SourceOrigin;
  sourceMedia?: {
    originalName: string;
    mimeType: string;
    sizeBytes: number;
  };
  detectedLanguage?: string;
  durationSeconds?: number;
  warnings: string[];
  error?: string;
  transcriptReady?: boolean;
  enhancementStatus?: EnhancementStatus;
  enhancementConfig?: EnhancementConfig;
  enhancementStages?: Record<string, EnhancementStageState>;
  summaryDiagnostics?: SummaryDiagnostics;
  progress?: JobProgress;
  processing?: JobProcessingProfile;
  logs?: string[];
  stageTimings?: Record<string, StageTiming>;
  artifacts: {
    source: string[];
    english: string[];
  };
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787/api";

export async function uploadMedia(
  file: File,
  options?: { sourceOrigin?: SourceOrigin }
): Promise<{ jobId: string }> {
  const body = new FormData();
  body.append("media", file);
  if (options?.sourceOrigin) {
    body.append("sourceOrigin", options.sourceOrigin);
  }

  const response = await fetch(`${API_BASE}/uploads`, {
    method: "POST",
    body
  });

  if (!response.ok) {
    const raw = await response.text();
    try {
      const payload = JSON.parse(raw) as { error?: string };
      if (payload.error) {
        throw new Error(payload.error);
      }
    } catch (error) {
      if (error instanceof Error && error.message !== raw) {
        throw error;
      }
    }
    throw new Error(raw || `Upload failed with status ${response.status}.`);
  }

  return response.json();
}

export async function getJob(jobId: string, signal?: AbortSignal): Promise<JobPayload> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}`, { signal });
  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

export async function getJobs(status?: string, signal?: AbortSignal): Promise<JobPayload[]> {
  const url = status ? `${API_BASE}/jobs?status=${encodeURIComponent(status)}` : `${API_BASE}/jobs`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function deleteJob(jobId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}`, {
    method: "DELETE"
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
}

export async function reprocessJob(jobId: string): Promise<JobPayload> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/reprocess`, { method: "POST" });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export async function getTranscript(jobId: string, signal?: AbortSignal): Promise<TranscriptPayload> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/transcript`, { signal });
  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

export async function getSummary(jobId: string, signal?: AbortSignal): Promise<MeetingSummary | null> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/summary`, { signal });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

export async function getSystemReadiness(signal?: AbortSignal): Promise<ReadinessReport> {
  const response = await fetch(`${API_BASE}/system/readiness`, { signal });
  if (!response.ok) {
    throw new Error(await response.text());
  }

  return response.json();
}

export async function retrySummarize(
  jobId: string
): Promise<JobPayload> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/retry/summarize`, { method: "POST" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Retry failed");
  }
  return response.json();
}

export async function retryDiarize(jobId: string): Promise<JobPayload> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/retry/diarize`, { method: "POST" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Retry diarization failed");
  }
  return response.json();
}

export async function retryTranslate(jobId: string): Promise<JobPayload> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/retry/translate`, { method: "POST" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Retry translation failed");
  }
  return response.json();
}

export async function submitEnhancements(
  jobId: string,
  config: EnhancementConfig
): Promise<JobPayload> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/enhancements`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config)
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export function getExportUrl(
  jobId: string,
  format: "txt" | "srt" | "json",
  variant: "source" | "english"
): string {
  return `${API_BASE}/jobs/${jobId}/export?format=${format}&variant=${variant}`;
}

export function getAudioUrl(jobId: string): string {
  return `${API_BASE}/jobs/${jobId}/audio`;
}

/**
 * Subscribe to real-time job updates via Server-Sent Events.
 * Returns an unsubscribe function to close the connection.
 */
export function subscribeToJob(
  jobId: string,
  onUpdate: (job: JobPayload) => void,
  onError?: (err: Event) => void
): () => void {
  const source = new EventSource(`${API_BASE}/jobs/${jobId}/events`);

  source.onmessage = (event) => {
    try {
      const job: JobPayload = JSON.parse(event.data);
      onUpdate(job);
    } catch {
      // Ignore parse errors
    }
  };

  source.onerror = (err) => {
    onError?.(err);
  };

  return () => source.close();
}

export type NoteInfo = {
  relativePath: string;
  title: string;
  tags: string[];
  sizeBytes: number;
};

export async function scanVault(vaultPath: string): Promise<NoteInfo[]> {
  const response = await fetch(`${API_BASE}/vault/scan?path=${encodeURIComponent(vaultPath)}`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

export type ProviderInfo = {
  id: string;
  label: string;
  defaultModel: string;
};

export async function getProviders(): Promise<ProviderInfo[]> {
  const response = await fetch(`${API_BASE}/llm/providers`);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

// Discover the model ids a provider currently offers (Ollama `ollama list`,
// OpenCode `/models`). Returns [] on any failure so the UI keeps free-text entry.
export async function getProviderModels(providerId: string): Promise<string[]> {
  try {
    const response = await fetch(
      `${API_BASE}/llm/providers/${encodeURIComponent(providerId)}/models`
    );
    const data = (await response.json()) as { models?: string[] };
    return data.models ?? [];
  } catch {
    return [];
  }
}

// Fetch a plain-text excerpt for a note so the UI can preview content before
// converting. Returns null on any failure (the preview is non-critical).
export async function getNoteExcerpt(
  vaultPath: string,
  notePath: string,
  signal?: AbortSignal
): Promise<{ excerpt: string; wordCount?: number } | null> {
  try {
    const response = await fetch(
      `${API_BASE}/vault/note?vaultPath=${encodeURIComponent(vaultPath)}&path=${encodeURIComponent(notePath)}`,
      { signal }
    );
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// URL for a short spoken sample of a voice (audio/mpeg), used by the voice picker.
export function getVoicePreviewUrl(voice: string): string {
  return `${API_BASE}/tts/preview?voice=${encodeURIComponent(voice)}`;
}

export async function convertNotesToAudio(
  vaultPath: string,
  notes: string[],
  voice?: string,
  provider?: string,
  model?: string
): Promise<{ jobIds: string[] }> {
  const response = await fetch(`${API_BASE}/vault/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vaultPath, notes, voice, provider, model })
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

