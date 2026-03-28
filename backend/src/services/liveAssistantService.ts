import { config } from "../config.js"
import type { LiveTranscriptSegment, MentionEvent, MentionEventIntent } from "../types.js"

/**
 * Builds a strictly grounded prompt for the assistant.
 * Rules enforce context-only answers to prevent hallucination.
 */
export function buildAssistantPrompt(
  mention: MentionEvent,
  contextSegments: LiveTranscriptSegment[]
): string {
  const contextText = contextSegments
    .map((s) => `[${s.start.toFixed(1)}s] ${s.text.trim()}`)
    .join("\n")

  return `You are monitoring a live meeting. Someone just addressed "${mention.mentionedAlias}".

STRICT RULES — follow them exactly:
- Respond ONLY based on information explicitly present in the context below
- If the question cannot be answered from the context, respond with "I'll check on that" or "Let me confirm"
- Never invent facts, dates, statuses, names, or commitments
- Keep the response to 1-2 sentences maximum
- Respond in the same language as the context
- Do not start with "As an AI" or similar preambles

Recent conversation context:
${contextText}

The mention that triggered this: "${mention.triggerText}"
Detected intent: ${mention.intent}

Response:`
}

/**
 * Calls Ollama to generate a grounded assistant response.
 * Returns the response text, or throws on failure.
 */
export async function requestAssistantResponse(
  mention: MentionEvent,
  contextSegments: LiveTranscriptSegment[],
  signal?: AbortSignal
): Promise<string> {
  const prompt = buildAssistantPrompt(mention, contextSegments)

  const response = await fetch(`${config.ollamaBaseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ollamaModel,
      prompt,
      stream: false,
      options: {
        temperature: 0.2,
        num_predict: 120,
        num_ctx: 4096
      }
    }),
    signal
  })

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as { response?: string }
  const text = data.response?.trim()
  if (!text) {
    throw new Error("Ollama returned empty response")
  }

  return text
}
