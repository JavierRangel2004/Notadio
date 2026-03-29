import { config } from "../config.js"
import { resolveServiceLlm } from "./llm/index.js"
import type { LiveTranscriptSegment, TranslatedSegment } from "../types.js"

/**
 * Translates newly confirmed live transcript segments into the configured
 * target language. Returns only the translations for the supplied segments.
 *
 * Design choices:
 * - Only confirmed segments are translated (provisional change too fast).
 * - Segments are batched to reduce LLM round-trips.
 * - The original transcript is never modified.
 * - Translation failures are logged but do not break the live session.
 */

function buildTranslationPrompt(
  segments: LiveTranscriptSegment[],
  sourceLang: string,
  targetLang: string
): string {
  const items = segments.map((s, i) => ({ index: i, text: s.text }))

  return `You translate transcript segments from ${sourceLang} to ${targetLang}.
Return ONLY valid JSON with this exact shape:
{"translations":[{"index":0,"text":"..."}]}

Rules:
1. Keep exactly one output item per input segment, preserving index order.
2. Translate naturally — do not transliterate or leave words untranslated unless they are proper nouns.
3. Do not summarize, merge, omit, or add content.
4. If a segment is already in ${targetLang}, return it as-is.
5. Keep translations concise — these are live subtitles.

Segments:
${JSON.stringify(items)}`
}

type TranslationResponse = {
  translations: { index: number; text: string }[]
}

function parseTranslationResponse(raw: string, expectedCount: number): string[] {
  const parsed = JSON.parse(raw) as TranslationResponse
  if (!Array.isArray(parsed.translations)) {
    throw new Error("Missing translations array in response")
  }

  const result = new Array<string>(expectedCount).fill("")
  for (const item of parsed.translations) {
    if (typeof item.index === "number" && item.index >= 0 && item.index < expectedCount) {
      result[item.index] = typeof item.text === "string" ? item.text.trim() : ""
    }
  }
  return result
}

/**
 * Translates a batch of confirmed segments.
 * Returns TranslatedSegment[] keyed by original segment id.
 */
export async function translateLiveSegments(
  segments: LiveTranscriptSegment[],
  signal?: AbortSignal
): Promise<TranslatedSegment[]> {
  if (segments.length === 0) return []

  const { provider, model } = resolveServiceLlm("LIVE_TRANSLATION")
  const targetLang = config.liveTranslationTargetLang
  const sourceLang = config.liveTranslationSourceLang

  const prompt = buildTranslationPrompt(segments, sourceLang, targetLang)

  const result = await provider.generate({
    model,
    prompt,
    temperature: 0.1,
    maxTokens: segments.length * 80,
    json: true,
    signal
  })

  const texts = parseTranslationResponse(result.text, segments.length)

  return segments.map((seg, i) => ({
    segmentId: seg.id,
    text: texts[i] || seg.text,
    targetLang
  }))
}
