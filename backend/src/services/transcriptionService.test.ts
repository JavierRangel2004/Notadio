import test from "node:test";
import assert from "node:assert/strict";
import { parseWhisperOutput, translateTranscript } from "./transcriptionService.js";
import { TranscriptVariant } from "../types.js";

type FetchStep = {
  payload?: string;
  error?: string;
};

type FetchCall = {
  url: string;
  body: Record<string, unknown>;
};

function installFetchSteps(steps: FetchStep[]): { restore: () => void; calls: () => number; requestBodies: () => FetchCall[] } {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  const capturedBodies: FetchCall[] = [];

  globalThis.fetch = (async (input, init) => {
    const step = steps[callCount] ?? steps[steps.length - 1];
    callCount += 1;
    const rawBody = typeof init?.body === "string" ? init.body : "{}";
    capturedBodies.push({
      url: String(input),
      body: JSON.parse(rawBody) as Record<string, unknown>
    });

    if (step.error) {
      throw new Error(step.error);
    }

    const payload = step.payload ?? "{}";
    return {
      ok: true,
      status: 200,
      json: async () => ({ response: payload }),
      text: async () => payload
    } as Response;
  }) as typeof fetch;

  return {
    restore: () => {
      globalThis.fetch = originalFetch;
    },
    calls: () => callCount,
    requestBodies: () => capturedBodies
  };
}

function createSourceVariant(): TranscriptVariant {
  return {
    language: "es",
    text: "Hola, Iko. Todo bien, ¿y tú? Ya tomé la decisión final.",
    segments: [
      { start: 0, end: 4, speaker: "Javier", text: "Hola, Iko." },
      { start: 4, end: 8, speaker: "Ana", text: "Todo bien, ¿y tú?" },
      { start: 8, end: 13, speaker: "Javier", text: "Ya tomé la decisión final." }
    ]
  };
}

test("parseWhisperOutput supports whisper.cpp transcription arrays with millisecond offsets", () => {
  const payload = {
    result: { language: "es" },
    transcription: [
      {
        offsets: { from: 400, to: 9880 },
        text: " Hola mundo."
      },
      {
        offsets: { from: 9880, to: 15000 },
        text: " Segunda linea."
      }
    ]
  };

  const variant = parseWhisperOutput(payload);
  assert.equal(variant.language, "es");
  assert.equal(variant.text, "Hola mundo. Segunda linea.");
  assert.deepEqual(variant.segments, [
    { start: 0.4, end: 9.88, text: "Hola mundo." },
    { start: 9.88, end: 15, text: "Segunda linea." }
  ]);
});

test("parseWhisperOutput supports legacy segments arrays", () => {
  const payload = {
    language: "en",
    segments: [
      { start: 0, end: 1.5, text: "One" },
      { start: 1.5, end: 2.5, text: "Two" }
    ]
  };

  const variant = parseWhisperOutput(payload);
  assert.equal(variant.language, "en");
  assert.equal(variant.text, "One Two");
  assert.equal(variant.segments.length, 2);
});

test("parseWhisperOutput throws when no supported transcript structure exists", () => {
  assert.throws(() => parseWhisperOutput({ result: { language: "en" } }), /could not be parsed/i);
});

test("translateTranscript preserves segment timing and speakers while translating text", async () => {
  const source = createSourceVariant();
  const { restore, calls, requestBodies } = installFetchSteps([
    {
      payload: JSON.stringify({
        translations: [
          { index: 0, text: "Hello, Iko." },
          { index: 1, text: "All good, and you?" },
          { index: 2, text: "I already made the final decision." }
        ]
      })
    }
  ]);

  try {
    const translated = await translateTranscript(source);

    assert.equal(calls(), 1);
    assert.equal(translated.language, "en");
    assert.equal(translated.text, "Hello, Iko. All good, and you? I already made the final decision.");
    assert.deepEqual(translated.segments, [
      { start: 0, end: 4, speaker: "Javier", text: "Hello, Iko." },
      { start: 4, end: 8, speaker: "Ana", text: "All good, and you?" },
      { start: 8, end: 13, speaker: "Javier", text: "I already made the final decision." }
    ]);

    const prompt = String(requestBodies()[0]?.body.prompt ?? "");
    assert.match(prompt, /Hola, Iko\./);
    assert.match(prompt, /Todo bien, ¿y tú\?/);
  } finally {
    restore();
  }
});

test("translateTranscript fails when the model returns a mismatched segment count", async () => {
  const source = createSourceVariant();
  const { restore } = installFetchSteps([
    {
      payload: JSON.stringify({
        translations: [{ index: 0, text: "Hello, Iko." }]
      })
    }
  ]);

  try {
    await assert.rejects(
      () => translateTranscript(source),
      /returned 1 segments for 3 inputs/i
    );
  } finally {
    restore();
  }
});
