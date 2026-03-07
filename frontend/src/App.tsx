import { FormEvent, useEffect, useRef, useState } from "react";
import {
  getExportUrl,
  getJob,
  getTranscript,
  JobPayload,
  TranscriptPayload,
  uploadMedia
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
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) {
        window.clearTimeout(pollRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "processing")) {
      return;
    }

    pollRef.current = window.setTimeout(async () => {
      try {
        const nextJob = await getJob(job.id);
        setJob(nextJob);
      } catch (pollError) {
        setError(pollError instanceof Error ? pollError.message : "Failed to refresh job");
      }
    }, 1500);
  }, [job]);

  useEffect(() => {
    if (!job || job.status !== "completed") {
      return;
    }

    void getTranscript(job.id)
      .then((payload) => {
        setTranscript(payload);
        if (!payload.english) {
          setSelectedVariant("source");
        }
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Failed to load transcript");
      });
  }, [job]);

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
            <dl>
              <div>
                <dt>Language</dt>
                <dd>{job.detectedLanguage ?? "Pending"}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{job.durationSeconds ? formatTime(job.durationSeconds) : "Pending"}</dd>
              </div>
            </dl>
            {job.error ? <p className="inline-error">{job.error}</p> : null}
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
        </section>
      ) : null}

      {transcript && visibleTranscript ? (
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
        </section>
      ) : null}
    </main>
  );
}
