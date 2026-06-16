// Friendly one-liners for model ids so non-technical users can pick without
// knowing provider-specific naming. Unknown ids fall back to the bare id.
export const MODEL_ALIASES: Record<string, string> = {
  "deepseek-v4-flash": "fast and economical",
  "deepseek-v4-flash-free": "fast · free tier",
  "deepseek-v4-pro": "highest quality",
  "glm-5.1": "balanced",
  "glm-5": "balanced",
  "kimi-k2.6": "long context",
  "kimi-k2.5": "long context",
  "minimax-m2.7": "creative",
  "minimax-m2.5": "creative",
  "minimax-m3": "creative",
  "qwen3.7-plus": "strong Spanish",
  "qwen3.6-plus": "strong Spanish",
  "llama3.1:8b": "local · balanced",
  "llama3.2": "local · lightweight",
  "mistral:latest": "local · fast"
};

export function modelLabel(id: string): string {
  const alias = MODEL_ALIASES[id];
  return alias ? `${id} · ${alias}` : id;
}
