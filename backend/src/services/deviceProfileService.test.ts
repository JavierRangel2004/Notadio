import test from "node:test";
import assert from "node:assert/strict";
import { classifyRuntime, getExpectedBackend, selectTranslationPath } from "./deviceProfileService.js";

test("classifyRuntime distinguishes Windows GPU and CPU hosts", () => {
  assert.equal(classifyRuntime("win32", "x64", true), "windows-gpu");
  assert.equal(classifyRuntime("win32", "x64", false), "windows-cpu");
});

test("classifyRuntime distinguishes Apple Silicon and Intel Mac hosts", () => {
  assert.equal(classifyRuntime("darwin", "arm64", false), "macos-arm");
  assert.equal(classifyRuntime("darwin", "x64", false), "macos-intel");
});

test("getExpectedBackend maps runtime class to backend", () => {
  assert.equal(getExpectedBackend("windows-gpu"), "cuda");
  assert.equal(getExpectedBackend("macos-arm"), "metal");
  assert.equal(getExpectedBackend("windows-cpu"), "cpu");
});

test("selectTranslationPath honors strategy and runtime class", () => {
  assert.equal(selectTranslationPath("whisper-first", "windows-cpu", true), "whisper");
  assert.equal(selectTranslationPath("hybrid", "windows-gpu", true), "whisper");
  assert.equal(selectTranslationPath("hybrid", "macos-intel", true), "ollama");
  assert.equal(selectTranslationPath("ollama-first", "macos-arm", true), "ollama");
  assert.equal(selectTranslationPath("whisper-first", "windows-gpu", false), "disabled");
});
