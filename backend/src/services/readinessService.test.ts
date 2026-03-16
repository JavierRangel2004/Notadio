import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../config.js";
import { getReadinessReport } from "./readinessService.js";

test("getReadinessReport fails when VAD is enabled and the model path is missing", async () => {
  const originalValues = {
    enableSummary: config.enableSummary,
    diarizationCommand: config.diarizationCommand,
    whisperEnableVad: config.whisperEnableVad,
    whisperVadModelPath: config.whisperVadModelPath
  };

  Object.assign(config, {
    enableSummary: false,
    diarizationCommand: "",
    whisperEnableVad: true,
    whisperVadModelPath: "C:/definitely-missing-vad-model.bin"
  });

  try {
    const report = await getReadinessReport();
    const vadCheck = report.checks.find((check) => check.label === "whisper VAD model");

    assert.ok(vadCheck);
    assert.equal(vadCheck?.status, "fail");
    assert.match(vadCheck?.detail ?? "", /does not exist/i);
  } finally {
    Object.assign(config, originalValues);
  }
});
