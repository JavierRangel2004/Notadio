import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import {
  buildWhisperArgs,
  generateEnglishTranslation,
  parseWhisperOutput,
  translateTranscript,
  trimTrailingHallucinatedLoop
} from "./transcriptionService.js";
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

test("trimTrailingHallucinatedLoop removes repeated short suffix at end of transcript", () => {
  const originalGuard = config.whisperHallucinationGuard;
  config.whisperHallucinationGuard = true;

  try {
    const variant: TranscriptVariant = {
      language: "es",
      text: "",
      segments: [
        { start: 0, end: 2, text: "Introducción." },
        { start: 2, end: 3, text: "Y ellos no conocen a nadie." },
        { start: 3, end: 4, text: "Y ellos no conocen a nadie." },
        { start: 4, end: 5, text: "Y ellos no conocen a nadie." },
        { start: 5, end: 6, text: "Y ellos no conocen a nadie." },
        { start: 6, end: 7, text: "Y ellos no conocen a nadie." },
        { start: 7, end: 8, text: "Y ellos no conocen a nadie." },
        { start: 8, end: 9, text: "Y ellos no conocen a nadie." }
      ]
    };
    variant.text = variant.segments.map((segment) => segment.text).join(" ");

    const result = trimTrailingHallucinatedLoop(variant);

    assert.equal(result.removedCount, 6);
    assert.deepEqual(result.variant.segments.map((segment) => segment.text), [
      "Introducción.",
      "Y ellos no conocen a nadie."
    ]);
  } finally {
    config.whisperHallucinationGuard = originalGuard;
  }
});

test("trimTrailingHallucinatedLoop preserves repeated middle content and short endings below threshold", () => {
  const originalGuard = config.whisperHallucinationGuard;
  config.whisperHallucinationGuard = true;

  try {
    const variant: TranscriptVariant = {
      language: "es",
      text: "",
      segments: [
        { start: 0, end: 1, text: "Sí." },
        { start: 1, end: 2, text: "Sí." },
        { start: 2, end: 3, text: "Sí." },
        { start: 3, end: 4, text: "Cierre." },
        { start: 4, end: 5, text: "Gracias." },
        { start: 5, end: 6, text: "Gracias." },
        { start: 6, end: 7, text: "Gracias." },
        { start: 7, end: 8, text: "Gracias." },
        { start: 8, end: 9, text: "Gracias." }
      ]
    };
    variant.text = variant.segments.map((segment) => segment.text).join(" ");

    const result = trimTrailingHallucinatedLoop(variant);

    assert.equal(result.removedCount, 0);
    assert.equal(result.variant.segments.length, variant.segments.length);
  } finally {
    config.whisperHallucinationGuard = originalGuard;
  }
});

test("parseWhisperOutput throws when no supported transcript structure exists", () => {
  assert.throws(() => parseWhisperOutput({ result: { language: "en" } }), /could not be parsed/i);
});

test("buildWhisperArgs appends safety defaults without duplicating explicit overrides", () => {
  const originalValues = {
    whisperEnableVad: config.whisperEnableVad,
    whisperVadModelPath: config.whisperVadModelPath,
    whisperMaxContext: config.whisperMaxContext,
    whisperMaxLen: config.whisperMaxLen,
    whisperNoSpeechThold: config.whisperNoSpeechThold,
    whisperSplitOnWord: config.whisperSplitOnWord,
    whisperSuppressNst: config.whisperSuppressNst,
    whisperArgs: config.whisperArgs
  };

  config.whisperEnableVad = true;
  config.whisperVadModelPath = "C:/vad.bin";
  config.whisperMaxContext = 0;
  config.whisperMaxLen = 160;
  config.whisperNoSpeechThold = 0.72;
  config.whisperSplitOnWord = true;
  config.whisperSuppressNst = true;
  config.whisperArgs = '-m "{model}" -f "{input}" --output-json --output-file "{outputBase}" --language auto --max-context 32 --no-speech-thold 0.4';

  try {
    const args = buildWhisperArgs("input.wav", "output", "transcribe", {
      profile: "speed",
      deviceSummary: "Windows GPU",
      threads: 8,
      translationEnabled: false
    });

    assert.equal(args.includes("--split-on-word") || args.includes("-sow"), true);
    assert.equal(args.includes("--suppress-nst") || args.includes("-sns"), true);
    assert.equal(args.includes("--vad"), true);
    assert.equal(args.includes("C:/vad.bin"), true);
    assert.equal(args.filter((arg) => arg === "--max-context" || arg === "-mc").length, 1);
    assert.equal(args.filter((arg) => arg === "--no-speech-thold" || arg === "-nth").length, 1);
    assert.equal(args.includes("32"), true);
    assert.equal(args.includes("0.4"), true);
  } finally {
    Object.assign(config, originalValues);
  }
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

test("generateEnglishTranslation uses Ollama directly when translation path is ollama", async () => {
  const source = createSourceVariant();
  const { restore } = installFetchSteps([
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
    const result = await generateEnglishTranslation("unused.wav", "unused", source, {
      processingProfile: {
        profile: "balanced",
        deviceSummary: "Windows CPU",
        threads: 4,
        translationEnabled: true,
        translationPath: "ollama"
      }
    });

    assert.equal(result.path, "ollama");
    assert.equal(result.variant.language, "en");
  } finally {
    restore();
  }
});

test("generateEnglishTranslation falls back to Ollama when Whisper translation fails", async () => {
  const source = createSourceVariant();
  const originalModelPath = config.whisperModelPath;
  const { restore } = installFetchSteps([
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

  config.whisperModelPath = "";

  try {
    const result = await generateEnglishTranslation("unused.wav", "unused", source, {
      processingProfile: {
        profile: "speed",
        deviceSummary: "Windows GPU",
        threads: 8,
        translationEnabled: true,
        translationPath: "whisper"
      }
    });

    assert.equal(result.path, "ollama");
    assert.equal(result.warnings.length > 0, true);
    assert.match(result.warnings[0] ?? "", /fell back to Ollama/i);
  } finally {
    config.whisperModelPath = originalModelPath;
    restore();
  }
});
