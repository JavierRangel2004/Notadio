import fs from "node:fs/promises"
import path from "node:path"
import { v4 as uuidv4 } from "uuid"
import { config } from "../config.js"
import { jobStore } from "../store/jobStore.js"
import { ensureDir, writeJsonFile } from "../utils/fs.js"
import { runCommand } from "../utils/process.js"
import { parseArgs } from "../utils/process.js"
import { PcmRingBuffer, buildWavBuffer } from "./pcmRingBuffer.js"
import { liveSessionStore } from "./liveSessionStore.js"
import {
  buildAliasPatterns,
  detectMentions,
  buildMentionEvent
} from "../services/mentionDetectionService.js"
import { requestAssistantResponse } from "../services/liveAssistantService.js"
import { translateLiveSegments } from "../services/liveTranslationService.js"
import {
  parseWhisperOutput,
  applyWhisperQualityArgs,
  trimTrailingHallucinatedLoop
} from "../services/transcriptionService.js"
import type {
  LiveSession,
  LiveTranscriptSegment,
  MentionEvent,
  SessionConfig,
  JobManifest
} from "../types.js"

// -------------------------------------------------------------------
// Types
// -------------------------------------------------------------------

type SendMessageFn = (msg: object) => void

type MentionCapture = {
  id: string
  alias: string
  segments: LiveTranscriptSegment[]
  deadline: number
  timer: ReturnType<typeof setTimeout>
}

type InternalSessionState = {
  session: LiveSession
  ringBuffer: PcmRingBuffer
  archiveFileHandle: fs.FileHandle
  aliasPatterns: Map<string, RegExp>
  mentionCaptures: Map<string, MentionCapture>
  /** Guard: true while a live translation request is in flight. */
  translationInFlight: boolean
  /** Segments waiting to be translated (queued while a request is in flight). */
  translationQueue: LiveTranscriptSegment[]
}

// -------------------------------------------------------------------
// Module-level state
// -------------------------------------------------------------------

const internalState = new Map<string, InternalSessionState>()
const sessionSenders = new Map<string, SendMessageFn>()
const transcriptionTimers = new Map<string, ReturnType<typeof setInterval>>()

// Global throttle: max concurrent whisper invocations across all live sessions
let globalActiveWindows = 0

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

function getSessionDir(sessionId: string): string {
  return path.join(config.storageRoot, "sessions", sessionId)
}

function normForDedup(text: string): string {
  return text.toLowerCase().replace(/[.,!?;:¿¡]/g, "").replace(/\s+/g, " ").trim()
}

function normWords(text: string): string[] {
  return normForDedup(text).split(" ").filter(Boolean)
}

/**
 * Word-level overlap ratio between two normalized strings.
 * Returns 0-1 where 1 means all words in the shorter text appear in the longer.
 */
function wordOverlapRatio(wordsA: string[], wordsB: string[]): number {
  if (wordsA.length === 0 || wordsB.length === 0) return 0
  const setB = new Set(wordsB)
  let matches = 0
  for (const w of wordsA) {
    if (setB.has(w)) matches++
  }
  return matches / Math.min(wordsA.length, wordsB.length)
}

/**
 * Checks if a candidate text is a duplicate of any recent confirmed segment.
 *
 * Uses two strategies:
 * 1. Timing-based: segments near the same absolute time with text overlap ≥ 0.6
 * 2. Content-based: regardless of timing, if a segment's words are ≥ 80% contained
 *    in an existing segment (catches Whisper re-segmenting same audio differently)
 *
 * Returns the index into confirmedSegments, or -1 if no duplicate found.
 */
function getDuplicateIndex(session: LiveSession, absStart: number, text: string): number {
  const candidateNorm = normForDedup(text)
  const candidateWords = normWords(text)
  if (candidateWords.length === 0) return -1

  const recent = session.confirmedSegments.slice(-40)
  const baseIdx = session.confirmedSegments.length - recent.length

  for (let i = recent.length - 1; i >= 0; i--) {
    const s = recent[i]
    const sNorm = normForDedup(s.text)
    const sWords = sNorm.split(" ").filter(Boolean)

    // Exact or substring match
    if (sNorm === candidateNorm || sNorm.includes(candidateNorm) || candidateNorm.includes(sNorm)) {
      return baseIdx + i
    }

    // Timing-close + moderate word overlap
    if (Math.abs(s.start - absStart) < 5.0 && wordOverlapRatio(candidateWords, sWords) >= 0.6) {
      return baseIdx + i
    }

    // Content-heavy overlap regardless of timing (Whisper re-segments)
    if (candidateWords.length >= 3 && wordOverlapRatio(candidateWords, sWords) >= 0.8) {
      return baseIdx + i
    }
  }
  return -1
}

