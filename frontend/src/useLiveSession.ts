import { useState, useRef, useCallback, useEffect } from "react"
import {
  connectWebSocket,
  sendStartSession,
  sendStopSession,
  sendRequestAssistant,
  startAudioCapture,
  type SessionConfig,
  type WsServerMessage,
  type LiveTranscriptSegment,
  type MentionEvent,
  type TranslatedSegment,
  type AudioCaptureHandles,
  type AudioSourceMode
} from "./liveApi.js"

export type LiveSessionPhase =
  | "idle"
  | "connecting"
  | "recording"
  | "stopping"
  | "done"
  | "error"

export type UseLiveSessionReturn = {
  phase: LiveSessionPhase
  sessionId: string | null
  jobId: string | null
  confirmedSegments: LiveTranscriptSegment[]
  provisionalSegments: LiveTranscriptSegment[]
  mentions: MentionEvent[]
  /** Map of segmentId → translated text for live subtitles. */
  translatedSegments: Map<string, TranslatedSegment>
  elapsedSeconds: number
  errorMessage: string | null
  totalFrames: number
  start: (cfg: SessionConfig, mode?: AudioSourceMode, micDeviceId?: string) => Promise<void>
  stop: () => void
  reset: () => void
  askAi: (mentionId: string) => void
}

export function useLiveSession(): UseLiveSessionReturn {
  const [phase, setPhase] = useState<LiveSessionPhase>("idle")
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [confirmedSegments, setConfirmedSegments] = useState<LiveTranscriptSegment[]>([])
  const [provisionalSegments, setProvisionalSegments] = useState<LiveTranscriptSegment[]>([])
  const [mentions, setMentions] = useState<MentionEvent[]>([])
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [totalFrames, setTotalFrames] = useState(0)
  const [translatedSegments, setTranslatedSegments] = useState<Map<string, TranslatedSegment>>(new Map())

  const wsRef = useRef<WebSocket | null>(null)
  const captureRef = useRef<AudioCaptureHandles | null>(null)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  const stopElapsedTimer = useCallback(() => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
  }, [])

  const startElapsedTimer = useCallback(() => {
    startTimeRef.current = Date.now()
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
  }, [])

  const handleMessage = useCallback((msg: WsServerMessage) => {
    switch (msg.type) {
      case "session_created":
        setSessionId(msg.sessionId)
        setPhase("recording")
        startElapsedTimer()
        break

      case "session_resumed":
        setSessionId(msg.sessionId)
        setConfirmedSegments(msg.confirmed)
        setMentions(msg.mentions)
        setPhase("recording")
        startElapsedTimer()
        break

      case "transcript":
        if (msg.confirmed.length > 0) {
          setConfirmedSegments((prev) => {
            const next = [...prev]
            for (const c of msg.confirmed) {
              const idx = next.findIndex((x) => x.id === c.id)
              if (idx !== -1) next[idx] = c
              else next.push(c)
            }
            return next
          })
        }
        setProvisionalSegments(msg.provisional)
        break

      case "translated_segments":
        setTranslatedSegments((prev) => {
          const next = new Map(prev)
          for (const seg of msg.segments) {
            next.set(seg.segmentId, seg)
          }
          return next
        })
        break

      case "mention_detected":
        setMentions((prev) => [...prev, msg.mention])
        break

      case "mention_updated":
        setMentions((prev) =>
          prev.map((m) =>
            m.id === msg.mentionId
              ? {
                  ...m,
                  assistantStatus: msg.assistantStatus as MentionEvent["assistantStatus"],
                  assistantResponse: msg.assistantResponse ?? m.assistantResponse
                }
              : m
          )
        )
        break

      case "session_stopped":
        setJobId(msg.jobId)
        setPhase("done")
        stopElapsedTimer()
        break

      case "error":
        setErrorMessage(msg.message)
        setPhase("error")
        stopElapsedTimer()
        break
    }
  }, [startElapsedTimer, stopElapsedTimer])

  const start = useCallback(async (cfg: SessionConfig, mode: AudioSourceMode = "mic", micDeviceId?: string): Promise<void> => {
    setPhase("connecting")
    setErrorMessage(null)
    setConfirmedSegments([])
    setProvisionalSegments([])
    setMentions([])
    setTranslatedSegments(new Map())
    setElapsedSeconds(0)
    setTotalFrames(0)
    setSessionId(null)
    setJobId(null)

    return new Promise((resolve, reject) => {
      const ws = connectWebSocket(
        handleMessage,
        () => {
          // WebSocket closed unexpectedly — leave phase for backend grace period
          stopElapsedTimer()
          captureRef.current?.stop()
          captureRef.current = null
        },
        (e) => {
          setErrorMessage("WebSocket connection failed")
          setPhase("error")
          stopElapsedTimer()
          captureRef.current?.stop()
          captureRef.current = null
          reject(e)
        }
      )
      wsRef.current = ws

      ws.onopen = async () => {
        try {
          const capture = await startAudioCapture(ws, (bytes) => {
            setTotalFrames((n) => n + 1)
            void bytes
          }, mode, micDeviceId)
          captureRef.current = capture
          sendStartSession(ws, cfg)
          resolve()
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Microphone access failed"
          setErrorMessage(msg)
          setPhase("error")
          ws.close()
          reject(err)
        }
      }
    })
  }, [handleMessage, stopElapsedTimer])

  const stop = useCallback((): void => {
    setPhase("stopping")
    stopElapsedTimer()
    captureRef.current?.stop()
    captureRef.current = null

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      sendStopSession(wsRef.current)
    }
  }, [stopElapsedTimer])

  const askAi = useCallback((mentionId: string): void => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      sendRequestAssistant(wsRef.current, mentionId)
    }
  }, [])

  const reset = useCallback((): void => {
    captureRef.current?.stop()
    captureRef.current = null
    wsRef.current?.close()
    wsRef.current = null
    stopElapsedTimer()
    setPhase("idle")
    setSessionId(null)
    setJobId(null)
    setConfirmedSegments([])
    setProvisionalSegments([])
    setMentions([])
    setTranslatedSegments(new Map())
    setElapsedSeconds(0)
    setErrorMessage(null)
    setTotalFrames(0)
  }, [stopElapsedTimer])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      captureRef.current?.stop()
      wsRef.current?.close()
      stopElapsedTimer()
    }
  }, [stopElapsedTimer])

  return {
    phase,
    sessionId,
    jobId,
    confirmedSegments,
    provisionalSegments,
    mentions,
    translatedSegments,
    elapsedSeconds,
    errorMessage,
    totalFrames,
    start,
    stop,
    reset,
    askAi
  }
}
