import { FormEvent, useEffect, useRef, useState } from "react";
import {
  getExportUrl,
  getJob,
  getSummary,
  getTranscript,
  JobPayload,
  JobProcessingProfile,
  JobProgress,
  MeetingSummary,
  retryDiarize,
  retrySummarize,
  subscribeToJob,
  TranscriptPayload,
  TranscriptSegment,
  TranscriptVariant,
  uploadMedia
} from "./api";

const ACCEPTED_TYPES = "audio/*,video/*";
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

export function App() {
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<JobPayload | null>(null);
  const [transcript, setTranscript] = useState<TranscriptPayload | null>(null);
  const [summary, setSummary] = useState<MeetingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<"source" | "english">("source");
  const [retryingStage, setRetryingStage] = useState<string | null>(null);
  const [copiedState, setCopiedState] = useState<"summary" | "transcript" | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const logPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "processing")) return;
    const unsubscribe = subscribeToJob(
      job.id,
      (updatedJob) => setJob(updatedJob),
      () => {
        void getJob(job.id)
          .then((nextJob) => setJob(nextJob))
          .catch((pollError) => {
            setError(pollError instanceof Error ? pollError.message : "Failed to refresh job");
          });
      }
    );
    return unsubscribe;
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (!job || job.status !== "completed") return;
    const controller = new AbortController();
    Promise.all([
      getTranscript(job.id, controller.signal),
      getSummary(job.id, controller.signal).catch(() => null)
    ])
      .then(([transcriptPayload, summaryPayload]) => {
        setTranscript(transcriptPayload);
        setSummary(summaryPayload);
        if (!transcriptPayload.english) setSelectedVariant("source");
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load transcript");
      });
    return () => controller.abort();
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (!logPanelRef.current) return;
    logPanelRef.current.scrollTop = logPanelRef.current.scrollHeight;
  }, [job?.logs]);

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
      const { jobId } = await uploadMedia(file);
      const createdJob = await getJob(jobId);
      setJob(createdJob);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleRetrySummarize() {
    if (!job) return;
    setRetryingStage("summarize");
    try {
      const newSummary = await retrySummarize(job.id);
      setSummary(newSummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setRetryingStage(null);
    }
  }

  async function handleRetryDiarize() {
    if (!job) return;
    setRetryingStage("diarize");
    try {
      await retryDiarize(job.id);
      const refreshed = await getTranscript(job.id);
      setTranscript(refreshed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry diarization failed");
    } finally {
      setRetryingStage(null);
    }
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
  const visibleSegments = visibleTranscript?.segments ?? [];
  const groupedSegments = groupSegments(visibleSegments);
  const displayUploadName = getDisplayName(file?.name);
  
  const isProcessing = job?.status === "processing" || job?.status === "queued";
  const isCompleted = job?.status === "completed";

  function announce(message: string) {
    setLiveMessage("");
    window.setTimeout(() => setLiveMessage(message), 10);
  }

  return (
    <div className="app-shell">
      <div className="sr-only" aria-live="polite">{liveMessage}</div>

      <div className="brand-board">
        {/* LEFT COLUMN: BRAND & TYPOGRAPHY & MOTION */}
        <aside className="board-col board-col-left">
          <div className="board-module">
            <h3 className="module-title module-title-light">Brand Concepts</h3>
            <div className="logo-display">NOTADIO</div>
          </div>
          
          <div className="board-module grid-2">
            <div>
              <h3 className="module-title module-title-light">Logo</h3>
              <div className="logo-lockup">
                <div className="brand-icon">
                  <span/><span/><span/>
                </div>
                NOTADIO
              </div>
            </div>
            <div>
              <h3 className="module-title module-title-light">Icon</h3>
              <div className="brand-icon" style={{transform: 'scale(1.5)', transformOrigin: 'left center'}}>
                  <span/><span/><span/>
              </div>
            </div>
          </div>

          <div className="board-module typo-showcase">
            <h3 className="module-title module-title-light">Typography Direction</h3>
            <h1>AI-Powered Productivity</h1>
            <h2>Heading</h2>
            <p className="t-sub">Sample subheading</p>
            <p className="t-body">Body text</p>
            <p className="t-body" style={{marginTop: '1rem'}}>
              Seamless meeting summaries, instant translation, and accurate audio diarization.
            </p>
          </div>

          <div className="board-module">
            <h3 className="module-title module-title-light">Motion & Interaction Inspiration</h3>
            <div className="motion-grid">
              <div className="motion-card">
                <div className="circle-pulse"></div>
                <span>Smooth real-time AI processing animations</span>
              </div>
              <div className="motion-card">
                <div className="mic-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="22"></line></svg>
                </div>
                <span>Active audio effect recording</span>
              </div>
            </div>
          </div>
        </aside>

        {/* CENTER COLUMN: MAIN APP WORKSPACE */}
        <main className="board-col board-col-center">
          <div className="board-module">
            <h3 className="module-title module-title-light">Color Palette</h3>
            <div className="palette-grid">
               <div className="swatch" style={{background: '#0A0510'}}>#0A0510</div>
               <div className="swatch" style={{background: '#1A0B2E'}}>#1A0B2E</div>
               <div className="swatch" style={{background: '#F8F9FA', color: '#0A0510'}}>#F8F9FA</div>
               <div className="swatch" style={{background: '#A09DB0', color: '#0A0510'}}>#A09DB0</div>
               <div className="swatch" style={{background: '#9E1B32'}}>#9E1B32</div>
               <div className="swatch" style={{background: '#5D2A7A'}}>#5D2A7A</div>
            </div>
          </div>

          <div className="board-module" style={{ flex: 1 }}>
            <h3 className="module-title module-title-light">Website UI Concepts</h3>
            
            <div className="main-app-container">
              <nav className="app-nav">
                <div className="app-nav-logo">
                  <div className="brand-icon">
                    <span/><span/><span/>
                  </div>
                  NOTADIO
                </div>
                <div className="app-nav-links">
                  <span>Summaries</span>
                  <span>Translation</span>
                  <span>Diarization</span>
                </div>
              </nav>

              <div className="app-content">
                {error && (
                  <div style={{ background: 'var(--danger)', color: '#fff', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
                    {error}
                    <button onClick={() => setError(null)} style={{background: 'transparent', border:'none', color:'#fff', cursor:'pointer'}}>Close</button>
                  </div>
                )}

                {/* IDLE / UPLOAD STATE */}
                {!job && (
                  <div className="hero-upload">
                    <h2>Transform Your Meetings with Intelligent AI</h2>
                    <p style={{color: 'var(--text-muted)'}}>Upload your audio to extract speaker-aware transcripts, task summaries, and decisions.</p>
                    
                    <form 
                      className={`upload-dropzone ${isDragOver ? 'drag-over' : ''}`}
                      onSubmit={handleSubmit}
                      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                      onDragLeave={() => setIsDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragOver(false);
                        const dropped = e.dataTransfer.files?.[0];
                        if (dropped) setFile(dropped);
                      }}
                    >
                      <input 
                        type="file" 
                        accept={ACCEPTED_TYPES}
                        className="upload-input"
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                      />
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                      
                      {file ? (
                        <div style={{textAlign: 'center'}}>
                          <strong>{displayUploadName}</strong>
                          <p style={{fontSize: '0.85rem', color: 'var(--text-muted)'}}>{formatBytes(file.size)}</p>
                        </div>
                      ) : (
                        <div style={{textAlign: 'center'}}>
                          <strong>Select a file</strong>
                          <p style={{fontSize: '0.85rem', color: 'var(--text-muted)'}}>or drag and drop here</p>
                        </div>
                      )}

                      <button className="btn-primary" type="submit" disabled={!file || isUploading}>
                        {isUploading ? "Uploading..." : "Start Transcription"}
                      </button>
                    </form>

                    <div className="feature-cards">
                      <div className="feature-card">
                        <h4>Summaries</h4>
                        <p style={{color: 'var(--text-muted)', fontSize: '0.9rem'}}>Action items and meeting overview</p>
                      </div>
                      <div className="feature-card">
                        <h4>Translation</h4>
                        <p style={{color: 'var(--text-muted)', fontSize: '0.9rem'}}>Translate to English in real-time</p>
                      </div>
                      <div className="feature-card">
                        <h4>Diarization</h4>
                        <p style={{color: 'var(--text-muted)', fontSize: '0.9rem'}}>Accurate speaker identification</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* PROCESSING STATE */}
                {job && isProcessing && (
                  <div className="processing-dash">
                    <div className="glass-panel highlight">
                      <div className="status-header">
                        <h3>{job.sourceMedia?.originalName || 'Processing File...'}</h3>
                        <span style={{color: 'var(--accent-primary)', fontWeight: 600}}>{job.stage}</span>
                      </div>
                      
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: `${progress.overallPct}%` }} />
                      </div>
                      <div className="progress-meta">
                        <span>{Math.round(progress.overallPct)}% Complete</span>
                        <span>{progress.stageKey}</span>
                      </div>

                      <div className="stats-row" style={{marginTop: '2rem'}}>
                        <div className="stat-block">
                          <span>Elapsed</span>
                          <strong>{formatTime(progress.elapsedSeconds)}</strong>
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

                    <div className="glass-panel">
                      <h4 style={{marginBottom: '1rem'}}>Live Logs</h4>
                      <div className="log-box" ref={logPanelRef}>
                        {logs.join('\n')}
                      </div>
                    </div>
                  </div>
                )}

                {/* RESULTS STATE */}
                {job && isCompleted && transcript && (
                  <div className="results-workspace">
                    
                    <aside className="summary-rail">
                      <div className="glass-panel" style={{padding: '1rem'}}>
                        <button className="btn-secondary" style={{width: '100%'}} onClick={() => {
                          setJob(null); setFile(null); setTranscript(null); setSummary(null);
                        }}>
                          Process New File
                        </button>
                      </div>

                      {summary ? (
                        <>
                          <div className="glass-panel">
                            <h4 style={{marginBottom: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase'}}>Overview</h4>
                            <p style={{fontSize: '1.1rem', marginBottom: '1rem'}}>{summary.headline}</p>
                            <p style={{color: 'var(--text-muted)'}}>{summary.brief}</p>
                          </div>

                          {summary.actionItems && summary.actionItems.length > 0 && (
                            <div className="glass-panel">
                              <h4 style={{marginBottom: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem', textTransform: 'uppercase'}}>Action Items</h4>
                              {summary.actionItems.map((item, i) => (
                                <div className="task-card" key={i}>
                                  <p>{item.task}</p>
                                  <div className="task-meta">
                                    {item.assignee && <span>@{item.assignee}</span>}
                                    {item.status && <span style={{color: 'var(--accent-primary)'}}>{item.status}</span>}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="glass-panel">
                            <div style={{display: 'flex', flexDirection: 'column', gap: '0.5rem'}}>
                              <button className="btn-secondary" onClick={handleRetrySummarize} disabled={retryingStage !== null}>
                                {retryingStage === 'summarize' ? 'Regenerating...' : 'Regenerate Summary'}
                              </button>
                              <button className="btn-secondary" onClick={handleRetryDiarize} disabled={retryingStage !== null}>
                                {retryingStage === 'diarize' ? 'Running ID...' : 'Re-run Speaker ID'}
                              </button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="glass-panel">
                          <p style={{color: 'var(--text-muted)'}}>No summary available.</p>
                          <button className="btn-secondary" onClick={handleRetrySummarize} disabled={retryingStage !== null} style={{marginTop: '1rem', width: '100%'}}>
                            Generate Summary
                          </button>
                        </div>
                      )}
                    </aside>

                    <div className="transcript-area">
                      <div className="transcript-header">
                        <div className="control-strip">
                          <button 
                            className={`control-btn ${selectedVariant === 'source' ? 'active' : ''}`}
                            onClick={() => setSelectedVariant('source')}
                          >
                            Source
                          </button>
                          <button 
                            className={`control-btn ${selectedVariant === 'english' ? 'active' : ''}`}
                            onClick={() => setSelectedVariant('english')}
                            disabled={!transcript.english}
                          >
                            Translation
                          </button>
                        </div>

                        <div className="control-strip">
                          <a href={getExportUrl(job.id, "txt", selectedVariant)} target="_blank" rel="noreferrer" className="control-btn">TXT</a>
                          <a href={getExportUrl(job.id, "srt", selectedVariant)} target="_blank" rel="noreferrer" className="control-btn">SRT</a>
                        </div>
                      </div>

                      <div className="transcript-body">
                        {groupedSegments.map((group, index) => (
                          <div className="speaker-group" key={index}>
                            <div className="speaker-meta">
                              <span className={`speaker-tag ${getSpeakerColorClass(group.speaker)}`}>
                                {group.speaker || 'Unknown'}
                              </span>
                              <span className="time-stamp">{formatTime(group.start)}</span>
                            </div>
                            <div className="utterances">
                              {group.segments.map((seg, sIdx) => (
                                <p key={sIdx} style={{margin: '0 0 0.5rem'}}>{seg.text}</p>
                              ))}
                            </div>
                          </div>
                        ))}
                        {groupedSegments.length === 0 && (
                          <p style={{color: 'var(--text-muted)'}}>No usable transcript text available.</p>
                        )}
                      </div>
                    </div>

                  </div>
                )}
              </div>
            </div>
          </div>
        </main>

        {/* RIGHT COLUMN: UI COMPONENTS & MOOD */}
        <aside className="board-col board-col-right">
          <div className="board-module">
            <h3 className="module-title module-title-light">UI Components</h3>
            <div className="ui-components-stack">
              
              <div>
                <p style={{color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.5rem'}}>Primary Actions</p>
                <div className="ui-row">
                  <button className="btn-primary" style={{flex: 1}}>Buy Now</button>
                </div>
                <div className="ui-row" style={{marginTop: '0.5rem'}}>
                  <button className="tag-outline active">Primary Action</button>
                  <button className="tag-outline">Translation</button>
                  <button className="tag-outline">Diarization</button>
                </div>
              </div>

              <div>
                <p style={{color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.5rem'}}>Audio Player Controls</p>
                <div className="audio-player-mock">
                  <div className="audio-timeline">
                    <span>0:00</span>
                    <div className="audio-bar"></div>
                    <span>0:30</span>
                  </div>
                  <div className="audio-controls">
                    <span></span>
                    <span className="play"></span>
                    <span></span>
                  </div>
                </div>
              </div>

              <div>
                <p style={{color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '0.5rem'}}>Speaker Identification Tags</p>
                <div className="speaker-tags-mock">
                  <span className="spk-tag speaker-color-0">Speaker 1</span>
                  <span className="spk-tag speaker-color-1">Speaker 2</span>
                  <span className="spk-tag speaker-color-2">Speaker 3</span>
                  <span className="spk-tag speaker-color-4">Speaker 4</span>
                </div>
              </div>

            </div>
          </div>

          <div className="board-module">
            <h3 className="module-title module-title-light">Brand Keywords</h3>
            <div className="keyword-cloud">
              <span className="kw">Intelligent</span>
              <span className="kw highlight">Seamless</span>
              <span className="kw highlight">Powerful</span>
              <span className="kw">Premium</span>
              <span className="kw">Accurate</span>
              <span className="kw highlight">Contemporary</span>
              <span className="kw">Secure</span>
            </div>
          </div>

          <div className="board-module">
            <h3 className="module-title module-title-light">Product Mood References</h3>
            <div className="mood-grid">
              <div className="mood-card"></div>
              <div className="mood-card"></div>
              <div className="mood-card" style={{gridColumn: '1 / -1'}}></div>
            </div>
          </div>
        </aside>

      </div>
    </div>
  );
}
