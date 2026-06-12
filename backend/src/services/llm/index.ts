export type { LlmProvider, LlmGenerateOptions, LlmGenerateResult } from "./types.js"
export { OllamaProvider } from "./ollamaProvider.js"
export { OpenAICompatibleProvider } from "./openaiCompatibleProvider.js"

import { config } from "../../config.js"
import type { LlmProvider } from "./types.js"
import { OllamaProvider } from "./ollamaProvider.js"
import { OpenAICompatibleProvider } from "./openaiCompatibleProvider.js"

/**
 * Service keys that can each have their own provider/model override.
 *
 * Resolution order (first non-empty wins):
 *   1. Per-service:  LLM_{SERVICE}_PROVIDER / _MODEL / _BASE_URL / _API_KEY
 *   2. Global:       LLM_PROVIDER / LLM_MODEL / LLM_BASE_URL / LLM_API_KEY
 *   3. Ollama defaults (OLLAMA_BASE_URL / OLLAMA_MODEL)
 *
 * To route every LLM feature through a hosted OpenAI-compatible gateway
 * (e.g. OpenCode, OpenAI, OpenRouter) instead of Ollama, set the globals:
 *   LLM_PROVIDER=openai-compatible
 *   LLM_BASE_URL=https://your-endpoint/v1
 *   LLM_API_KEY=sk-...
 *   LLM_MODEL=<model-id>
 */
export type LlmServiceKey =
  | "SUMMARY"
  | "LIVE_ASSISTANT"
  | "LIVE_TRANSLATION"
  | "TRANSLATION"
  | "DIARIZATION"

type ProviderType = "ollama" | "openai-compatible"

function readProviderType(envKey: string): ProviderType {
  const raw = process.env[envKey]?.trim().toLowerCase()
    || process.env.LLM_PROVIDER?.trim().toLowerCase()
  if (raw === "openai-compatible" || raw === "openai") return "openai-compatible"
  return "ollama"
}

// Cache instantiated providers to avoid creating duplicates
const providerCache = new Map<string, LlmProvider>()

function buildProvider(type: ProviderType, baseUrl: string, apiKey: string): LlmProvider {
  const cacheKey = `${type}|${baseUrl}|${apiKey}`
  const cached = providerCache.get(cacheKey)
  if (cached) return cached

  let provider: LlmProvider
  if (type === "openai-compatible") {
    provider = new OpenAICompatibleProvider(baseUrl, apiKey)
  } else {
    provider = new OllamaProvider(baseUrl)
  }
  providerCache.set(cacheKey, provider)
  return provider
}

/**
 * Resolve the LLM provider for a given service, checking service-specific
 * env overrides first, then falling back to global Ollama config.
 */
export function resolveProvider(service: LlmServiceKey): LlmProvider {
  const providerType = readProviderType(`LLM_${service}_PROVIDER`)
  const baseUrl = process.env[`LLM_${service}_BASE_URL`]?.trim()
    || process.env.LLM_BASE_URL?.trim()
    || (providerType === "openai-compatible"
      ? process.env.LLM_OPENAI_BASE_URL?.trim() || `${config.ollamaBaseUrl}/v1`
      : config.ollamaBaseUrl)
  const apiKey = process.env[`LLM_${service}_API_KEY`]?.trim()
    || process.env.LLM_API_KEY?.trim()
    || process.env.LLM_OPENAI_API_KEY?.trim()
    || ""

  return buildProvider(providerType, baseUrl, apiKey)
}

/**
 * Resolve the model identifier for a given service.
 * Checks LLM_{SERVICE}_MODEL first, falls back to OLLAMA_MODEL.
 */
export function resolveModel(service: LlmServiceKey): string {
  return process.env[`LLM_${service}_MODEL`]?.trim()
    || process.env.LLM_MODEL?.trim()
    || config.ollamaModel
}

/**
 * Convenience: get both provider and model for a service in one call.
 */
export function resolveServiceLlm(service: LlmServiceKey): { provider: LlmProvider; model: string } {
  return {
    provider: resolveProvider(service),
    model: resolveModel(service)
  }
}

/**
 * Descriptor returned by getAvailableProviders() for the frontend to render
 * a dynamic provider/model picker.
 */
export type ProviderInfo = {
  id: string
  label: string
  defaultModel: string
}

