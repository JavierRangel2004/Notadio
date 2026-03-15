import test from "node:test";
import assert from "node:assert/strict";
import { postProcessDiarization } from "./diarizationService.js";
import { TranscriptSegment } from "../types.js";

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

test("postProcessDiarization collapses noisy diarization to two stable speakers", async () => {
  const transcriptSegments: TranscriptSegment[] = [
    { start: 0, end: 6, text: "Iniciamos la llamada." },
    { start: 6, end: 12, text: "Revisamos acuerdos y pendientes." },
    { start: 12, end: 18, text: "Queda definir siguiente paso." },
    { start: 18, end: 24, text: "Se confirma la propuesta." }
  ];

  const diarizationSlices = [
    { start: 0, end: 5.8, speaker: "SPEAKER_01" },
    { start: 5.8, end: 7.2, speaker: "Unknown" },
    { start: 7.2, end: 12.3, speaker: "SPEAKER_02" },
    { start: 12.3, end: 14.2, speaker: "SPEAKER_03" },
    { start: 14.2, end: 19.8, speaker: "SPEAKER_01" },
    { start: 19.8, end: 24.2, speaker: "SPEAKER_02" }
  ];

  const { restore } = installFetchSteps([
    { payload: JSON.stringify({}) } // no inference
  ]);

  try {
    const result = await postProcessDiarization(transcriptSegments, diarizationSlices);
    const uniqueSpeakers = [...new Set(result.map((segment) => segment.speaker).filter(Boolean))];

    assert.equal(uniqueSpeakers.length, 2);
    assert.deepEqual(uniqueSpeakers, ["SPEAKER_A", "SPEAKER_B"]);
  } finally {
    restore();
  }
});

test("postProcessDiarization infers Jacob and Javier labels when confidence is high via mock API", async () => {
  const transcriptSegments: TranscriptSegment[] = [
    { start: 0, end: 6, text: "Gracias, Javi, por explicar todo." },
    { start: 6, end: 13, text: "Claro, Jacob, yo ya no seguire en la empresa." },
    { start: 13, end: 20, text: "Entiendo, Javi. Te mando propuesta entre manana y viernes." },
    { start: 20, end: 28, text: "Perfecto, Jacob. Quedo atento al handover." }
  ];

  const diarizationSlices = [
    { start: 0, end: 6, speaker: "SPEAKER_01" },
    { start: 6, end: 13, speaker: "SPEAKER_02" },
    { start: 13, end: 20, speaker: "SPEAKER_01" },
    { start: 20, end: 28, speaker: "SPEAKER_02" }
  ];

  const { restore, calls, requestBodies } = installFetchSteps([
    { payload: JSON.stringify({ "SPEAKER_01": "Jacob", "SPEAKER_02": "Javier" }) }
  ]);

  try {
    const result = await postProcessDiarization(transcriptSegments, diarizationSlices);
    const uniqueSpeakers = [...new Set(result.map((segment) => segment.speaker).filter(Boolean))];
    
    assert.equal(calls(), 1);
    const body = requestBodies()[0]!.body;
    assert.match(String(body.prompt), /Gracias, Javi, por explicar todo/);

    assert.deepEqual(uniqueSpeakers.sort(), ["Jacob", "Javier"]);
  } finally {
    restore();
  }
});

test("postProcessDiarization smooths isolated one-off speaker flips", async () => {
  const transcriptSegments: TranscriptSegment[] = [
    { start: 0, end: 9, text: "Bloque inicial." },
    { start: 9, end: 10.5, text: "Interrupcion corta." },
    { start: 10.5, end: 18, text: "Continuacion del bloque inicial." }
  ];

  const diarizationSlices = [
    { start: 0, end: 9, speaker: "SPEAKER_01" },
    { start: 9, end: 10.5, speaker: "SPEAKER_02" },
    { start: 10.5, end: 18, speaker: "SPEAKER_01" }
  ];

  const { restore } = installFetchSteps([
    { payload: JSON.stringify({}) }
  ]);

  try {
    const result = await postProcessDiarization(transcriptSegments, diarizationSlices);

    assert.equal(result[0].speaker, result[1].speaker);
    assert.equal(result[1].speaker, result[2].speaker);
  } finally {
    restore();
  }
});
