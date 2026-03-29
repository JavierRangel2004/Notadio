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
 * Environment variable pattern:
 *   LLM_{SERVICE}_PROVIDER  — "ollama" | "openai-compatible"
 *   LLM_{SERVICE}_MODEL     — model identifier
 *   LLM_{SERVICE}_BASE_URL  — endpoint override
 *   LLM_{SERVICE}_API_KEY   — API key (for openai-compatible)
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
    || (providerType === "openai-compatible"
      ? process.env.LLM_OPENAI_BASE_URL?.trim() || `${config.ollamaBaseUrl}/v1`
      : config.ollamaBaseUrl)
  const apiKey = process.env[`LLM_${service}_API_KEY`]?.trim()
    || process.env.LLM_OPENAI_API_KEY?.trim()
    || ""

  return buildProvider(providerType, baseUrl, apiKey)
}

/**
 * Resolve the model identifier for a given service.
 * Checks LLM_{SERVICE}_MODEL first, falls back to OLLAMA_MODEL.
 */
export function resolveModel(service: LlmServiceKey): string {
  return process.env[`LLM_${service}_MODEL`]?.trim() || config.ollamaModel
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
