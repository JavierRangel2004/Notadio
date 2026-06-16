import test from "node:test"
import assert from "node:assert/strict"
import { OpenAICompatibleProvider } from "./openaiCompatibleProvider.js"

test("OpenAICompatibleProvider retries without json mode when json response is empty", async () => {
  const originalFetch = globalThis.fetch
  let callCount = 0

  globalThis.fetch = (async () => {
    callCount += 1
    const payload =
      callCount === 1
        ? { choices: [{ finish_reason: "stop", message: { content: "" } }] }
        : { choices: [{ finish_reason: "stop", message: { content: "{\"brief\":\"ok\"}" } }] }

    return {
      ok: true,
      status: 200,
      json: async () => payload
    } as Response
  }) as typeof fetch

  try {
    const provider = new OpenAICompatibleProvider("https://example.com/v1", "test-key")
    const result = await provider.generate({
      model: "deepseek-v4-flash",
      prompt: "Return JSON",
      json: true
    })

    assert.equal(callCount, 2)
    assert.equal(result.text, "{\"brief\":\"ok\"}")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("OpenAICompatibleProvider retries with expanded max tokens when finish_reason is length", async () => {
  const originalFetch = globalThis.fetch
  let callCount = 0
  const seenMaxTokens: number[] = []

  globalThis.fetch = (async (_input, init) => {
    callCount += 1
    const body = JSON.parse(String(init?.body))
    seenMaxTokens.push(body.max_tokens)

    const payload =
      callCount < 3
        ? { choices: [{ finish_reason: "length", message: { content: "" } }] }
        : { choices: [{ finish_reason: "stop", message: { content: "{\"brief\":\"expanded\"}" } }] }

    return {
      ok: true,
      status: 200,
      json: async () => payload
    } as Response
  }) as typeof fetch

  try {
    const provider = new OpenAICompatibleProvider("https://example.com/v1", "test-key")
    const result = await provider.generate({
      model: "deepseek-v4-pro",
      prompt: "Return JSON",
      json: true,
      maxTokens: 4096
    })

    assert.equal(callCount, 3)
    assert.equal(seenMaxTokens[2], 8192)
    assert.equal(result.text, "{\"brief\":\"expanded\"}")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("OpenAICompatibleProvider falls back to reasoning_content when content is empty", async () => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{
        finish_reason: "stop",
        message: {
          content: "",
          reasoning_content: "{\"brief\":\"from reasoning\"}"
        }
      }]
    })
  } as Response)) as typeof fetch

  try {
    const provider = new OpenAICompatibleProvider("https://example.com/v1", "test-key")
    const result = await provider.generate({
      model: "deepseek-v4-pro",
      prompt: "Return JSON",
      json: false
    })

    assert.equal(result.text, "{\"brief\":\"from reasoning\"}")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("OpenAICompatibleProvider extracts array message content blocks", async () => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{
        finish_reason: "stop",
        message: {
          content: [{ type: "text", text: "{\"brief\":\"from blocks\"}" }]
        }
      }]
    })
  } as Response)) as typeof fetch

  try {
    const provider = new OpenAICompatibleProvider("https://example.com/v1", "test-key")
    const result = await provider.generate({
      model: "demo",
      prompt: "hello",
      json: true
    })

    assert.equal(result.text, "{\"brief\":\"from blocks\"}")
  } finally {
    globalThis.fetch = originalFetch
  }
})
