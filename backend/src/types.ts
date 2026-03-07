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
  artifacts: {
    source: string[];
    english: string[];
  };
};
