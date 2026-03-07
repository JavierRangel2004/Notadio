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

export type TranscriptRecord = {
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

export type JobManifest = {
  id: string;
  status: JobStatus;
  stage: string;
  createdAt: string;
  updatedAt: string;
  sourceMedia?: {
    originalName: string;
    mimeType: string;
    sizeBytes: number;
    storedPath: string;
  };
  normalizedAudioPath?: string;
  detectedLanguage?: string;
  durationSeconds?: number;
  warnings: string[];
  error?: string;
  transcriptPath?: string;
  progress?: JobProgress;
  processing?: JobProcessingProfile;
  logs?: string[];
  artifacts: {
    source: string[];
    english: string[];
  };
};
