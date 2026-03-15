import { FormEvent, useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import {
  getExportUrl,
  getJob,
  getSummary,
  getTranscript,
  getJobs,
  deleteJob,
  getAudioUrl,
  EnhancementConfig,
  EnhancementStageKey,
  JobPayload,
  JobProcessingProfile,
  JobProgress,
  MeetingSummary,
  retryDiarize,
  retrySummarize,
  retryTranslate,
  SourceOrigin,
  StageTiming,
  submitEnhancements,
  SummaryDiagnostics,
  SummaryPreset,
  subscribeToJob,
  TranscriptPayload,
  TranscriptSegment,
  TranscriptVariant,
  uploadMedia
} from "./api";

const ACCEPTED_TYPES = "audio/*,video/*,.mkv";
const mojibakePattern = /[ÃÂÐÑÌÒÙ]/;

type SegmentGroup = {
  speaker?: string;
  start: number;
  end: number;
  segments: TranscriptSegment[];
};

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours > 0) {
    return [hours, minutes, secs].map((value) => String(value).padStart(2, "0")).join(":");
  }

  return [minutes, secs].map((value) => String(value).padStart(2, "0")).join(":");
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) {
    return "Unknown size";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDurationValue(durationMs?: number): string {
  if (durationMs === undefined || durationMs < 0) {
    return "n/a";
  }

  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }

  return `${(durationMs / 1000).toFixed(durationMs >= 10000 ? 1 : 2)} s`;
}

function describeSummaryStrategy(summaryDiagnostics?: SummaryDiagnostics): string {
  if (!summaryDiagnostics) {
    return "No diagnostics captured";
  }

  if (summaryDiagnostics.mode === "direct") {
    return "Direct single-pass summary";
  }

  return `Chunked summary (${summaryDiagnostics.chunkCount} chunks, concurrency ${summaryDiagnostics.chunkConcurrency})`;
}

const STAGE_ORDER = ["queued", "normalize", "transcribe", "translate", "diarize", "summarize", "export"];

function formatStageLabel(stageKey: string): string {
  switch (stageKey) {
    case "queued":
      return "Queued";
    case "normalize":
      return "Normalize";
    case "transcribe":
      return "Transcribe";
    case "translate":
      return "Translate";
    case "diarize":
      return "Diarize";
    case "summarize":
      return "Summarize";
    case "export":
      return "Export";
    default:
      return stageKey;
  }
}

function getOrderedStageTimings(stageTimings?: Record<string, StageTiming>): StageTiming[] {
  if (!stageTimings) {
    return [];
  }

  return Object.values(stageTimings).sort((left, right) => {
    const leftIndex = STAGE_ORDER.indexOf(left.key);
    const rightIndex = STAGE_ORDER.indexOf(right.key);
    return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
  });
}

function scoreTextCandidate(value: string): number {
  const mojibakeHits = (value.match(/[ÃÂÐÑÌÒÙ]/g) ?? []).length;
  const accentHits = (value.match(/[áéíóúÁÉÍÓÚñÑüÜ]/g) ?? []).length;
  const replacementHits = (value.match(/\uFFFD/g) ?? []).length;
  return accentHits * 4 - mojibakeHits * 3 - replacementHits * 6 + value.length * 0.01;
}

function repairText(value?: string): string {
  if (!value) {
    return "";
  }

  const normalized = value.normalize("NFC");
  if (!mojibakePattern.test(normalized)) {
    return normalized;
  }

  try {
    const bytes = Uint8Array.from(Array.from(normalized, (char) => char.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes).normalize("NFC");
    return scoreTextCandidate(decoded) > scoreTextCandidate(normalized) ? decoded : normalized;
  } catch {
    return normalized;
  }
}

function getDisplayName(name?: string): string {
  const repaired = repairText(name);
  return repaired || "Untitled file";
}

function getSpeakerColorClass(speakerName?: string) {
  if (!speakerName) return "";
  const match = speakerName.match(/\d+/);
  if (!match) return "speaker-color-0";
  const num = parseInt(match[0], 10);
  return `speaker-color-${num % 6}`;
}

function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

function groupSegments(segments: TranscriptSegment[]): SegmentGroup[] {
  const groups: SegmentGroup[] = [];

  for (const segment of segments) {
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.speaker === segment.speaker) {
      lastGroup.end = segment.end;
      lastGroup.segments.push(segment);
      continue;
    }

    groups.push({
      speaker: segment.speaker,
      start: segment.start,
      end: segment.end,
      segments: [segment]
    });
  }

  return groups;
}

function hasUsableSummary(summary: MeetingSummary | null | undefined): summary is MeetingSummary {
  if (!summary) {
    return false;
  }

  return Boolean(
    summary.headline ||
      summary.overview ||
      summary.sections.length > 0 ||
      summary.keyDecisions.length > 0 ||
      summary.actionItems.length > 0 ||
      summary.followUps.length > 0 ||
      summary.risks.length > 0 ||
      summary.operationalNotes.length > 0 ||
      summary.openQuestions.length > 0 ||
      (summary.brief && summary.brief !== "No brief generated.")
  );
}

const PRESET_DESCRIPTIONS: Record<SummaryPreset, { label: string; description: string; defaultDiarize: boolean }> = {
  meeting: { label: "Meeting / Daily Standup", description: "Extract action items, decisions, blockers, and follow-ups", defaultDiarize: true },
  whatsappVoiceNote: { label: "WhatsApp Voice Note", description: "Concise recap with intent, asks, and deadlines", defaultDiarize: false },
  genericMedia: { label: "Generic Audio/Video", description: "Neutral recap with key points and notable moments", defaultDiarize: false }
};

function getRunningEnhancementStage(job?: JobPayload | null): EnhancementStageKey | null {
  if (!job?.enhancementStages) {
    return null;
  }

  const activeEntry = Object.entries(job.enhancementStages).find(([, state]) => state.status === "running");
  return (activeEntry?.[0] as EnhancementStageKey | undefined) ?? null;
}

function isPostProcessingActive(job?: JobPayload | null): boolean {
  return Boolean(job && getRunningEnhancementStage(job) && job.status === "completed");
}

