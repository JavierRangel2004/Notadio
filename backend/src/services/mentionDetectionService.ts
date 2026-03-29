import { v4 as uuidv4 } from "uuid"
import type { LiveTranscriptSegment, MentionEvent, MentionEventIntent, SessionConfig } from "../types.js"

/**
 * Strips accents and lowercases text for locale-independent matching.
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
 */
export function buildAliasPatterns(aliases: string[]): Map<string, RegExp> {
  const patterns = new Map<string, RegExp>()
  for (const alias of aliases) {
    const normalized = normalizeMentionText(alias)
    if (!normalized) continue
    const escaped = normalized.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
    const pattern = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, "i")
    patterns.set(alias, pattern)
  }
  return patterns
}

/**
 * Scans segments for alias matches. Returns one result per (segment, alias) hit.
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
 * Classifies the mention trigger sentence, not the full context dump.
 */
export function classifyIntent(text: string): MentionEventIntent {
  const lower = text.toLowerCase()

  // Question patterns (Spanish + English)
  if (/[?¿]/.test(text)) return "question"
  if (/\b(qué|que|cómo|como|cuándo|cuando|dónde|donde|por qué|por que|quién|quien|cuál|cual)\b/.test(lower))
    return "question"
  if (/\b(what|how|when|where|why|who|which|can you|could you|do you|would you)\b/.test(lower))
    return "question"
  if (/\b(crees que|podrías|podrias|ves viable|es posible|puedes|te parece)\b/.test(lower))
    return "question"

  // Task assignment patterns
  if (/\b(por favor|please|necesito que|need you to|te pido|i need|podrias|podrías)\b/.test(lower))
    return "task_assignment"
  if (/\b(haz|make|do|create|send|write|look up|find|check|prepare|review|encárgate|revisa|manda|envía|actualiza|échale|echarle|echarle)\b/.test(lower))
    return "task_assignment"

  // Information request patterns
  if (/\b(dime|tell me|show me|explain|sabes|do you know|cuéntame|dame|comparte)\b/.test(lower))
    return "information_request"

  // Greeting patterns
  if (/^(hey|hola|hi|hello|buenos|buenas|oye|eh)\b/.test(lower.trim())) return "greeting"

  return "unknown"
}

/**
 * Extracts the most relevant sentence from context — the one containing
 * the alias mention. Falls back to first sentence with a question mark.
 * Pure NLP, no LLM call.
 */
function extractTriggerSentence(
  capturedSegments: LiveTranscriptSegment[],
  alias: string
): { triggerSentence: string; contextSummary: string } {
  const fullText = capturedSegments.map((s) => s.text.trim()).join(" ")

  // Split into sentences (handle Spanish punctuation)
  const sentences = fullText
    .split(/(?<=[.!?¿¡])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5)

  const aliasNorm = normalizeMentionText(alias)
  const aliasPattern = new RegExp(`(?<![\\w])${aliasNorm.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}(?![\\w])`, "i")

  // Find the sentence that contains the alias mention
  let triggerSentence = ""
  for (const s of sentences) {
    if (aliasPattern.test(normalizeMentionText(s))) {
      triggerSentence = s
      // If this sentence also has a question mark, it's the best match
      if (/[?¿]/.test(s)) break
    }
  }

  // Fallback: first sentence with a question mark
  if (!triggerSentence) {
    triggerSentence = sentences.find((s) => /[?¿]/.test(s)) || ""
  }

  // Fallback: first sentence mentioning task-like verbs near the alias
  if (!triggerSentence) {
    triggerSentence = sentences.find((s) =>
      /\b(crees|podrías|podrias|puedes|ves|revisa|échale|echarle|check|review|look)\b/i.test(s)
    ) || ""
  }

  // Final fallback: last sentence (most recent context)
  if (!triggerSentence && sentences.length > 0) {
    triggerSentence = sentences[sentences.length - 1]
  }

  // Build a short context summary (1-2 sentences before the trigger, deduped)
  const triggerIdx = sentences.indexOf(triggerSentence)
  const contextParts: string[] = []
  if (triggerIdx > 0) {
    contextParts.push(sentences[triggerIdx - 1])
  }

  return {
    triggerSentence: triggerSentence || fullText.slice(0, 200),
    contextSummary: contextParts.join(" ")
  }
}

/**
 * Creates a MentionEvent from finalized capture data.
 * Extracts just the key sentence instead of dumping all context.
 * Assistant always starts as "pending" — user triggers it manually.
 */
export function buildMentionEvent(
  sessionId: string,
  alias: string,
  capturedSegments: LiveTranscriptSegment[],
  _config: SessionConfig
): MentionEvent {
  const { triggerSentence, contextSummary } = extractTriggerSentence(capturedSegments, alias)
  const displayText = contextSummary
    ? contextSummary + " " + triggerSentence
    : triggerSentence

  const intent = classifyIntent(triggerSentence)
  const lastSegment = capturedSegments[capturedSegments.length - 1]

  return {
    id: uuidv4(),
    sessionId,
    mentionedAlias: alias,
    triggerText: displayText,
    detectedAt: lastSegment?.end ?? 0,
    segmentIds: capturedSegments.map((s) => s.id),
    intent,
    // Always "pending" — user presses "Ask AI" to trigger
    assistantStatus: "pending"
  }
}
