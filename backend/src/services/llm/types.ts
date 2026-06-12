/**
 * Generic LLM provider interface.
 *
 * Every backend service that needs text generation goes through this
 * abstraction instead of calling Ollama directly.
 */

export type LlmGenerateOptions = {
  /** Model identifier (provider-specific, e.g. "llama3.2" for Ollama, "gpt-4o-mini" for OpenAI). */
  model: string
  /** The prompt or user message. */
  prompt: string
  /** Optional system message (used by chat-style providers). */
  system?: string
  /** Sampling temperature (0-2). */
  temperature?: number
  /** Max tokens to generate. */
  maxTokens?: number
  /** Context window size hint (provider-specific). */
  contextSize?: number
  /** Request structured JSON output. */
  json?: boolean
  /** Abort signal for cancellation. */
  signal?: AbortSignal
  /** Ollama-specific keep_alive parameter. */
  keepAlive?: string
}

export type LlmGenerateResult = {
  text: string
  /** Total duration in ms (if reported by provider). */
  totalDurationMs?: number
}

export interface LlmProvider {
  readonly name: string
  generate(options: LlmGenerateOptions): Promise<LlmGenerateResult>
  /** List model identifiers the provider currently offers, if it supports discovery. */
  listModels?(signal?: AbortSignal): Promise<string[]>
}
