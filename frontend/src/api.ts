export type JobStatus = "queued" | "processing" | "completed" | "failed";

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
  keyDecisions: string[];
  actionItems: MeetingActionItem[];
  topics: string[];
  sections: MeetingSummarySection[];
  followUps: string[];
  risks: string[];
  operationalNotes: string[];
  openQuestions: string[];
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
};

export type JobProgress = {
  stageKey: string;
  overallPct: number;
  stagePct: number;
  etaSeconds?: number;
  startedAt?: string;
  elapsedSeconds: number;
};

export type JobProcessingProfile = {
  profile: string;
  deviceSummary: string;
  threads: number;
  translationEnabled: boolean;
  runtimeBackend?: string;
  runtimeSummary?: string;
  capabilityWarnings?: string[];
};

export type JobPayload = {
  id: string;
  status: JobStatus;
  stage: string;
  createdAt: string;
  updatedAt: string;
  sourceMedia?: {
    originalName: string;
    mimeType: string;
    sizeBytes: number;
  };
  detectedLanguage?: string;
  durationSeconds?: number;
  warnings: string[];
  error?: string;
  progress?: JobProgress;
  processing?: JobProcessingProfile;
  logs?: string[];
  artifacts: {
    source: string[];
    english: string[];
  };
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787/api";

export async function uploadMedia(file: File): Promise<{ jobId: string }> {
  const body = new FormData();
  body.append("media", file);

  const response = await fetch(`${API_BASE}/uploads`, {
    method: "POST",
    body
  });

  if (!response.ok) {
    throw new Error(await response.text());
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

export async function retrySummarize(jobId: string): Promise<MeetingSummary | null> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/retry/summarize`, { method: "POST" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Retry failed");
  }
  return response.json();
}

export async function retryDiarize(jobId: string): Promise<{ warnings: string[]; segmentCount: number }> {
  const response = await fetch(`${API_BASE}/jobs/${jobId}/retry/diarize`, { method: "POST" });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Retry diarization failed");
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