/** Replace the value following any of `flags` in `args`, or append flag+value if absent. */
function setArgValue(args: string[], flags: string[], value: string): void {
  for (const flag of flags) {
    const idx = args.indexOf(flag)
    if (idx !== -1 && idx + 1 < args.length) {
      args[idx + 1] = value
      return
    }
  }
  args.push(flags[0]!, value)
}

function buildLiveWhisperArgs(inputPath: string, outputBase: string, aliases: string[] = []): string[] {
  const liveModel = config.liveWhisperModelPath ?? config.whisperModelPath

  // Live prompt = global vocabulary + this session's aliases (names/brands the
  // model should spell correctly during the call).
  const vocabulary = [config.whisperVocabulary, ...aliases].filter(Boolean).join(", ")

  let args = parseArgs(config.whisperArgs, {
    input: inputPath,
    model: liveModel,
    outputBase,
    vocabulary
  })

  // Same VAD / hallucination / max-len guards as the batch path.
  args = applyWhisperQualityArgs(args)

  // Pin language for Spanglish stability (auto re-detects per window otherwise).
  if (config.liveWhisperLanguage) {
    setArgValue(args, ["-l", "--language"], config.liveWhisperLanguage)
  }

  // Live-specific thread count.
  setArgValue(args, ["-t", "--threads"], String(config.liveWhisperThreads))

  return args
}

function sendToSession(sessionId: string, msg: object): void {
  sessionSenders.get(sessionId)?.(msg)
}

// -------------------------------------------------------------------
// Mention context window management
// -------------------------------------------------------------------

function detectAndProcessMentions(
  state: InternalSessionState,
  newSegments: LiveTranscriptSegment[]
): void {
  const session = state.session

  // Add new segments to all open capture windows
  for (const capture of state.mentionCaptures.values()) {
    if (Date.now() >= capture.deadline) continue
    for (const seg of newSegments) {
      if (!capture.segments.some((s) => s.id === seg.id)) {
        capture.segments.push(seg)
      }
    }
  }

  // Check for new alias hits in the new segments
  const hits = detectMentions(newSegments, state.aliasPatterns)
  for (const { segment, alias } of hits) {
    // Skip if this segment is already tracked in an open capture for this alias
    const alreadyTracked = [...state.mentionCaptures.values()].some(
      (c) => c.alias === alias && Date.now() < c.deadline && c.segments.some((s) => s.id === segment.id)
    )
    if (alreadyTracked) continue

    // Include up to 5 preceding confirmed segments for context
    const allConfirmed = session.confirmedSegments
    const triggerIdx = allConfirmed.findIndex((s) => s.id === segment.id)
    const contextStart = Math.max(0, triggerIdx - 5)
    const initialSegments = triggerIdx >= 0 ? allConfirmed.slice(contextStart) : [segment]

    const captureId = uuidv4()
    const timer = setTimeout(() => {
      void finalizeMentionCapture(state, captureId)
    }, config.liveMentionContextWindowMs)

    state.mentionCaptures.set(captureId, {
      id: captureId,
      alias,
      segments: [...initialSegments],
      deadline: Date.now() + config.liveMentionContextWindowMs,
      timer
    })
  }
}

async function finalizeMentionCapture(
  state: InternalSessionState,
  captureId: string
): Promise<void> {
  const capture = state.mentionCaptures.get(captureId)
  if (!capture) return

  state.mentionCaptures.delete(captureId)
  clearTimeout(capture.timer)

  const session = state.session

  // Dedup: skip if we already have a mention for this alias within 10 seconds
  const isDuplicate = session.mentionEvents.some(
    (m) => m.mentionedAlias === capture.alias && Math.abs(m.detectedAt - (capture.segments[capture.segments.length - 1]?.end ?? 0)) < 10
  )
  if (isDuplicate) return

  const mention = buildMentionEvent(session.id, capture.alias, capture.segments, session.config)
  session.mentionEvents.push(mention)

  sendToSession(session.id, { type: "mention_detected", mention })
  // Assistant is NOT auto-fired. User triggers it via "Ask AI" button.
}

/**
 * Triggers AI assistant for a specific mention (called from WS "request_assistant" message).
 */
