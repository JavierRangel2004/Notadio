import { v4 as uuidv4 } from "uuid"
import type { LiveTranscriptSegment, MentionEvent, MentionEventIntent, SessionConfig } from "../types.js"

/**
 * Strips accents and lowercases text for locale-independent matching.
 * Matches the normalizeLoopText pattern used elsewhere in the codebase.
 */
export function normalizeMentionText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Builds a word-boundary regex for each alias.
 * Uses a non-word boundary lookahead/lookbehind that works for Latin scripts.
 */
export function buildAliasPatterns(aliases: string[]): Map<string, RegExp> {
  const patterns = new Map<string, RegExp>()
  for (const alias of aliases) {
    const normalized = normalizeMentionText(alias)
    if (!normalized) continue
    const escaped = normalized.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
    // \b works well for ASCII; for accented chars we use (?<!\w)...(?!\w)
    const pattern = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "i")
    patterns.set(alias, pattern)
  }
  return patterns
}

/**
 * Scans segments for alias matches. Returns one result per (segment, alias) hit.
 * NOTE: This detects alias *occurrences*, not true addressee detection.
 * A mention like "Javier already did that" will also fire — the context window
 * and intent classification help distinguish, but are not perfect.
 */
export function detectMentions(
  segments: LiveTranscriptSegment[],
  patterns: Map<string, RegExp>
): Array<{ segment: LiveTranscriptSegment; alias: string }> {
  const results: Array<{ segment: LiveTranscriptSegment; alias: string }> = []
  for (const segment of segments) {
    const normalized = normalizeMentionText(segment.text)
    for (const [alias, pattern] of patterns) {
      if (pattern.test(normalized)) {
        results.push({ segment, alias })
      }
    }
  }
  return results
}

/**
 * Heuristic intent classifier. Runs synchronously in < 1ms.
 * Classifies the full context window text (multi-sentence), not just the trigger segment.
 */
export function classifyIntent(text: string): MentionEventIntent {
  const lower = text.toLowerCase()

  // Question patterns (Spanish + English)
  if (/[?¿]/.test(text)) return "question"
  if (/\b(qué|que|cómo|como|cuándo|cuando|dónde|donde|por qué|por que|quién|quien|cuál|cual)\b/.test(lower))
    return "question"
  if (/\b(what|how|when|where|why|who|which|can you|could you|do you|would you)\b/.test(lower))
    return "question"

  // Task assignment patterns
  if (
    /\b(por favor|please|necesito que|need you to|te pido|i need|podrias|podrías)\b/.test(lower)
  )
    return "task_assignment"
  if (
    /\b(haz|make|do|create|send|write|look up|find|check|prepare|review|encárgate|encargat|revisa|manda|envía|actualiza)\b/.test(
      lower
    )
  )
    return "task_assignment"

  // Information request patterns
  if (/\b(dime|tell me|show me|explain|sabes|do you know|i want to know|id like to know|cuéntame)\b/.test(lower))
    return "information_request"

  // Greeting patterns
  if (/^(hey|hola|hi|hello|buenos|buenas|oye|eh)\b/.test(lower.trim())) return "greeting"

  return "unknown"
}

/**
 * Creates a MentionEvent from finalized capture data.
 */
export function buildMentionEvent(
  sessionId: string,
  alias: string,
  capturedSegments: LiveTranscriptSegment[],
  config: SessionConfig
): MentionEvent {
  const triggerText = capturedSegments.map((s) => s.text.trim()).join(" ")
  const intent = classifyIntent(triggerText)
  const firstSegment = capturedSegments[0]

  return {
    id: uuidv4(),
    sessionId,
    mentionedAlias: alias,
    triggerText,
    detectedAt: firstSegment?.start ?? 0,
    segmentIds: capturedSegments.map((s) => s.id),
    intent,
    assistantStatus: config.enableAssistant ? "pending" : "skipped"
  }
}
