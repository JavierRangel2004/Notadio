import test from "node:test";
import assert from "node:assert/strict";
import { parseWhisperOutput } from "./transcriptionService.js";

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
