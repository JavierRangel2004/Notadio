import { resolveServiceLlm } from "./llm/index.js"
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

  return `You are a Senior Software Engineer monitoring a live technical meeting. Someone just addressed you as "${mention.mentionedAlias}".

STRICT RULES — follow them exactly:
- Behave as a Senior Dev. Provide a brief, highly technical insight, probable cause, or professional perspective based on the context.
- Keep the response to 2-3 sentences.
- Never invent hard commitments, specific dates, or concrete status updates not in the context.
- If proposing a technical approach (e.g., optimizing a DB query, debugging a webhook), mention standard industry concepts relevant to the context.
- Respond in the same language as the context.
- Do not start with "As an AI" or similar preambles.

Recent conversation context:
${contextText}

The mention that triggered this: "${mention.triggerText}"
Detected intent: ${mention.intent}

Response:`
}

/**
 * Calls the configured LLM provider to generate a grounded assistant response.
 * Returns the response text, or throws on failure.
 */
export async function requestAssistantResponse(
  mention: MentionEvent,
  contextSegments: LiveTranscriptSegment[],
  signal?: AbortSignal
): Promise<string> {
  const prompt = buildAssistantPrompt(mention, contextSegments)
  const { provider, model } = resolveServiceLlm("LIVE_ASSISTANT")

  const result = await provider.generate({
    model,
    prompt,
    temperature: 0.2,
    maxTokens: 120,
    contextSize: 4096,
    signal
  })

  return result.text
}
