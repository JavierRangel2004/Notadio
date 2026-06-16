import type { LlmProvider, LlmGenerateOptions, LlmGenerateResult } from "./types.js"
import { config } from "../../config.js"
import { fetchWithTimeout } from "../../utils/fetchWithTimeout.js"

/**
 * Provider that calls the native Ollama /api/generate endpoint.
 * This preserves backward compatibility with the existing codebase.
 */
export class OllamaProvider implements LlmProvider {
  readonly name = "ollama"
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "")
  }

  async generate(options: LlmGenerateOptions): Promise<LlmGenerateResult> {
    const ollamaOptions: Record<string, unknown> = {}
    if (options.temperature !== undefined) ollamaOptions.temperature = options.temperature
    if (options.maxTokens !== undefined) ollamaOptions.num_predict = options.maxTokens
    if (options.contextSize !== undefined) ollamaOptions.num_ctx = options.contextSize

    const payload: Record<string, unknown> = {
      model: options.model,
      prompt: options.prompt,
      stream: false,
      options: ollamaOptions
    }

    if (options.system) payload.system = options.system
    if (options.json) payload.format = "json"
    if (options.keepAlive) payload.keep_alive = options.keepAlive

    const response = await fetchWithTimeout(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: options.signal
    }, config.llmRequestTimeoutMs)

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      throw new Error(`Ollama HTTP ${response.status}: ${body}`)
    }

    const data = (await response.json()) as {
      response?: string
      total_duration?: number
    }

    const text = data.response?.trim() ?? ""
    if (!text) {
      throw new Error("Ollama returned empty response")
    }

    return {
      text,
      totalDurationMs: data.total_duration
        ? Math.round(data.total_duration / 1_000_000)
        : undefined
    }
  }

  /** Locally installed models, mirroring `ollama list` (GET /api/tags). */
  async listModels(signal?: AbortSignal): Promise<string[]> {
    const response = await fetchWithTimeout(`${this.baseUrl}/api/tags`, { signal }, config.llmRequestTimeoutMs)
    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`)
    }
    const data = (await response.json()) as { models?: { name?: string }[] }
    return (data.models ?? [])
      .map((m) => m.name)
      .filter((name): name is string => Boolean(name))
  }
}
