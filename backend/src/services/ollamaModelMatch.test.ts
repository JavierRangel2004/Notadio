import test from "node:test";
import assert from "node:assert/strict";
import { findInstalledOllamaModel, ollamaModelMatches } from "./ollamaModelMatch.js";

test("ollamaModelMatches accepts exact and base-name matches", () => {
  assert.equal(ollamaModelMatches("llama3.1:8b", "llama3.1:8b"), true);
  assert.equal(ollamaModelMatches("llama3.1:latest", "llama3.1:8b"), true);
  assert.equal(ollamaModelMatches("llama3.1:8b", "llama3.2:3b"), false);
});

test("findInstalledOllamaModel returns the first compatible installed model", () => {
  const installed = ["mistral:latest", "llama3.1:8b", "phi4-mini:latest"];
  assert.equal(findInstalledOllamaModel("llama3.1:latest", installed), "llama3.1:8b");
});
