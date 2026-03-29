import type { LlmProvider, LlmGenerateOptions, LlmGenerateResult } from "./types.js"

/**
 * Provider that speaks the OpenAI /v1/chat/completions protocol.
 *
 * Works with:
 * - Ollama's OpenAI-compatible endpoint (http://localhost:11434/v1)
 * - OpenAI API (https://api.openai.com/v1)
 * - Groq (https://api.groq.com/openai/v1)
 * - Together AI (https://api.together.xyz/v1)
 * - OpenRouter (https://openrouter.ai/api/v1)
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

  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResult> {
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
    if (options.maxTokens !== undefined) payload.max_tokens = options.maxTokens
    if (options.json) {
      payload.response_format = { type: "json_object" }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    }
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: options.signal
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(`OpenAI-compatible HTTP ${response.status}: ${body}`)
    }

    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
      usage?: { total_tokens?: number }
    }

    const text = data.choices?.[0]?.message?.content?.trim() ?? ""
    if (!text) {
      throw new Error("OpenAI-compatible provider returned empty response")
    }

    return { text }
  }
}
