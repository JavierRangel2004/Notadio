import type { LlmProvider, LlmGenerateOptions, LlmGenerateResult } from "./types.js"
import { config } from "../../config.js"
import { fetchWithTimeout } from "../../utils/fetchWithTimeout.js"

type ChatCompletionResponse = {
  choices?: {
    finish_reason?: string
    message?: Record<string, unknown>
  }[]
  error?: { message?: string }
}

function extractMessageText(message: Record<string, unknown> | undefined): string {
  if (!message) {
    return ""
  }

  const content = message.content
  if (typeof content === "string" && content.trim()) {
    return content.trim()
  }

  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (!part || typeof part !== "object") {
          return ""
        }

        const block = part as Record<string, unknown>
        if (typeof block.text === "string") {
          return block.text
        }

        if (typeof block.content === "string") {
          return block.content
        }

        return ""
      })
      .join("")
      .trim()

    if (joined) {
      return joined
    }
  }

  if (typeof message.text === "string" && message.text.trim()) {
    return message.text.trim()
  }

  for (const key of ["reasoning_content", "reasoning", "thinking"]) {
    const value = message[key]
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return ""
}

function describeEmptyResponse(data: ChatCompletionResponse, model: string): string {
  const choice = data.choices?.[0]
  const finishReason = choice?.finish_reason ?? "unknown"
  const apiError = data.error?.message?.trim()
  const parts = [`model=${model}`, `finish_reason=${finishReason}`]
  if (apiError) {
    parts.push(`api_error=${apiError}`)
  }
  return parts.join(", ")
}

/**
 * Provider that speaks the OpenAI /v1/chat/completions protocol.
 *
 * Works with:
 * - Ollama's OpenAI-compatible endpoint (http://localhost:11434/v1)
 * - OpenAI API (https://api.openai.com/v1)
 * - Groq (https://api.groq.com/openai/v1)
 * - Together AI (https://api.together.xyz/v1)
 * - OpenRouter (https://openrouter.ai/api/v1)
 * - OpenCode Zen (https://opencode.ai/zen/v1)
 * - Any other OpenAI-compatible endpoint
 */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly name = "openai-compatible"
  private baseUrl: string
  private apiKey: string

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "")
    this.apiKey = apiKey
  }

  private async requestCompletion(
    options: LlmGenerateOptions,
    useJsonMode: boolean,
    maxTokensOverride?: number
  ): Promise<{ text: string; data: ChatCompletionResponse }> {
    const messages: { role: string; content: string }[] = []

    if (options.system) {
      messages.push({ role: "system", content: options.system })
    }
    messages.push({ role: "user", content: options.prompt })

    const payload: Record<string, unknown> = {
      model: options.model,
      messages,
      stream: false
    }

    if (options.temperature !== undefined) payload.temperature = options.temperature
    const maxTokens = maxTokensOverride ?? options.maxTokens
    if (maxTokens !== undefined) payload.max_tokens = maxTokens
    if (useJsonMode) {
      payload.response_format = { type: "json_object" }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    }
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`
    }

    const response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: options.signal
    }, config.llmRequestTimeoutMs)

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(`OpenAI-compatible HTTP ${response.status}: ${body}`)
    }

    const data = (await response.json()) as ChatCompletionResponse
    const text = extractMessageText(data.choices?.[0]?.message)
    return { text, data }
  }

  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResult> {
    const wantsJson = Boolean(options.json)
    const baseMaxTokens = options.maxTokens ?? config.summaryMaxOutputTokens
    let { text, data } = await this.requestCompletion(options, wantsJson, baseMaxTokens)
    let finishReason = data.choices?.[0]?.finish_reason

    if (!text && wantsJson) {
      const fallback = await this.requestCompletion(options, false, baseMaxTokens)
      text = fallback.text
      data = fallback.data
      finishReason = data.choices?.[0]?.finish_reason
    }

    if (!text && finishReason === "length") {
      const expanded = await this.requestCompletion(options, false, Math.min(baseMaxTokens * 2, 16384))
      text = expanded.text
      data = expanded.data
    }

    if (!text) {
      throw new Error(
        `OpenAI-compatible provider returned empty response (${describeEmptyResponse(data, options.model)})`
      )
    }

    return { text }
  }

  /** Models offered by the endpoint (GET /models), e.g. OpenCode Zen's catalog. */
  async listModels(signal?: AbortSignal): Promise<string[]> {
    const headers: Record<string, string> = {}
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`
    }

    const response = await fetchWithTimeout(`${this.baseUrl}/models`, { headers, signal }, config.llmRequestTimeoutMs)
    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(`OpenAI-compatible HTTP ${response.status}: ${body}`)
    }

    const data = (await response.json()) as { data?: { id?: string; owned_by?: string; status?: string }[] }
    return (data.data ?? [])
      .filter((m) => !m.status || m.status === "active")
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id))
  }
}