export async function requestMentionAssistant(sessionId: string, mentionId: string): Promise<void> {
  const state = internalState.get(sessionId)
  if (!state) return

  const session = state.session
  const mention = session.mentionEvents.find((m) => m.id === mentionId)
  if (!mention) return
  if (mention.assistantStatus === "generating" || mention.assistantStatus === "ready") return

  if (!config.liveAssistantEnabled) {
    mention.assistantStatus = "skipped"
    sendToSession(sessionId, {
      type: "mention_updated",
      mentionId: mention.id,
      assistantStatus: "skipped"
    })
    return
  }

  mention.assistantStatus = "generating"
  sendToSession(sessionId, {
    type: "mention_updated",
    mentionId: mention.id,
    assistantStatus: "generating"
  })

  const contextSegments = session.confirmedSegments
    .filter((s) => s.start <= mention.detectedAt + 10)
    .slice(-(session.config.assistantContextWindowSegments))

  try {
    const response = await requestAssistantResponse(mention, contextSegments)
    mention.assistantResponse = response
    mention.assistantStatus = "ready"
    sendToSession(sessionId, {
      type: "mention_updated",
      mentionId: mention.id,
      assistantResponse: response,
      assistantStatus: "ready"
    })
  } catch {
    mention.assistantStatus = "failed"
    sendToSession(sessionId, {
      type: "mention_updated",
      mentionId: mention.id,
      assistantStatus: "failed"
    })
  }
}

// -------------------------------------------------------------------
// Live translation queue (serialized to avoid piling up on one model)
// -------------------------------------------------------------------