/**
 * Return a list of providers that are configured and available for use.
 * Always includes "ollama" (built-in default) and conditionally includes
 * "openai-compatible" when env vars configure it (or "opencode" label
 * when LLM_PROVIDER hints at it).
 */
export function getAvailableProviders(): ProviderInfo[] {
  const providers: ProviderInfo[] = [
    {
      id: "ollama",
      label: "Ollama (Local)",
      defaultModel: config.ollamaModel
    }
  ]

  const globalProvider = process.env.LLM_PROVIDER?.trim().toLowerCase()
  const hasOpenAIConfig = globalProvider === "openai-compatible"
    || globalProvider === "openai"
    || !!process.env.LLM_BASE_URL?.trim()
    || !!process.env.LLM_API_KEY?.trim()
    || !!process.env.LLM_OPENAI_BASE_URL?.trim()

  if (hasOpenAIConfig) {
    // Derive a friendlier label from the base URL when possible
    const baseUrl = process.env.LLM_BASE_URL?.trim()
      || process.env.LLM_OPENAI_BASE_URL?.trim() || ""
    let label = "OpenAI-Compatible"
    if (baseUrl.includes("opencode")) label = "OpenCode"
    else if (baseUrl.includes("openrouter")) label = "OpenRouter"
    else if (baseUrl.includes("groq")) label = "Groq"
    else if (baseUrl.includes("together")) label = "Together AI"
    else if (baseUrl.includes("api.openai.com")) label = "OpenAI"

    providers.push({
      id: "openai-compatible",
      label,
      defaultModel: process.env.LLM_MODEL?.trim() || config.ollamaModel
    })
  }

  return providers
}

/**
 * List the model identifiers a provider currently offers, for populating the
 * UI model picker. Ollama mirrors `ollama list` (GET /api/tags); the
 * openai-compatible provider queries its /models endpoint (e.g. OpenCode Zen).
 * Resolves base URL / API key from the same env vars as resolveProvider's
 * global tier. Throws if the provider is unreachable or unauthorized.
 */
export async function listModelsForProvider(providerId: string): Promise<string[]> {
  let provider: LlmProvider
  if (providerId === "openai-compatible") {
    const baseUrl = process.env.LLM_BASE_URL?.trim()
      || process.env.LLM_OPENAI_BASE_URL?.trim()
      || `${config.ollamaBaseUrl}/v1`
    const apiKey = process.env.LLM_API_KEY?.trim()
      || process.env.LLM_OPENAI_API_KEY?.trim()
      || ""
    provider = buildProvider("openai-compatible", baseUrl, apiKey)
  } else {
    provider = buildProvider("ollama", config.ollamaBaseUrl, "")
  }

  if (!provider.listModels) return []
  const models = await provider.listModels()

  // When LLM_MODEL_ALLOWLIST is set (comma-separated), show only those models.
  // Useful when the provider's /models endpoint returns the full platform catalog
  // regardless of subscription tier (e.g. OpenCode Zen lists all plans).
  const allowlist = process.env.LLM_MODEL_ALLOWLIST?.trim()
  if (allowlist) {
    const allowed = new Set(allowlist.split(",").map((s) => s.trim()).filter(Boolean))
    return models.filter((id) => allowed.has(id))
  }

  return models
}

/**
 * Build a provider+model pair from explicit request parameters.
 * Used when the UI sends a specific provider/model selection instead of
 * relying on environment-based resolution.
 */
export function buildProviderFromRequest(
  providerId?: string,
  model?: string
): { provider: LlmProvider; model: string } {
  // Fall back to default env-based resolution when no explicit provider given
  if (!providerId) {
    return resolveServiceLlm("SUMMARY")
  }

  if (providerId === "openai-compatible") {
    const baseUrl = process.env.LLM_BASE_URL?.trim()
      || process.env.LLM_OPENAI_BASE_URL?.trim()
      || `${config.ollamaBaseUrl}/v1`
    const apiKey = process.env.LLM_API_KEY?.trim()
      || process.env.LLM_OPENAI_API_KEY?.trim()
      || ""
    return {
      provider: buildProvider("openai-compatible", baseUrl, apiKey),
      model: model || process.env.LLM_MODEL?.trim() || config.ollamaModel
    }
  }

  // Default: ollama
  return {
    provider: buildProvider("ollama", config.ollamaBaseUrl, ""),
    model: model || config.ollamaModel
  }
}
