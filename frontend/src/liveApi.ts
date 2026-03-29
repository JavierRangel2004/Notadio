const WS_BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:8787/api")
  .replace(/^http/, "ws")
  .replace(/\/api$/, "")

export type LiveSegmentState = "confirmed" | "provisional"

export type AudioSourceMode = "mic" | "system" | "both"

export type LiveTranscriptSegment = {
  id: string
  start: number
  end: number
  text: string
  state: LiveSegmentState
  windowSeq: number
}

export type MentionEventIntent =
  | "question"
  | "task_assignment"
  | "information_request"
  | "greeting"
  | "unknown"

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

export type WsServerMessage =
  | { type: "session_created"; sessionId: string }
  | { type: "session_resumed"; sessionId: string; confirmed: LiveTranscriptSegment[]; mentions: MentionEvent[] }
  | { type: "transcript"; confirmed: LiveTranscriptSegment[]; provisional: LiveTranscriptSegment[] }
  | { type: "mention_detected"; mention: MentionEvent }
  | { type: "mention_updated"; mentionId: string; assistantResponse?: string; assistantStatus: string }
  | { type: "session_stopped"; jobId: string }
  | { type: "error"; message: string }
  | { type: "pong" }
  | { type: "log"; message: string }

export function connectWebSocket(
  onMessage: (msg: WsServerMessage) => void,
  onClose: () => void,
  onError: (e: Event) => void
): WebSocket {
  const ws = new WebSocket(`${WS_BASE}/api/sessions/ws`)
  ws.binaryType = "arraybuffer"

  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data as string) as WsServerMessage
      onMessage(msg)
    } catch {
      // ignore parse errors
    }
  }
  ws.onclose = onClose
  ws.onerror = onError

  return ws
}

export function sendStartSession(ws: WebSocket, cfg: SessionConfig): void {
  ws.send(JSON.stringify({ type: "start_session", config: cfg }))
}

export function sendResumeSession(ws: WebSocket, sessionId: string): void {
  ws.send(JSON.stringify({ type: "resume_session", sessionId }))
}

export function sendStopSession(ws: WebSocket): void {
  ws.send(JSON.stringify({ type: "stop_session" }))
}

export function sendPing(ws: WebSocket): void {
  ws.send(JSON.stringify({ type: "ping" }))
}

// AudioWorklet processor code as inline blob URL.
// Captures Float32 PCM from AudioContext (at 16kHz), converts to Int16, posts to main thread.
const WORKLET_CODE = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0]
    if (channel && channel.length > 0) {
      const int16 = new Int16Array(channel.length)
      for (let i = 0; i < channel.length; i++) {
        const s = Math.max(-1, Math.min(1, channel[i]))
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
      }
      this.port.postMessage(int16.buffer, [int16.buffer])
    }
    return true
  }
}
registerProcessor('pcm-capture', PcmCaptureProcessor)
`

export type AudioCaptureHandles = {
  stream: MediaStream
  audioContext: AudioContext
  workletNode: AudioWorkletNode
  stop: () => void
}

/**
 * Starts audio capture at 16kHz, sends Int16 PCM frames over the WebSocket.
 * The AudioContext is created at 16kHz so the browser resamples automatically.
 */
export async function startAudioCapture(
  ws: WebSocket,
  onFrame: (bytesCount: number) => void,
  mode: AudioSourceMode = "mic",
  micDeviceId?: string
): Promise<AudioCaptureHandles> {
  const customStreams: MediaStream[] = []

  try {
    if (mode === "mic" || mode === "both") {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
        video: false
      })
      customStreams.push(micStream)
    }

    if (mode === "system" || mode === "both") {
      const sysStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      })
      
      const audioTracks = sysStream.getAudioTracks()
      if (audioTracks.length === 0) {
        throw new Error("No system audio provided. Be sure to check 'Share tab audio' or 'Share system audio'.")
      }
      
      customStreams.push(sysStream)
    }
  } catch (err) {
    // If one fails (e.g. user cancelled), we should stop any streams we did manage to open
    for (const s of customStreams) {
      for (const t of s.getTracks()) t.stop()
    }
    throw err
  }

  if (customStreams.length === 0) {
    throw new Error("No audio streams acquired.")
  }

  // Combine tracks into one list just for bookkeeping/stopping
  const allTracks = customStreams.flatMap((s) => s.getTracks())
  const compositeStream = new MediaStream(allTracks)

  // Force 16kHz — browser resamples automatically
  const audioContext = new AudioContext({ sampleRate: 16000 })

  const blob = new Blob([WORKLET_CODE], { type: "application/javascript" })
  const workletUrl = URL.createObjectURL(blob)
  await audioContext.audioWorklet.addModule(workletUrl)
  URL.revokeObjectURL(workletUrl)

  const workletNode = new AudioWorkletNode(audioContext, "pcm-capture")

  // Create a source node for each audio stream and connect them to mix them
  const sources = customStreams.map((s) => {
    const sourceNode = audioContext.createMediaStreamSource(s)
    sourceNode.connect(workletNode)
    return sourceNode
  })

  workletNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(e.data)
      onFrame(e.data.byteLength)
    }
  }

  // Connect to destination to keep context alive (silent output)
  workletNode.connect(audioContext.destination)

  const stop = (): void => {
    workletNode.disconnect()
    sources.forEach(s => s.disconnect())
    void audioContext.close()
    for (const track of allTracks) track.stop()
  }

  return { stream: compositeStream, audioContext, workletNode, stop }
}