async function drainTranslationQueue(
  sessionId: string,
  state: InternalSessionState
): Promise<void> {
  if (state.translationInFlight) return
  if (state.translationQueue.length === 0) return

  state.translationInFlight = true
  const batch = state.translationQueue.splice(0, config.liveTranslationMaxBatch)

  try {
    const translated = await translateLiveSegments(batch)
    if (translated.length > 0) {
      sendToSession(sessionId, {
        type: "translated_segments",
        segments: translated
      })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    sendToSession(sessionId, { type: "log", message: `Translation error: ${msg}` })
  } finally {
    state.translationInFlight = false
    // If more segments queued while we were busy, drain again
    if (state.translationQueue.length > 0) {
      void drainTranslationQueue(sessionId, state)
    }
  }
}

// -------------------------------------------------------------------
// Window transcription
// -------------------------------------------------------------------

async function runWindowTranscription(sessionId: string): Promise<void> {
  const state = internalState.get(sessionId)
  if (!state) return

  const session = state.session
  if (session.isTranscribingWindow) return
  if (globalActiveWindows >= config.liveMaxConcurrentWindows) return
  if (state.ringBuffer.currentDurationMs < config.liveMinWindowMs) return

  session.isTranscribingWindow = true
  globalActiveWindows++

  const seq = ++session.windowSeq
  const windowDir = path.join(getSessionDir(sessionId), "windows")
  const wavPath = path.join(windowDir, `win_${seq}.wav`)
  const outputBase = path.join(windowDir, `win_${seq}`)
  const outputJsonPath = `${outputBase}.json`

  try {
    const windowData = state.ringBuffer.getWindow(config.liveWindowMs)
    if (!windowData) return

    const { samples, windowStartMs } = windowData
    const windowStartSec = windowStartMs / 1000
    const windowEndSec = windowStartSec + samples.length / 16000
    const confirmedCutoffSec = windowEndSec - config.liveOverlapMs / 1000

    // Build WAV directly from PCM — no ffmpeg needed
    const wavBuf = buildWavBuffer(samples)
    await fs.writeFile(wavPath, wavBuf)

    // Run whisper
    const args = buildLiveWhisperArgs(wavPath, outputBase, session.config.aliases)
    await runCommand(config.whisperCommand, args, { cwd: windowDir })

    // Parse output
    let whisperPayload: Parameters<typeof parseWhisperOutput>[0]
    try {
      const content = await fs.readFile(outputJsonPath, "utf8")
      whisperPayload = JSON.parse(content) as Parameters<typeof parseWhisperOutput>[0]
    } catch {
      return // whisper produced no JSON output — skip window
    }

    const parsed = parseWhisperOutput(whisperPayload, true)
    // Strip trailing hallucination loops (e.g. repeated phrases on silence).
    const { variant } = trimTrailingHallucinatedLoop(parsed)
    if (!variant || variant.segments.length === 0) return

    const newConfirmed: LiveTranscriptSegment[] = []
    const newProvisional: LiveTranscriptSegment[] = []

    for (const seg of variant.segments) {
      const absStart = windowStartSec + seg.start
      const absEnd = windowStartSec + seg.end
      const text = seg.text.trim()
      if (!text) continue

      if (absStart < confirmedCutoffSec) {
        const dupIdx = getDuplicateIndex(session, absStart, text)
        if (dupIdx !== -1) {
          const oldSeg = session.confirmedSegments[dupIdx]
          if (text.length > oldSeg.text.length) {
            oldSeg.text = text
            oldSeg.end = Math.round(absEnd * 100) / 100
            newConfirmed.push(oldSeg) // Send updated segment down to frontend
          }
        } else {
          newConfirmed.push({
            id: uuidv4(),
            start: Math.round(absStart * 100) / 100,
            end: Math.round(absEnd * 100) / 100,
            text,
            state: "confirmed",
            windowSeq: seq
          })
        }
      } else {
        newProvisional.push({
          id: uuidv4(),
          start: Math.round(absStart * 100) / 100,
          end: Math.round(absEnd * 100) / 100,
          text,
          state: "provisional",
          windowSeq: seq
        })
      }
    }

    if (newConfirmed.length > 0) {
      session.confirmedSegments.push(...newConfirmed)
      detectAndProcessMentions(state, newConfirmed)
    }
    session.provisionalSegments = newProvisional

    // Notify client
    sendToSession(sessionId, {
      type: "transcript",
      confirmed: newConfirmed,
      provisional: newProvisional
    })

    // Queue live translation for new confirmed segments (non-blocking, serialized)
    if (config.liveTranslationEnabled && newConfirmed.length > 0) {
      state.translationQueue.push(...newConfirmed)
      void drainTranslationQueue(sessionId, state)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    sendToSession(sessionId, { type: "log", message: `Window ${seq} error: ${msg}` })
  } finally {
    // Clean up temp files
    void fs.unlink(wavPath).catch(() => undefined)
    void fs.unlink(outputJsonPath).catch(() => undefined)
    // Clean up any extra whisper output files
    void fs.unlink(`${outputBase}.srt`).catch(() => undefined)
    void fs.unlink(`${outputBase}.txt`).catch(() => undefined)

    session.isTranscribingWindow = false
    globalActiveWindows--
  }
}

// -------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------

export async function createSession(
  cfg: SessionConfig,
  send: SendMessageFn
): Promise<LiveSession> {
  const sessionId = uuidv4()
  const sessionDir = getSessionDir(sessionId)
  await ensureDir(path.join(sessionDir, "windows"))

  const rawPath = path.join(sessionDir, "session.raw")
  const archiveFileHandle = await fs.open(rawPath, "w")

  const session: LiveSession = {
    id: sessionId,
    createdAt: new Date().toISOString(),
    status: "recording",
    config: cfg,
    confirmedSegments: [],
    provisionalSegments: [],
    mentionEvents: [],
    windowSeq: 0,
    totalFramesReceived: 0,
    sessionStartMs: Date.now(),
    totalPcmBytesWritten: 0,
    isTranscribingWindow: false
  }

  const state: InternalSessionState = {
    session,
    ringBuffer: new PcmRingBuffer(config.liveWindowMs + config.liveOverlapMs + 5000),
    archiveFileHandle,
    aliasPatterns: buildAliasPatterns(cfg.aliases),
    mentionCaptures: new Map(),
    translationInFlight: false,
    translationQueue: []
  }

  internalState.set(sessionId, state)
  sessionSenders.set(sessionId, send)
  liveSessionStore.set(session)

  // Start transcription interval
  const timer = setInterval(() => {
    void runWindowTranscription(sessionId)
  }, config.liveIntervalMs)
  transcriptionTimers.set(sessionId, timer)

  return session
}

export function resumeSession(sessionId: string, send: SendMessageFn): boolean {
  const state = internalState.get(sessionId)
  if (!state) return false

  const session = state.session
  if (session.status !== "disconnected") return false

  clearTimeout(session.reconnectTimer)
  session.reconnectTimer = undefined
  session.status = "recording"
  sessionSenders.set(sessionId, send)

  liveSessionStore.set(session)

  // Send catch-up packet
  send({
    type: "session_resumed",
    sessionId,
    confirmed: session.confirmedSegments,
    mentions: session.mentionEvents
  })

  return true
}

export function handleDisconnect(sessionId: string): void {
  const state = internalState.get(sessionId)
  if (!state) return

  const session = state.session
  if (session.status !== "recording") return

  session.status = "disconnected"
  session.reconnectTimer = setTimeout(() => {
    const current = liveSessionStore.get(sessionId)
    if (current?.status === "disconnected") {
      void finalizeSession(sessionId)
    }
  }, config.liveSessionGracePeriodMs)

  liveSessionStore.set(session)
}

export async function receiveFrame(sessionId: string, data: Buffer): Promise<void> {
  const state = internalState.get(sessionId)
  if (!state) return

  const session = state.session
  if (session.status !== "recording") return

  session.totalFramesReceived++
  session.totalPcmBytesWritten += data.length

  // Parse buffer as Int16 PCM
  const int16 = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.length / 2))
  const sessionOffsetMs = Date.now() - session.sessionStartMs
  state.ringBuffer.push(int16, sessionOffsetMs)

  // Append to archive (raw PCM bytes)
  await state.archiveFileHandle.write(data)
}

