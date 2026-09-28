import assert from "node:assert/strict";
import { validateScreenshotImportOutput } from "../src/analysis/pipeline.js";

assert.deepEqual(
  validateScreenshotImportOutput({ text: '```json\n{"site":"Natural8","heroHand":["As","Ts"],"board":{},"players":[],"streets":{}}\n```' }),
  { valid: true, reasons: [] },
  "a complete fenced JSON import response must be accepted",
);

const incomplete = validateScreenshotImportOutput({ text: '```json\n{"site":"Natural8","stakes' });
assert.equal(incomplete.valid, false, "an incomplete vision JSON response must trigger model failover");
assert.match(incomplete.reasons[0], /JSON|object/i);

console.log("screenshot import JSON validation checks passed");
