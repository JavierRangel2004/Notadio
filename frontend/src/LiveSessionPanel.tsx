import { useState, useEffect, useRef } from "react"
import { useLiveSession, type LiveSessionPhase } from "./useLiveSession.js"
import type { SessionConfig, MentionEvent, LiveTranscriptSegment, TranslatedSegment } from "./liveApi.js"
import { AudioSettingsPanel, type AudioSettings } from "./AudioSettingsPanel.js"

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function intentLabel(intent: MentionEvent["intent"]): string {
  switch (intent) {
    case "question": return "They are asking you a question"
    case "task_assignment": return "Task assigned"
    case "information_request": return "They are asking you for this info"
    case "greeting": return "Greeting detected"
    default: return "Mention"
  }
}

type Props = {
  onJobCreated: (jobId: string) => void
}

export function LiveSessionPanel({ onJobCreated }: Props) {
  const session = useLiveSession()

  const [aliasInput, setAliasInput] = useState("")
  const [aliasList, setAliasList] = useState<string[]>([])
  const [enableAssistant, setEnableAssistant] = useState(false)
  
  const [showSubtitles, setShowSubtitles] = useState(false)

  const [audioSettings, setAudioSettings] = useState<AudioSettings>({
    mode: "mic",
    micDeviceId: ""
  })

  const transcriptEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [session.confirmedSegments.length, session.provisionalSegments.length])

  // When session finishes, hand off jobId to parent
  useEffect(() => {
    if (session.phase === "done" && session.jobId) {
      onJobCreated(session.jobId)
    }
  }, [session.phase, session.jobId, onJobCreated])

  function addAlias(): void {
    const trimmed = aliasInput.trim()
    if (!trimmed || aliasList.includes(trimmed)) return
    setAliasList((prev) => [...prev, trimmed])
    setAliasInput("")
  }

  function removeAlias(alias: string): void {
    setAliasList((prev) => prev.filter((a) => a !== alias))
  }

  async function handleStart(): Promise<void> {
    const cfg: SessionConfig = {
      aliases: aliasList,
      enableAssistant,
      assistantContextWindowSegments: 30
    }
    await session.start(cfg, audioSettings.mode, audioSettings.micDeviceId)
  }

  // --- Idle / Config state ---
  if (session.phase === "idle") {
    return (
      <div className="live-session-panel glass-panel">
        <div className="live-session-header">
          <h2 className="section-title">Live Session</h2>
          <p className="live-session-subtitle">
            Transcription streams in real time. Aliases are detected as you speak.
          </p>
        </div>

        <div className="live-session-config">
          <div className="live-alias-section">
            <label className="live-label">Your name / aliases</label>
            <p className="live-hint">
              Spoken occurrences of these words will create mention alerts.
            </p>
            <div className="live-alias-input-row">
              <input
                className="live-alias-input"
                type="text"
                placeholder="e.g. Alice"
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    addAlias()
                  }
                }}
              />
              <button className="btn-secondary" onClick={addAlias}>
                Add
              </button>
            </div>
            {aliasList.length > 0 && (
              <div className="live-alias-tags">
                {aliasList.map((alias) => (
                  <span key={alias} className="live-alias-tag">
                    {alias}
                    <button
                      className="live-alias-remove"
                      onClick={() => removeAlias(alias)}
                      aria-label={`Remove ${alias}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="live-assistant-toggle">
            <label className="live-toggle-label">
              <input
                type="checkbox"
                checked={enableAssistant}
                onChange={(e) => setEnableAssistant(e.target.checked)}
              />
              <span>Enable AI response suggestions</span>
            </label>
            <p className="live-hint">Requires Ollama. Off by default.</p>
          </div>

          <div className="live-assistant-toggle">
            <label className="live-toggle-label">
              <input
                type="checkbox"
                checked={showSubtitles}
                onChange={(e) => setShowSubtitles(e.target.checked)}
              />
              <span>Show translated subtitles</span>
            </label>
            <p className="live-hint">
              Live translation to configured target language. Requires LIVE_TRANSLATION_ENABLED on the server.
            </p>
          </div>
          
          <AudioSettingsPanel 
             settings={audioSettings} 
             onChange={setAudioSettings} 
          />
        </div>

        <button className="btn-primary live-start-btn" onClick={() => void handleStart()}>
          Start Live Session
        </button>
      </div>
    )
  }

  // --- Connecting ---
  if (session.phase === "connecting") {
    return (
      <div className="live-session-panel glass-panel">
        <div className="live-session-connecting">
          <div className="live-pulse" />
          <span>Connecting…</span>
        </div>
      </div>
    )
  }

  // --- Error ---
  if (session.phase === "error") {
    return (
      <div className="live-session-panel glass-panel">
        <div className="live-session-error">
          <p className="live-error-msg">{session.errorMessage ?? "An error occurred"}</p>
          <button className="btn-secondary" onClick={session.reset}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  // --- Stopping ---
  if (session.phase === "stopping") {
    return (
      <div className="live-session-panel glass-panel">
        <div className="live-session-connecting">
          <div className="live-pulse" />
          <span>Finalizing session — building batch job…</span>
        </div>
      </div>
    )
  }

  // --- Recording ---
  const isRecording = session.phase === "recording"

  return (
    <div className="live-session-panel glass-panel">
      {/* Header bar */}
      <div className="live-session-topbar">
        <div className="live-session-status">
          {isRecording && <span className="live-rec-dot" />}
          <span className="live-elapsed">{formatTime(session.elapsedSeconds)}</span>
          <span className="live-frame-count">{session.totalFrames} frames</span>
        </div>
        {isRecording && (
          <button className="btn-danger live-stop-btn" onClick={session.stop}>
            Stop &amp; Process
          </button>
        )}
      </div>

      <div className="live-session-body">
        {/* Live Transcript */}
        <div className="live-transcript-panel glass-panel highlight">
          <div className="live-transcript-header">
            <span className="section-label">Live Transcript</span>
            {session.provisionalSegments.length > 0 && (
              <span className="live-provisional-badge">Transcribing…</span>
            )}
          </div>
          <div className="live-transcript-scroll">
            {session.confirmedSegments.length === 0 && session.provisionalSegments.length === 0 && (
              <p className="live-transcript-empty">
                Listening… transcript will appear as speech is detected.
              </p>
            )}
            {(session.confirmedSegments.length > 0 || session.provisionalSegments.length > 0) && (
              <div className="live-transcript-flow">
                {session.confirmedSegments.map((seg, i) => (
                  <InlineConfirmedSegment key={seg.id} seg={seg} mentions={session.mentions} index={i} />
                ))}
                {session.provisionalSegments.map((seg, i) => {
                  const needsSpace = (i > 0 || session.confirmedSegments.length > 0) && !",.!?".includes(seg.text[0] ?? "")
                  return (
                    <span key={seg.id} className="live-segment-inline live-segment--provisional">
                      {needsSpace ? " " + seg.text : seg.text}
                    </span>
                  )
                })}
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>

        {/* Translated Subtitles */}
        {showSubtitles && session.translatedSegments.size > 0 && (
          <div className="live-subtitle-panel glass-panel">
            <div className="live-subtitle-header">
              <span className="section-label">Translated Subtitles</span>
            </div>
            <div className="live-subtitle-scroll">
              <div className="live-subtitle-flow">
                {session.confirmedSegments.map((seg, i) => {
                  const translated = session.translatedSegments.get(seg.id)
                  if (!translated) return null
                  const needsSpace = i > 0 && !",.!?".includes(translated.text[0] ?? "")
                  return (
                    <span key={seg.id} className="live-segment-inline live-segment--translated">
                      {needsSpace ? " " + translated.text : translated.text}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Mentions Panel */}
        {session.mentions.length > 0 && (
          <div className="live-mentions-panel">
            <div className="live-mentions-header">
              <span className="section-label">Mentions</span>
              <span className="live-mention-count">{session.mentions.length}</span>
            </div>
            <div className="live-mentions-list">
              {session.mentions.map((mention) => (
                <MentionCard 
                  key={mention.id} 
                  mention={mention} 
                  onAskAi={session.askAi} 
                  onCopyPrompt={(m) => {
                    const ctx = session.confirmedSegments.filter(s => s.start <= m.detectedAt + 10).slice(-30);
                    const text = ctx.map(s => `[${s.start.toFixed(1)}s] ${s.text.trim()}`).join("\n");
                    const prompt = `You are a Senior Software Engineer monitoring a live technical meeting. Someone just addressed you as "${m.mentionedAlias}".\n\nSTRICT RULES:\n- Behave as a Senior Dev. Provide a brief, highly technical insight, probable cause, or professional perspective based on the context.\n- Keep the response to 2-3 sentences.\n- Never invent hard commitments, specific dates, or concrete status updates.\n- If proposing a technical approach, mention standard industry concepts relevant to the context.\n- Respond in the same language as the context.\n- Do not start with "As an AI".\n\nRecent conversation context:\n${text}\n\nThe mention that triggered this: "${m.triggerText}"\nDetected intent: ${m.intent}\n\nResponse:`;
                    navigator.clipboard.writeText(prompt).catch(() => {});
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function InlineConfirmedSegment({
  seg,
  mentions,
  index
}: {
  seg: LiveTranscriptSegment
  mentions: MentionEvent[]
  index: number
}) {
  const isMentionTrigger = mentions.some((m) => m.segmentIds.includes(seg.id))
  const needsSpace = index > 0 && !",.!?".includes(seg.text[0] ?? "")
  return (
    <span
      className={`live-segment-inline live-segment--confirmed${isMentionTrigger ? " live-segment--mention" : ""}`}
    >
      {needsSpace ? " " + seg.text : seg.text}
    </span>
  )
}

function MentionCard({ 
  mention, 
  onAskAi,
  onCopyPrompt
}: { 
  mention: MentionEvent; 
  onAskAi: (id: string) => void;
  onCopyPrompt: (mention: MentionEvent) => void;
}) {
  const showAskButton = mention.assistantStatus === "pending" || mention.assistantStatus === "skipped"
  return (
    <div className="live-mention-card glass-panel">
      <div className="live-mention-card-header">
        <span className="live-mention-alias">@ {mention.mentionedAlias}</span>
        <span className="live-mention-time">{formatTime(Math.floor(mention.detectedAt))}</span>
        <span className="live-mention-intent">{intentLabel(mention.intent)}</span>
      </div>
      <p className="live-mention-text">{mention.triggerText}</p>
      <div className="live-mention-actions">
        <button className="btn-mention-ask" onClick={() => onCopyPrompt(mention)}>
          Copy Prompt
        </button>
        {showAskButton && (
          <button className="btn-mention-ask" onClick={() => onAskAi(mention.id)}>
            Ask Ollama AI
          </button>
        )}
        {mention.assistantStatus === "generating" && (
          <p className="live-mention-assistant live-mention-assistant--generating">
            Generating response…
          </p>
        )}
        {mention.assistantStatus === "ready" && mention.assistantResponse && (
          <p className="live-mention-assistant live-mention-assistant--ready">
            {mention.assistantResponse}
          </p>
        )}
        {mention.assistantStatus === "failed" && (
          <button className="btn-mention-ask" onClick={() => onAskAi(mention.id)}>
            Retry AI
          </button>
        )}
      </div>
    </div>
  )
}