function getStageActionLabel(stageKey: EnhancementStageKey | null): string {
  switch (stageKey) {
    case "summarize":
      return "Regenerate Summary";
    case "diarize":
      return "Re-run Speaker ID";
    case "translate":
      return "Translate to English";
    default:
      return "Post-processing";
  }
}

function getStageProgress(job: JobPayload | null, stageKey: EnhancementStageKey): number | null {
  if (!job) {
    return null;
  }

  const stageState = job.enhancementStages?.[stageKey];
  if (stageState?.status !== "running") {
    return null;
  }

  if (job.progress?.stageKey === stageKey || job.progress?.stageKey === "export") {
    return Math.round(job.progress.overallPct);
  }

  return 0;
}

function LogsPanel({
  logs,
  title,
  defaultExpanded
}: {
  logs: string[];
  title: string;
  defaultExpanded: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultExpanded);

  useEffect(() => {
    setIsOpen(defaultExpanded);
  }, [defaultExpanded, title]);

  if (logs.length === 0) {
    return null;
  }

  return (
    <div className="glass-panel">
      <div className="section-header">
        <div>
          <h4 style={{ marginBottom: "0.2rem" }}>{title}</h4>
          <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>{logs.length} entries</div>
        </div>
        <div className="section-actions">
          <button className="btn-secondary" type="button" onClick={() => copyText(logs.join("\n"))}>
            Copy all
          </button>
          <button className="btn-secondary" type="button" onClick={() => setIsOpen((current) => !current)}>
            {isOpen ? "Hide" : "Show"}
          </button>
        </div>
      </div>
      {isOpen && <div className="log-box">{logs.join("\n")}</div>}
    </div>
  );
}

