export type JobStatus = "queued" | "processing" | "completed" | "failed";

export type SourceOrigin = "upload" | "recording";

export type SummaryPreset = "meeting" | "whatsappVoiceNote" | "genericMedia";

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
  keyDecisions: string[];
  actionItems: MeetingActionItem[];
  topics: string[];
  sections: MeetingSummarySection[];
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
  sourceOrigin?: SourceOrigin;
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
  transcriptReady?: boolean;
  enhancementStatus?: EnhancementStatus;
  enhancementConfig?: EnhancementConfig;
  enhancementStages?: Record<string, EnhancementStageState>;
  transcriptPath?: string;
  summaryPath?: string;
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
