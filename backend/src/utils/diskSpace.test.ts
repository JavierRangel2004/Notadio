import test from "node:test";
import assert from "node:assert/strict";
import { estimateJobDiskBytes, formatBytes } from "./diskSpace.js";

test("estimateJobDiskBytes applies multiplier and fixed headroom", () => {
  const requirement = estimateJobDiskBytes(4_548_201_062, 2.2, 512 * 1024 * 1024);

  assert.equal(requirement.sourceBytes, 4_548_201_062);
  assert.equal(requirement.multiplier, 2.2);
  assert.equal(requirement.requiredBytes, Math.ceil(4_548_201_062 * 2.2 + 512 * 1024 * 1024));
});

test("formatBytes renders human-readable sizes", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.match(formatBytes(4_548_201_062), /GB$/);
});
