import { FormEvent, useEffect, useRef, useState } from "react";
import {
  getExportUrl,
  getJob,
  JobProcessingProfile,
  getTranscript,
  JobProgress,
  JobPayload,
  TranscriptPayload,
  uploadMedia,
  subscribeToJob
} from "./api";

const ACCEPTED_TYPES = "audio/*,video/*";

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

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<JobPayload | null>(null);
  const [transcript, setTranscript] = useState<TranscriptPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<"source" | "english">("source");
  const logPanelRef = useRef<HTMLPreElement | null>(null);

  // SSE subscription for real-time job updates (replaces polling)
  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "processing")) {
      return;
    }

    const unsubscribe = subscribeToJob(
      job.id,
      (updatedJob) => setJob(updatedJob),
      () => {
        // SSE connection error — fall back to a single poll
        void getJob(job.id)
          .then((nextJob) => setJob(nextJob))
          .catch((pollError) => {
            setError(pollError instanceof Error ? pollError.message : "Failed to refresh job");
          });
      }
    );

    return unsubscribe;
  }, [job?.id, job?.status]);

  // Fetch transcript when job completes
  useEffect(() => {
    if (!job || job.status !== "completed") {
      return;
    }

    const controller = new AbortController();

    void getTranscript(job.id, controller.signal)
      .then((payload) => {
        setTranscript(payload);
        if (!payload.english) {
          setSelectedVariant("source");
        }
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load transcript");
      });

    return () => controller.abort();
  }, [job?.id, job?.status]);

  // Auto-scroll log panel
  useEffect(() => {
    if (!logPanelRef.current) {
      return;
    }

    logPanelRef.current.scrollTop = logPanelRef.current.scrollHeight;
  }, [job?.logs]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setError("Choose an audio or video file first.");
      return;
    }

    setError(null);
    setJob(null);
    setTranscript(null);
    setIsUploading(true);

    try {
      const { jobId } = await uploadMedia(file);
      const createdJob = await getJob(jobId);
      setJob(createdJob);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  const visibleTranscript =
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
  const runtimeWarnings = processing.capabilityWarnings ?? [];
  const hasVisibleTranscriptContent = Boolean(
    visibleTranscript && (visibleTranscript.text.trim().length > 0 || visibleTranscript.segments.length > 0)
  );

  return (
    <main className="page-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">LOCAL-FIRST TRANSCRIPTION</p>
          <h1>Upload a meeting recording and export a full transcript.</h1>
          <p className="lede">
            Notadio runs on your machine with free local tooling. The first release turns audio or
            video into timestamped transcript files without depending on paid APIs.
          </p>
        </div>
        <form className="upload-panel" onSubmit={handleSubmit}>
          <label className="file-drop">
            <span>Drop audio/video here or browse</span>
            <input
              accept={ACCEPTED_TYPES}
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <div className="file-meta">
            <span>{file ? file.name : "No file selected"}</span>
            <span>{file ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : "audio/*, video/*"}</span>
          </div>
          <button type="submit" disabled={isUploading}>
            {isUploading ? "Uploading..." : "Start transcription"}
          </button>
        </form>
      </section>

      {error ? <section className="alert error">{error}</section> : null}

      {job ? (
        <section className="status-grid">
          <article className="status-card">
            <p className="eyebrow">JOB STATUS</p>
            <div className={`pill ${job.status}`}>{job.status}</div>
            <h2>{job.sourceMedia?.originalName ?? "Processing upload"}</h2>
            <p>{job.stage}</p>
            <div className="progress-shell" aria-label="Job progress">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${progress.overallPct}%` }} />
              </div>
              <div className="progress-meta">
                <strong>{Math.round(progress.overallPct)}%</strong>
                <span>{progress.stageKey}</span>
              </div>
            </div>
            <dl>
              <div>
                <dt>Language</dt>
                <dd>{job.detectedLanguage ?? "Pending"}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{job.durationSeconds ? formatTime(job.durationSeconds) : "Pending"}</dd>
              </div>
              <div>
                <dt>Elapsed</dt>
                <dd>{formatTime(progress.elapsedSeconds)}</dd>
              </div>
              <div>
                <dt>ETA</dt>
                <dd>{progress.etaSeconds !== undefined ? formatTime(progress.etaSeconds) : "Estimating"}</dd>
              </div>
            </dl>
            {job.error ? <p className="inline-error">{job.error}</p> : null}
          </article>

          <article className="status-card">
            <p className="eyebrow">PROCESSING</p>
            <h2>{processing.profile}</h2>
            <p>{processing.deviceSummary}</p>
            <dl>
              <div>
                <dt>Threads</dt>
                <dd>{processing.threads > 0 ? processing.threads : "Auto"}</dd>
              </div>
              <div>
                <dt>Translation</dt>
                <dd>{processing.translationEnabled ? "Enabled" : "Skipped"}</dd>
              </div>
              <div>
                <dt>Runtime</dt>
                <dd>{processing.runtimeBackend ?? "Pending"}</dd>
              </div>
            </dl>
            <p>{processing.runtimeSummary ?? "Waiting for runtime summary"}</p>
            {runtimeWarnings.length > 0 ? (
              <ul className="warning-list">
                {runtimeWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </article>

          <article className="status-card">
            <p className="eyebrow">WARNINGS</p>
            {job.warnings.length > 0 ? (
              <ul className="warning-list">
                {job.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p>No warnings.</p>
            )}
          </article>

          <article className="status-card log-card">
            <p className="eyebrow">LIVE LOGS</p>
            <pre className="log-console" ref={logPanelRef}>
              {logs.length > 0 ? logs.join("\n") : "Waiting for process output..."}
            </pre>
          </article>
        </section>
      ) : null}

      {transcript ? (
        <section className="transcript-shell">
          <div className="transcript-toolbar">
            <div>
              <p className="eyebrow">TRANSCRIPT</p>
              <h2>{selectedVariant === "english" ? "English export" : "Source transcript"}</h2>
            </div>
            <div className="toolbar-actions">
              <div className="segmented">
                <button
                  className={selectedVariant === "source" ? "active" : ""}
                  onClick={() => setSelectedVariant("source")}
                  type="button"
                >
                  Source
                </button>
                <button
                  className={selectedVariant === "english" ? "active" : ""}
                  disabled={!transcript.english}
                  onClick={() => setSelectedVariant("english")}
                  type="button"
                >
                  English
                </button>
              </div>
              <div className="export-actions">
                <a href={getExportUrl(job!.id, "txt", selectedVariant)} target="_blank" rel="noreferrer">
                  TXT
                </a>
                <a href={getExportUrl(job!.id, "srt", selectedVariant)} target="_blank" rel="noreferrer">
                  SRT
                </a>
                <a href={getExportUrl(job!.id, "json", selectedVariant)} target="_blank" rel="noreferrer">
                  JSON
                </a>
              </div>
            </div>
          </div>

          {visibleTranscript && hasVisibleTranscriptContent ? (
            <>
              <article className="transcript-card">
                <p className="transcript-text">{visibleTranscript.text}</p>
              </article>

              <div className="segments-grid">
                {visibleTranscript.segments.map((segment, index) => (
                  <article className="segment-card" key={`${segment.start}-${segment.end}-${index}`}>
                    <header>
                      <span>{formatTime(segment.start)}</span>
                      <span>{formatTime(segment.end)}</span>
                    </header>
                    {segment.speaker ? <p className="speaker-tag">{segment.speaker}</p> : null}
                    <p>{segment.text}</p>
                  </article>
                ))}
              </div>
            </>
          ) : (
            <article className="transcript-card invalid-transcript">
              <p className="eyebrow">INVALID RESULT</p>
              <h2>Transcript output is empty.</h2>
              <p className="transcript-text">
                The job completed, but the transcript payload contains no usable text or segments. Check the live logs
                and backend runtime summary for parser or Whisper runtime issues.
              </p>
            </article>
          )}
        </section>
      ) : null}
    </main>
  );
}
