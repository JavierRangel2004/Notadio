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

export type JobManifest = {
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

// --- Live Session Types ---

export type LiveSegmentState = "confirmed" | "provisional"

export type LiveTranscriptSegment = {
  id: string
  start: number
  end: number
  text: string
  state: LiveSegmentState
  windowSeq: number
}

export type TranslatedSegment = {
  /** Matches the id of the original LiveTranscriptSegment. */
  segmentId: string
  text: string
  targetLang: string
}

export type MentionEventIntent = "question" | "task_assignment" | "information_request" | "greeting" | "unknown"

export type MentionEvent = {
  id: string
  sessionId: string
  mentionedAlias: string
  triggerText: string
  detectedAt: number
  segmentIds: string[]
  intent: MentionEventIntent
  assistantResponse?: string
  assistantStatus: "pending" | "generating" | "ready" | "skipped" | "failed"
}

export type SessionConfig = {
  aliases: string[]
  enableAssistant: boolean
  assistantContextWindowSegments: number
}

export type LiveSessionStatus = "recording" | "disconnected" | "stopping" | "stopped" | "error"

export type LiveSession = {
  id: string
  createdAt: string
  status: LiveSessionStatus
  config: SessionConfig
  confirmedSegments: LiveTranscriptSegment[]
  provisionalSegments: LiveTranscriptSegment[]
  mentionEvents: MentionEvent[]
  windowSeq: number
  totalFramesReceived: number
  sessionStartMs: number
  totalPcmBytesWritten: number
  isTranscribingWindow: boolean
  reconnectTimer?: ReturnType<typeof setTimeout>
  errorMessage?: string
  jobId?: string
}