function InlineProgressPanel({
  job,
  stageKey
}: {
  job: JobPayload;
  stageKey: EnhancementStageKey | null;
}) {
  if (!stageKey || !job.progress) {
    return null;
  }

  return (
    <div className="inline-progress-panel">
      <div className="section-header" style={{ marginBottom: "0.75rem" }}>
        <div>
          <strong>{getStageActionLabel(stageKey)}</strong>
          <div style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>{job.stage}</div>
        </div>
        <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {Math.round(job.progress.overallPct)}%
        </div>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${job.progress.overallPct}%` }} />
      </div>
      <div className="progress-meta">
        <span>{formatStageLabel(job.progress.stageKey)}</span>
        <span>{job.progress.etaSeconds !== undefined ? `ETA ${formatTime(job.progress.etaSeconds)}` : "Working"}</span>
      </div>
    </div>
  );
}

function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
        <h3 id="confirm-modal-title">{title}</h3>
        <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem" }}>{description}</p>
        <div className="modal-actions">
          <button className="btn-secondary" type="button" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" type="button" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

function WorkspaceView({ onSelectJob }: { onSelectJob: (job: JobPayload) => void }) {
  const [jobs, setJobs] = useState<JobPayload[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadJobs() {
    try {
      setLoading(true);
      const data = await getJobs();
      setJobs(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadJobs();
  }, []);

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this job permanently?")) return;
    try {
      await deleteJob(id);
      loadJobs();
    } catch (err) {
      alert("Failed to delete job");
    }
  }

  if (loading) return <div style={{ padding: '2rem' }}>Loading workspace...</div>;
  if (jobs.length === 0) return <div style={{ padding: '2rem' }}>No jobs found in your workspace.</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem', padding: '1rem 0' }}>
      {jobs.map(job => (
        <div key={job.id} onClick={() => onSelectJob(job)} className="glass-panel" style={{ cursor: 'pointer', transition: 'transform 0.1s', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <strong style={{ fontSize: '1.1rem' }}>{job.sourceMedia?.originalName || 'Untitled Session'}</strong>
            <button onClick={(e) => handleDelete(job.id, e)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '4px' }}>×</button>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {new Date(job.createdAt).toLocaleString()}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto', paddingTop: '1rem', flexWrap: 'wrap' }}>
            <span className="tag-outline" style={{ fontSize: '0.75rem', padding: '0.1rem 0.5rem' }}>{job.status}</span>
            {job.sourceOrigin === "recording" && <span className="tag-outline" style={{ fontSize: '0.75rem', padding: '0.1rem 0.5rem' }}>mic</span>}
            {job.detectedLanguage && <span className="tag-outline" style={{ fontSize: '0.75rem', padding: '0.1rem 0.5rem' }}>{job.detectedLanguage}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

const AudioPlayer = forwardRef<{ seek: (t: number) => void }, { jobId: string; duration?: number }>(
  ({ jobId, duration }, ref) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [playing, setPlaying] = useState(false);
    const [time, setTime] = useState(0);

    useImperativeHandle(ref, () => ({
      seek(t: number) {
        if (audioRef.current) {
          audioRef.current.currentTime = t;
          if (!playing) {
            audioRef.current.play().catch(() => { });
            setPlaying(true);
          }
        }
      }
    }));

    useEffect(() => {
      const audio = audioRef.current;
      if (!audio) return;
      const onTimeUpdate = () => setTime(audio.currentTime);
      const onEnded = () => setPlaying(false);
      audio.addEventListener("timeupdate", onTimeUpdate);
      audio.addEventListener("ended", onEnded);
      return () => {
        audio.removeEventListener("timeupdate", onTimeUpdate);
        audio.removeEventListener("ended", onEnded);
      };
    }, []);

    const togglePlay = () => {
      if (audioRef.current) {
        if (playing) {
          audioRef.current.pause();
          setPlaying(false);
        } else {
          audioRef.current.play();
          setPlaying(true);
        }
      }
    };

    const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
      const t = Number(e.target.value);
      if (audioRef.current) {
        audioRef.current.currentTime = t;
        setTime(t);
      }
    };

    if (!duration) return null;

    return (
      <div className="audio-player-mock">
        <audio ref={audioRef} src={getAudioUrl(jobId)} preload="metadata" />
        <div className="audio-controls">
          <button
            type="button"
            className={`audio-control-button ${playing ? "pause" : "play"}`}
            aria-label={playing ? "Pause audio" : "Play audio"}
            onClick={togglePlay}
          >
            {playing ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>
          <div className="audio-control-copy">
            <strong>Session audio</strong>
            <span>Use transcript timestamps to jump to the recording.</span>
          </div>
        </div>
        <div className="audio-timeline">
          <span className="audio-time">{formatTime(time)}</span>
          <label className="sr-only" htmlFor={`audio-seek-${jobId}`}>Seek through uploaded audio</label>
          <input
            id={`audio-seek-${jobId}`}
            type="range"
            min="0"
            max={duration}
            step="0.1"
            value={time}
            onChange={onSeek}
          />
          <span className="audio-time">{formatTime(duration)}</span>
        </div>
      </div>
    );
  }
);

AudioPlayer.displayName = "AudioPlayer";

function RecorderPanel({ onRecordingComplete }: { onRecordingComplete: (file: File) => void }) {
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      window.clearInterval(timerRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        const ext = recorder.mimeType.includes("webm") ? "webm" : "ogg";
        const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: recorder.mimeType });
        stream.getTracks().forEach((t) => t.stop());
        onRecordingComplete(file);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(1000);
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    } catch {
      setPermissionDenied(true);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    window.clearInterval(timerRef.current);
    setRecording(false);
    setPaused(false);
  }

  function togglePause() {
    if (!mediaRecorderRef.current) return;
    if (paused) {
      mediaRecorderRef.current.resume();
      timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
      setPaused(false);
    } else {
      mediaRecorderRef.current.pause();
      window.clearInterval(timerRef.current);
      setPaused(true);
    }
  }

  function discardRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    }
    window.clearInterval(timerRef.current);
    chunksRef.current = [];
    setRecording(false);
    setPaused(false);
    setElapsed(0);
  }

  if (permissionDenied) {
    return (
      <div className="glass-panel" style={{ textAlign: "center", padding: "2rem" }}>
        <p style={{ color: "var(--danger)", marginBottom: "1rem" }}>Microphone access denied</p>
        <p style={{ color: "var(--text-muted)" }}>Allow microphone access in your browser settings to record.</p>
        <button className="btn-secondary" onClick={() => setPermissionDenied(false)} style={{ marginTop: "1rem" }}>
          Try Again
        </button>
      </div>
    );
  }

  if (!recording) {
    return (
      <button className="btn-primary" onClick={startRecording} style={{ width: "100%" }}>
        Start Recording
      </button>
    );
  }

  return (
    <div className="glass-panel" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1.5rem", padding: "2rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: paused ? "var(--text-muted)" : "var(--danger)",
            animation: paused ? "none" : "pulse 1.5s infinite"
          }}
        />
        <span style={{ fontSize: "2rem", fontVariantNumeric: "tabular-nums" }}>{formatTime(elapsed)}</span>
      </div>
      <p style={{ color: "var(--text-muted)" }}>{paused ? "Paused" : "Recording..."}</p>
      <div style={{ display: "flex", gap: "1rem" }}>
        <button className="btn-secondary" onClick={discardRecording}>Discard</button>
        <button className="btn-secondary" onClick={togglePause}>{paused ? "Resume" : "Pause"}</button>
        <button className="btn-primary" onClick={stopRecording}>Stop & Use</button>
      </div>
    </div>
  );
}

function EnhancementPrompt({ job, onSubmit, onSkip }: {
  job: JobPayload;
  onSubmit: (config: EnhancementConfig) => void;
  onSkip: () => void;
}) {
  const defaultPreset: SummaryPreset = job.sourceOrigin === "recording" ? "meeting" : "genericMedia";
  const [summarizeEnabled, setSummarizeEnabled] = useState(true);
  const [diarizeEnabled, setDiarizeEnabled] = useState(PRESET_DESCRIPTIONS[defaultPreset].defaultDiarize);
  const [translateEnabled, setTranslateEnabled] = useState(false);
  const [summaryPreset, setSummaryPreset] = useState<SummaryPreset>(defaultPreset);
  const [submitting, setSubmitting] = useState(false);

  function handlePresetChange(preset: SummaryPreset) {
    setSummaryPreset(preset);
    setDiarizeEnabled(PRESET_DESCRIPTIONS[preset].defaultDiarize);
  }

  function handleSubmit() {
    setSubmitting(true);
    const stages: EnhancementStageKey[] = [];
    if (translateEnabled) stages.push("translate");
    if (diarizeEnabled) stages.push("diarize");
    if (summarizeEnabled) stages.push("summarize");
    onSubmit({
      stages,
      summaryPreset: summarizeEnabled ? summaryPreset : undefined,
      translationLanguage: translateEnabled ? "en" : undefined
    });
  }

  return (
    <div className="glass-panel" style={{ padding: "1.5rem" }}>
      <h4 style={{ marginBottom: "0.5rem" }}>Enhance Your Transcript</h4>
      <p style={{ color: "var(--text-muted)", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
        Base transcription is ready. Choose optional enhancements to run.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.5rem" }}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={summarizeEnabled}
            onChange={(e) => setSummarizeEnabled(e.target.checked)}
            style={{ marginTop: "0.2rem" }}
          />
          <div>
            <strong>AI Summary</strong>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }}>
              Extract key points, decisions, and action items
            </p>
          </div>
        </label>

        {summarizeEnabled && (
          <div style={{ marginLeft: "2rem" }}>
            <label style={{ display: "block", marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
              Summary type
            </label>
            <select
              value={summaryPreset}
              onChange={(e) => handlePresetChange(e.target.value as SummaryPreset)}
              className="enhancement-select"
            >
              {Object.entries(PRESET_DESCRIPTIONS).map(([key, info]) => (
                <option key={key} value={key}>{info.label}</option>
              ))}
            </select>
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: "0.4rem 0 0" }}>
              {PRESET_DESCRIPTIONS[summaryPreset].description}
            </p>
          </div>
        )}

        <label style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={diarizeEnabled}
            onChange={(e) => setDiarizeEnabled(e.target.checked)}
            style={{ marginTop: "0.2rem" }}
          />
          <div>
            <strong>Speaker Identification</strong>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }}>
              Identify who said what in the recording
            </p>
          </div>
        </label>

        <label style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={translateEnabled}
            onChange={(e) => setTranslateEnabled(e.target.checked)}
            style={{ marginTop: "0.2rem" }}
          />
          <div>
            <strong>English Translation</strong>
            <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }}>
              Translate transcript to English
            </p>
          </div>
        </label>
      </div>

      <div style={{ display: "flex", gap: "1rem" }}>
        <button className="btn-secondary" onClick={onSkip} disabled={submitting}>Skip Enhancements</button>
        <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Starting..." : "Run Selected"}
        </button>
      </div>
    </div>
  );
}

type AppView = "upload" | "processing" | "enhancements" | "results" | "workspace";

export function App() {
  const [sourceMode, setSourceMode] = useState<"upload" | "record">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [sourceOrigin, setSourceOrigin] = useState<SourceOrigin>("upload");
  const [job, setJob] = useState<JobPayload | null>(null);
  const [transcript, setTranscript] = useState<TranscriptPayload | null>(null);
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<"source" | "english">("source");
  const [copiedState, setCopiedState] = useState<"summary" | "transcript" | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [view, setView] = useState<AppView>("upload");
  const [showTranslateConfirm, setShowTranslateConfirm] = useState(false);
  const [autoSwitchToEnglish, setAutoSwitchToEnglish] = useState(false);
  const audioPlayerRef = useRef<{ seek: (t: number) => void }>(null);
  const autoSwitchToEnglishRef = useRef(false);
  const activePostStage = getRunningEnhancementStage(job);

  useEffect(() => {
    autoSwitchToEnglishRef.current = autoSwitchToEnglish;
  }, [autoSwitchToEnglish]);

  useEffect(() => {
    if (!job) return;
    const shouldSubscribe =
      job.status === "queued" ||
      job.status === "processing" ||
      Boolean(activePostStage && job.status === "completed");
    if (!shouldSubscribe) return;
    const unsubscribe = subscribeToJob(
      job.id,
      (updatedJob) => {
        const wasPostProcessingActive = isPostProcessingActive(job);
        const isNowPostProcessingActive = isPostProcessingActive(updatedJob);
        setJob(updatedJob);
        if (
          updatedJob.transcriptReady &&
          updatedJob.enhancementStatus === "awaiting_selection" &&
          view === "processing"
        ) {
          getTranscript(updatedJob.id)
            .then((t) => setTranscript(t))
            .catch(() => {});
          setView("enhancements");
        }
        if (wasPostProcessingActive && !isNowPostProcessingActive && updatedJob.status === "completed") {
          Promise.all([
            getTranscript(updatedJob.id),
            getSummary(updatedJob.id).catch(() => null)
          ])
            .then(([transcriptPayload, summaryPayload]) => {
              setTranscript(transcriptPayload);
              setSummary(summaryPayload ?? transcriptPayload.summary ?? null);
              if (autoSwitchToEnglishRef.current && transcriptPayload.english) {
                setSelectedVariant("english");
              }
              setAutoSwitchToEnglish(false);
            })
            .catch((loadError) => {
              setError(loadError instanceof Error ? loadError.message : "Failed to refresh transcript");
            });
        }
      },
      () => {
        void getJob(job.id)
          .then((nextJob) => setJob(nextJob))
          .catch((pollError) => {
            setError(pollError instanceof Error ? pollError.message : "Failed to refresh job");
          });
      }
    );
    return unsubscribe;
  }, [job?.id, job?.status, activePostStage, view]);

  useEffect(() => {
    if (!job || job.status !== "completed") return;
    const controller = new AbortController();
    Promise.all([
      getTranscript(job.id, controller.signal),
      getSummary(job.id, controller.signal).catch(() => null)
    ])
      .then(([transcriptPayload, summaryPayload]) => {
        setTranscript(transcriptPayload);
        setSummary(summaryPayload ?? transcriptPayload.summary ?? null);
        if (!transcriptPayload.english) setSelectedVariant("source");
        if (view === "processing" || view === "enhancements") setView("results");
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load transcript");
      });
    return () => controller.abort();
  }, [job?.id, job?.status, view]);

  useEffect(() => {
    if (!copiedState) return;
    const timeout = window.setTimeout(() => setCopiedState(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [copiedState]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) {
      setError("Choose an audio or video file first.");
      return;
    }

    setError(null);
    setJob(null);
    setTranscript(null);
    setSummary(null);
    setIsUploading(true);

    try {
      const { jobId } = await uploadMedia(file, { sourceOrigin });
      const createdJob = await getJob(jobId);
      setJob(createdJob);
      setView("processing");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleSubmitEnhancements(config: EnhancementConfig) {
    if (!job) return;
    try {
      const updated = await submitEnhancements(job.id, config);
      setJob(updated);
      if (config.stages.length > 0) {
        setView("processing");
      } else {
        setView("results");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit enhancements");
    }
  }

  async function handleSkipEnhancements() {
    if (!job) return;
    try {
      const updated = await submitEnhancements(job.id, { stages: [] });
      setJob(updated);
      setView("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to skip enhancements");
    }
  }

  async function handleRetrySummarize() {
    if (!job) return;
    try {
      const updatedJob = await retrySummarize(job.id);
      setJob(updatedJob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    }
  }

  async function handleRetryDiarize() {
    if (!job) return;
    try {
      const updatedJob = await retryDiarize(job.id);
      setJob(updatedJob);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry diarization failed");
    }
  }

  async function handleRetryTranslate() {
    if (!job) return;
    try {
      const updatedJob = await retryTranslate(job.id);
      setJob(updatedJob);
      setAutoSwitchToEnglish(true);
      setShowTranslateConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry translation failed");
    }
  }

  function handleRecordingComplete(recordedFile: File) {
    setFile(recordedFile);
    setSourceOrigin("recording");
  }

  function resetToUpload() {
    setView("upload");
    setJob(null);
    setFile(null);
    setTranscript(null);
    setSummary(null);
    setSourceMode("upload");
    setSourceOrigin("upload");
    setShowTranslateConfirm(false);
    setAutoSwitchToEnglish(false);
  }

  const visibleTranscript: TranscriptVariant | undefined =
    selectedVariant === "english" && transcript?.english ? transcript.english : transcript?.source;
  const progress: JobProgress = job?.progress ?? {
    stageKey: job?.status ?? "queued",
    overallPct: job?.status === "completed" ? 100 : 0,
    stagePct: job?.status === "completed" ? 100 : 0,
    elapsedSeconds: 0
  };
  const processing: JobProcessingProfile = job?.processing ?? {
    profile: "pending",
    deviceSummary: "Waiting for telemetry",
    threads: 0,
    translationEnabled: true
  };
  const logs = job?.logs ?? [];
  const summaryDiagnostics = transcript?.summaryDiagnostics ?? job?.summaryDiagnostics;
  const stageTimings = getOrderedStageTimings(job?.stageTimings);
  const visibleSegments = visibleTranscript?.segments ?? [];
  const groupedSegments = groupSegments(visibleSegments);
  const displayUploadName = getDisplayName(file?.name);
  const displaySummary = hasUsableSummary(summary) ? summary : null;

  const isProcessing = job?.status === "processing" || job?.status === "queued";
  const isCompleted = job?.status === "completed";
  const isAwaitingEnhancements = job?.enhancementStatus === "awaiting_selection";
  const postProcessingActive = isPostProcessingActive(job);
  const controlsDisabled = Boolean(activePostStage);

  function handleSelectEnglish() {
    if (transcript?.english) {
      setSelectedVariant("english");
      return;
    }

    if (postProcessingActive) {
      return;
    }

    setShowTranslateConfirm(true);
  }

  return (
    <div className="app-shell" style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
      <div className="main-app-container">
        <nav className="app-nav">
          <div className="app-nav-logo" onClick={resetToUpload} style={{ cursor: "pointer" }}>
            <div className="brand-icon">
              <span /><span /><span />
            </div>
            NOTADIO
          </div>
          <div className="app-nav-links">
            <span onClick={() => { setView("workspace"); setJob(null); setFile(null); }} style={{ fontWeight: view === 'workspace' ? 600 : 400 }}>Workspace</span>
            <span onClick={resetToUpload}>New Session &uarr;</span>
          </div>
        </nav>

        <div className="app-content">
          {error && (
            <div style={{ background: 'var(--danger)', color: '#fff', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
              {error}
              <button onClick={() => setError(null)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}>Close</button>
            </div>
          )}

          {view === "workspace" && (
            <WorkspaceView
              onSelectJob={(selectedJob) => {
                setJob(selectedJob);
                if (selectedJob.status === "completed" || selectedJob.status === "failed") {
                  setView("results");
                } else if (selectedJob.transcriptReady && selectedJob.enhancementStatus === "awaiting_selection") {
                  getTranscript(selectedJob.id)
                    .then((t) => setTranscript(t))
                    .catch(() => {});
                  setView("enhancements");
                } else {
                  setView("processing");
                }
              }}
            />
          )}

          {view === "upload" && !job && (
            <div className="hero-upload">
              <h2>Transform Your Audio with Intelligent AI</h2>
              <p style={{ color: 'var(--text-muted)' }}>Upload a file or record from your microphone to get speaker-aware transcripts, summaries, and more.</p>

              <div className="control-strip" role="tablist" aria-label="Source mode" style={{ marginBottom: '1.5rem' }}>
                <button
                  className={`control-btn ${sourceMode === "upload" ? "active" : ""}`}
                  onClick={() => { setSourceMode("upload"); setSourceOrigin("upload"); setFile(null); }}
                  type="button"
                >
                  Upload File
                </button>
                <button
                  className={`control-btn ${sourceMode === "record" ? "active" : ""}`}
                  onClick={() => { setSourceMode("record"); setSourceOrigin("recording"); setFile(null); }}
                  type="button"
                >
                  Record Mic
                </button>
              </div>

              {sourceMode === "upload" && (
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2rem', width: '100%', maxWidth: '600px' }}>
                  <div
                    className={`upload-dropzone ${isDragOver ? 'drag-over' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragOver(false);
                      const dropped = e.dataTransfer.files?.[0];
                      if (dropped) setFile(dropped);
                    }}
                    style={{ width: '100%' }}
                  >
                    <input
                      type="file"
                      accept={ACCEPTED_TYPES}
                      className="upload-input"
                      onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    />
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>

                    {file ? (
                      <div style={{ textAlign: 'center' }}>
                        <strong>{displayUploadName}</strong>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{formatBytes(file.size)}</p>
                      </div>
                    ) : (
                      <div style={{ textAlign: 'center' }}>
                        <strong>Select a file</strong>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>or drag and drop here</p>
                      </div>
                    )}
                  </div>

                  <button className="btn-primary" type="submit" disabled={!file || isUploading} style={{ width: '100%' }}>
                    {isUploading ? "Uploading..." : "Start Transcription"}
                  </button>
                </form>
              )}

              {sourceMode === "record" && !file && (
                <div style={{ width: "100%", maxWidth: "600px" }}>
                  <RecorderPanel onRecordingComplete={handleRecordingComplete} />
                </div>
              )}

              {sourceMode === "record" && file && (
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem', width: '100%', maxWidth: '600px' }}>
                  <div className="glass-panel" style={{ width: "100%", textAlign: "center", padding: "1.5rem" }}>
                    <strong>{file.name}</strong>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>{formatBytes(file.size)}</p>
                  </div>
                  <div style={{ display: "flex", gap: "1rem", width: "100%" }}>
                    <button className="btn-secondary" type="button" onClick={() => setFile(null)} style={{ flex: 1 }}>
                      Re-record
                    </button>
                    <button className="btn-primary" type="submit" disabled={isUploading} style={{ flex: 1 }}>
                      {isUploading ? "Uploading..." : "Start Transcription"}
                    </button>
                  </div>
                </form>
              )}

              <div className="feature-cards">
                <div className="feature-card">
                  <h4>Summaries</h4>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Action items and meeting overview</p>
                </div>
                <div className="feature-card">
                  <h4>Translation</h4>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Translate to English in real-time</p>
                </div>
                <div className="feature-card">
                  <h4>Diarization</h4>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Accurate speaker identification</p>
                </div>
              </div>
            </div>
          )}

          {view === "processing" && job && isProcessing && !isAwaitingEnhancements && (
            <div className="processing-dash">
              <div className="glass-panel highlight">
                <div className="status-header">
                  <h3>{job.sourceMedia?.originalName || 'Processing File...'}</h3>
                  <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{job.stage}</span>
                </div>

                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${progress.overallPct}%` }} />
                </div>
                <div className="progress-meta">
                  <span>{Math.round(progress.overallPct)}% Complete</span>
                  <span>{progress.stageKey}</span>
                </div>

                {job.enhancementStages && (
                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
                    {Object.entries(job.enhancementStages).map(([key, state]) => (
                      <span key={key} className="tag-outline" style={{
                        fontSize: "0.75rem",
                        padding: "0.15rem 0.5rem",
                        color: state.status === "completed" ? "var(--accent-primary)" : state.status === "failed" ? "var(--danger)" : undefined
                      }}>
                        {formatStageLabel(key)}: {state.status}
                      </span>
                    ))}
                  </div>
                )}

                <div className="stats-row" style={{ marginTop: '2rem' }}>
                  <div className="stat-block">
                    <span>Source</span>
                    <strong>{job.durationSeconds ? formatTime(job.durationSeconds) : "--:--"}</strong>
                  </div>
                  <div className="stat-block">
                    <span>Elapsed</span>
                    <strong>{formatTime(progress.elapsedSeconds)}</strong>
                  </div>
                  <div className="stat-block">
                    <span>ETA</span>
                    <strong>{progress.etaSeconds !== undefined ? formatTime(progress.etaSeconds) : "Calculating"}</strong>
                  </div>
                  <div className="stat-block">
                    <span>Threads</span>
                    <strong>{processing.threads}</strong>
                  </div>
                  <div className="stat-block">
                    <span>Profile</span>
                    <strong>{processing.profile}</strong>
                  </div>
                </div>
              </div>

              <LogsPanel logs={logs} title="Live Logs" defaultExpanded={true} />
            </div>
          )}

          {view === "enhancements" && job && transcript && (
            <div className="results-workspace">
              <div className="glass-panel results-overview-card" style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', padding: '1rem', alignItems: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                  {job.sourceMedia?.originalName}
                  {job.sourceOrigin === "recording" && <span className="tag-outline" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', marginLeft: '0.5rem', verticalAlign: 'middle' }}>mic</span>}
                </div>
                <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.9rem' }}>
                  {job.durationSeconds && <span><span style={{ color: 'var(--text-muted)', marginRight: '4px' }}>Duration:</span>{formatTime(job.durationSeconds)}</span>}
                  <span><span style={{ color: 'var(--text-muted)', marginRight: '4px' }}>Language:</span>{job.detectedLanguage || 'auto'}</span>
                </div>
              </div>

              <aside className="summary-rail">
                <EnhancementPrompt job={job} onSubmit={handleSubmitEnhancements} onSkip={handleSkipEnhancements} />
              </aside>

              <div className="transcript-area">
                <div className="transcript-header">
                  <div className="transcript-heading">
                    <span className="transcript-kicker">Source transcript</span>
                    <h3>Transcript Preview</h3>
                  </div>
                </div>

                <AudioPlayer ref={audioPlayerRef} jobId={job.id} duration={job.durationSeconds} />
                <InlineProgressPanel job={job} stageKey={activePostStage} />

                <div className="transcript-body">
                  {groupedSegments.map((group, index) => (
                    <div className="speaker-group" key={index}>
                      <div className="speaker-meta">
                        <span className={`speaker-tag ${getSpeakerColorClass(group.speaker)}`}>
                          {group.speaker || 'Speaker'}
                        </span>
                        <button type="button" className="time-stamp" onClick={() => audioPlayerRef.current?.seek(group.start)}>
                          {formatTime(group.start)}
                        </button>
                      </div>
                      <div className="utterances">
                        {group.segments.map((seg, sIdx) => (
                          <p key={sIdx} style={{ margin: '0 0 0.5rem' }}>{seg.text}</p>
                        ))}
                      </div>
                    </div>
                  ))}
                  {groupedSegments.length === 0 && (
                    <p style={{ color: 'var(--text-muted)' }}>No usable transcript text available.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {view === "results" && job && job.status === "failed" && (
              <div className="processing-dash">
              <div className="glass-panel" style={{ borderLeft: '4px solid var(--danger)' }}>
                <h3 style={{ color: 'var(--danger)', marginBottom: '1rem' }}>Processing Failed</h3>
                <p style={{ marginBottom: '1rem' }}>{job.error}</p>
                <button className="btn-secondary" onClick={resetToUpload}>Try Again</button>
              </div>
              <LogsPanel logs={logs} title="Logs" defaultExpanded={true} />
            </div>
          )}

          {view === "results" && job && isCompleted && transcript && (
            <div className="results-workspace">

              <div className="glass-panel results-overview-card" style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', padding: '1rem', alignItems: 'center' }}>
                <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                  {job.sourceMedia?.originalName}
                  {job.sourceOrigin === "recording" && <span className="tag-outline" style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', marginLeft: '0.5rem', verticalAlign: 'middle' }}>mic</span>}
                </div>
                <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.9rem' }}>
                  {job.sourceMedia?.sizeBytes && <span><span style={{ color: 'var(--text-muted)', marginRight: '4px' }}>Size:</span>{formatBytes(job.sourceMedia?.sizeBytes)}</span>}
                  <span><span style={{ color: 'var(--text-muted)', marginRight: '4px' }}>Duration:</span>{formatTime(job.durationSeconds || 0)}</span>
                  <span><span style={{ color: 'var(--text-muted)', marginRight: '4px' }}>Language:</span>{job.detectedLanguage || 'auto'}</span>
                </div>
              </div>

              <aside className="summary-rail">
                <div className="glass-panel" style={{ padding: '1rem' }}>
                  <button className="btn-secondary" style={{ width: '100%' }} onClick={resetToUpload}>
                    New Session
                  </button>
                </div>

                {displaySummary ? (
                  <>
                    <div className="glass-panel">
                      <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Overview</h4>
                      <p style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>{displaySummary.headline}</p>
                      <p style={{ color: 'var(--text-muted)' }}>{displaySummary.brief}</p>
                    </div>

                    {displaySummary.keyDecisions && displaySummary.keyDecisions.length > 0 && (
                      <div className="glass-panel">
                        <h4 style={{ marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Key Decisions</h4>
                        <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'rgba(255,255,255,0.9)' }}>
                          {displaySummary.keyDecisions.map((dec, i) => <li key={i} style={{ marginBottom: '0.5rem' }}>{dec}</li>)}
                        </ul>
                      </div>
                    )}

                    {displaySummary.actionItems && displaySummary.actionItems.length > 0 && (
                      <div className="glass-panel">
                        <h4 style={{ marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Action Items</h4>
                        {displaySummary.actionItems.map((item, i) => (
                          <div className="task-card" key={i}>
                            <p>{item.task}</p>
                            <div className="task-meta">
                              {item.assignee && <span>@{item.assignee}</span>}
                              {item.status && <span style={{ color: 'var(--accent-primary)' }}>{item.status}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {displaySummary.sections && displaySummary.sections.length > 0 && displaySummary.sections.map((sec, i) => (
                      <div className="glass-panel" key={i}>
                        <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase' }}>{sec.title}</h4>
                        <p style={{ color: 'rgba(255,255,255,0.9)', marginBottom: '0.5rem', fontSize: '0.95rem' }}>{sec.summary}</p>
                        {sec.bullets && sec.bullets.length > 0 && (
                          <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'rgba(255,255,255,0.9)', fontSize: '0.9rem' }}>
                            {sec.bullets.map((b, bi) => <li key={bi} style={{ marginBottom: '0.3rem' }}>{b}</li>)}
                          </ul>
                        )}
                      </div>
                    ))}

                    {displaySummary.openQuestions && displaySummary.openQuestions.length > 0 && (
                      <div className="glass-panel">
                        <h4 style={{ marginBottom: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Open Questions</h4>
                        <ul style={{ margin: 0, paddingLeft: '1.2rem', color: 'rgba(255,255,255,0.9)', fontSize: '0.9rem' }}>
                          {displaySummary.openQuestions.map((q, i) => <li key={i} style={{ marginBottom: '0.3rem' }}>{q}</li>)}
                        </ul>
                      </div>
                    )}

                    <div className="glass-panel">
                      <h4 style={{ marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Summary Diagnostics</h4>
                      <div style={{ display: 'grid', gap: '0.75rem' }}>
                        <div>
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Strategy</div>
                          <strong>{describeSummaryStrategy(summaryDiagnostics)}</strong>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem' }}>
                          <div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Total</div>
                            <strong>{formatDurationValue(summaryDiagnostics?.totalDurationMs)}</strong>
                          </div>
                          <div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>LLM Calls</div>
                            <strong>{summaryDiagnostics?.requestCount ?? 0}</strong>
                          </div>
                          <div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Direct</div>
                            <strong>{formatDurationValue(summaryDiagnostics?.directDurationMs)}</strong>
                          </div>
                          <div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Reduce</div>
                            <strong>{formatDurationValue(summaryDiagnostics?.reduceDurationMs)}</strong>
                          </div>
                          <div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Local Merge</div>
                            <strong>{formatDurationValue(summaryDiagnostics?.mergeDurationMs)}</strong>
                          </div>
                          <div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Fallback</div>
                            <strong>{formatDurationValue(summaryDiagnostics?.fallbackDurationMs)}</strong>
                          </div>
                        </div>
                        {summaryDiagnostics && (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                            {summaryDiagnostics.usedFallback ? "Fallback summary was used. " : "Primary structured summary succeeded. "}
                            {summaryDiagnostics.usedMergedPartials ? "Local merge path used. " : ""}
                            {summaryDiagnostics.usedReduce ? "Final reduce request used. " : "Final reduce request skipped. "}
                            {summaryDiagnostics.sampled ? "Transcript input was sampled before summarization." : "Full selected transcript blocks were used."}
                          </div>
                        )}
                        {summaryDiagnostics?.chunks && summaryDiagnostics.chunks.length > 0 && (
                          <details>
                            <summary style={{ cursor: 'pointer', color: 'rgba(255,255,255,0.9)' }}>
                              Chunk timing details ({summaryDiagnostics.chunks.length})
                            </summary>
                            <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.75rem' }}>
                              {summaryDiagnostics.chunks.map((chunk) => (
                                <div key={chunk.chunkIndex} className="task-card">
                                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                    <strong>Chunk {chunk.chunkIndex}</strong>
                                    <span style={{ color: 'var(--text-muted)' }}>{formatDurationValue(chunk.durationMs)}</span>
                                  </div>
                                  <div className="task-meta">
                                    <span>{chunk.status}</span>
                                    <span>{chunk.inputChars} chars</span>
                                    <span>{chunk.summarySections} sections</span>
                                    <span>{chunk.actionItems} action items</span>
                                  </div>
                                  {chunk.error && <p style={{ marginTop: '0.5rem', color: 'var(--danger)' }}>{chunk.error}</p>}
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    </div>

                    {stageTimings.length > 0 && (
                      <div className="glass-panel">
                        <h4 style={{ marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Pipeline Timings</h4>
                        <div style={{ display: 'grid', gap: '0.5rem' }}>
                          {stageTimings.map((stageTiming) => (
                            <div key={stageTiming.key} className="task-card">
                              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <strong>{formatStageLabel(stageTiming.key)}</strong>
                                <span style={{ color: 'var(--text-muted)' }}>{formatDurationValue(stageTiming.durationMs)}</span>
                              </div>
                              <div className="task-meta">
                                <span>{stageTiming.label}</span>
                                <span>{stageTiming.completedAt ? "completed" : "in progress"}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  <div className="glass-panel">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <button className="btn-secondary" onClick={() => {
                          copyText(JSON.stringify(displaySummary, null, 2));
                          setCopiedState("summary");
                        }}>{copiedState === "summary" ? "Copied!" : "Copy Summary JSON"}</button>
                        <button className="btn-secondary" onClick={handleRetrySummarize} disabled={controlsDisabled}>
                          {getStageProgress(job, "summarize") !== null
                            ? `Regenerating... ${getStageProgress(job, "summarize")}%`
                            : "Regenerate Summary"}
                        </button>
                        <button className="btn-secondary" onClick={handleRetryDiarize} disabled={controlsDisabled}>
                          {getStageProgress(job, "diarize") !== null
                            ? `Running ID... ${getStageProgress(job, "diarize")}%`
                            : "Re-run Speaker ID"}
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="glass-panel">
                    <p style={{ color: 'var(--text-muted)' }}>No summary available.</p>
                    <button className="btn-secondary" onClick={handleRetrySummarize} disabled={controlsDisabled} style={{ marginTop: '1rem', width: '100%' }}>
                      {getStageProgress(job, "summarize") !== null
                        ? `Generating Summary... ${getStageProgress(job, "summarize")}%`
                        : "Generate Summary"}
                    </button>
                  </div>
                )}

                {!displaySummary && summaryDiagnostics && (
                  <div className="glass-panel">
                    <h4 style={{ marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Summary Diagnostics</h4>
                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                      <div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>Strategy</div>
                        <strong>{describeSummaryStrategy(summaryDiagnostics)}</strong>
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5 }}>
                        {summaryDiagnostics.usedFallback ? "Fallback summary was used. " : "Primary structured summary succeeded. "}
                        {summaryDiagnostics.usedMergedPartials ? "Local merge path used. " : ""}
                        {summaryDiagnostics.usedReduce ? "Final reduce request used. " : "Final reduce request skipped. "}
                        {summaryDiagnostics.sampled ? "Transcript input was sampled before summarization." : "Full selected transcript blocks were used."}
                      </div>
                    </div>
                  </div>
                )}

                {!displaySummary && stageTimings.length > 0 && (
                  <div className="glass-panel">
                    <h4 style={{ marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase' }}>Pipeline Timings</h4>
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                      {stageTimings.map((stageTiming) => (
                        <div key={stageTiming.key} className="task-card">
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <strong>{formatStageLabel(stageTiming.key)}</strong>
                            <span style={{ color: 'var(--text-muted)' }}>{formatDurationValue(stageTiming.durationMs)}</span>
                          </div>
                          <div className="task-meta">
                            <span>{stageTiming.label}</span>
                            <span>{stageTiming.completedAt ? "completed" : "in progress"}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </aside>

                <div className="transcript-area">
                  <div className="transcript-header">
                    <div className="transcript-heading">
                      <span className="transcript-kicker">
                        {selectedVariant === "english" ? "Translated transcript" : "Source transcript"}
                      </span>
                      <h3>Transcript</h3>
                    </div>
                    <div className="transcript-toolbar">
                      <div className="control-strip" role="tablist" aria-label="Transcript variant">
                        <button
                          className={`control-btn ${selectedVariant === 'source' ? 'active' : ''}`}
                          onClick={() => setSelectedVariant('source')}
                          type="button"
                        >
                          Source
                        </button>
                        <button
                          className={`control-btn ${selectedVariant === 'english' ? 'active' : ''}`}
                          onClick={handleSelectEnglish}
                          type="button"
                        >
                          {getStageProgress(job, "translate") !== null
                            ? `Translation ${getStageProgress(job, "translate")}%`
                            : "Translation"}
                        </button>
                      </div>

                      <div className="control-strip control-strip-actions" aria-label="Transcript actions">
                        <button className="control-btn" type="button" onClick={() => {
                          copyText(visibleSegments.map(s => `[${formatTime(s.start)}] ${s.speaker || 'Unknown'}: ${s.text}`).join('\n'));
                          setCopiedState("transcript");
                        }}>{copiedState === "transcript" ? "Copied!" : "Copy"}</button>
                        <a href={getExportUrl(job.id, "txt", selectedVariant)} target="_blank" rel="noreferrer" className="control-btn">TXT</a>
                        <a href={getExportUrl(job.id, "srt", selectedVariant)} target="_blank" rel="noreferrer" className="control-btn">SRT</a>
                        <a href={getExportUrl(job.id, "json", selectedVariant)} target="_blank" rel="noreferrer" className="control-btn">JSON</a>
                      </div>
                    </div>
                  </div>

                  <AudioPlayer ref={audioPlayerRef} jobId={job.id} duration={job.durationSeconds} />
                  <InlineProgressPanel job={job} stageKey={activePostStage} />

                  <div className="transcript-body">
                    {groupedSegments.map((group, index) => (
                      <div className="speaker-group" key={index}>
                        <div className="speaker-meta">
                          <span className={`speaker-tag ${getSpeakerColorClass(group.speaker)}`}>
                            {group.speaker || 'Unknown'}
                          </span>
                          <button
                            type="button"
                            className="time-stamp"
                            onClick={() => audioPlayerRef.current?.seek(group.start)}
                          >
                            {formatTime(group.start)}
                          </button>
                        </div>
                        <div className="utterances">
                          {group.segments.map((seg, sIdx) => (
                            <p key={sIdx} style={{ margin: '0 0 0.5rem' }}>{seg.text}</p>
                          ))}
                        </div>
                      </div>
                    ))}
                    {groupedSegments.length === 0 && (
                      <p style={{ color: 'var(--text-muted)' }}>No usable transcript text available.</p>
                    )}
                  </div>
                </div>

                <div style={{ gridColumn: "1 / -1" }}>
                  <LogsPanel logs={logs} title="Processing Logs" defaultExpanded={false} />
                </div>
            </div>
          )}
        </div>
      </div>
      <ConfirmModal
        open={showTranslateConfirm}
        title="Translate transcript to English?"
        description="This transcript was not translated during the original run. Start English translation now and show progress here?"
        confirmLabel="Translate to English"
        onCancel={() => setShowTranslateConfirm(false)}
        onConfirm={handleRetryTranslate}
      />
    </div>
  );
}