export async function finalizeSession(sessionId: string): Promise<string | null> {
  const state = internalState.get(sessionId)
  if (!state) return null

  const session = state.session
  if (session.status === "stopped" || session.status === "stopping") return session.jobId ?? null
  session.status = "stopping"

  // Stop transcription timer
  const timer = transcriptionTimers.get(sessionId)
  if (timer) {
    clearInterval(timer)
    transcriptionTimers.delete(sessionId)
  }

  // Finalize any pending mention captures
  for (const capture of [...state.mentionCaptures.values()]) {
    if (capture.segments.length > 0) {
      await finalizeMentionCapture(state, capture.id)
    }
  }

  // Run one last window transcription if enough audio
  if (state.ringBuffer.currentDurationMs >= config.liveMinWindowMs) {
    await runWindowTranscription(sessionId)
  }

  // Close archive file handle
  try {
    await state.archiveFileHandle.close()
  } catch {
    // ignore
  }

  const sessionDir = getSessionDir(sessionId)
  const rawPath = path.join(sessionDir, "session.raw")
  const wavPath = path.join(sessionDir, "session_audio.wav")

  // Verify archive has data
  const rawStat = await fs.stat(rawPath).catch(() => null)
  if (!rawStat || rawStat.size === 0) {
    session.status = "error"
    session.errorMessage = "No audio was recorded"
    liveSessionStore.set(session)
    internalState.delete(sessionId)
    sessionSenders.delete(sessionId)
    return null
  }

  // Convert raw PCM to WAV with one ffmpeg call
  try {
    await runCommand(config.ffmpegPath, [
      "-y",
      "-f", "s16le",
      "-ar", "16000",
      "-ac", "1",
      "-i", rawPath,
      "-c:a", "pcm_s16le",
      wavPath
    ])
  } catch (err) {
    session.status = "error"
    session.errorMessage = `Failed to convert session audio: ${err instanceof Error ? err.message : String(err)}`
    liveSessionStore.set(session)
    internalState.delete(sessionId)
    sessionSenders.delete(sessionId)
    return null
  }

  const wavStat = await fs.stat(wavPath).catch(() => null)
  if (!wavStat || wavStat.size === 0) {
    session.status = "error"
    session.errorMessage = "Audio conversion produced empty file"
    liveSessionStore.set(session)
    internalState.delete(sessionId)
    sessionSenders.delete(sessionId)
    return null
  }

  // Create batch job using the same pattern as /api/uploads
  const jobId = uuidv4()
  const jobDir = jobStore.getJobDir(jobId)
  const uploadsDir = path.join(jobDir, "uploads")
  await ensureDir(uploadsDir)

  const storedPath = path.join(uploadsDir, "source.wav")
  await fs.copyFile(wavPath, storedPath)

  const now = new Date().toISOString()
  const job: JobManifest = {
    id: jobId,
    status: "queued",
    stage: "Queued for processing",
    createdAt: now,
    updatedAt: now,
    sourceOrigin: "recording",
    sourceMedia: {
      originalName: `live-session-${sessionId.slice(0, 8)}.wav`,
      mimeType: "audio/wav",
      sizeBytes: wavStat.size,
      storedPath
    },
    warnings: [],
    logs: [
      `Live session finalized. ${session.confirmedSegments.length} segments confirmed during live phase.`
    ],
    artifacts: { source: [], english: [] }
  }

  await jobStore.save(job)

  // Write live transcript sidecar for frontend display while batch runs
  await writeJsonFile(path.join(jobDir, "live_transcript.json"), {
    sessionId,
    confirmedSegments: session.confirmedSegments,
    mentionEvents: session.mentionEvents
  })

  session.jobId = jobId
  session.status = "stopped"
  liveSessionStore.set(session)

  // Clean up internal state (session is done)
  internalState.delete(sessionId)
  sessionSenders.delete(sessionId)

  return jobId
}

export function getSession(sessionId: string): LiveSession | undefined {
  return liveSessionStore.get(sessionId)
}
