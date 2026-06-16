import { createLlmRequestSignal } from "./llmRequestSignal.js";

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<Response> {
  const { signal, dispose } = createLlmRequestSignal(timeoutMs, init?.signal ?? undefined);

  try {
    return await fetch(input, { ...init, signal });
  } finally {
    dispose();
  }
}
