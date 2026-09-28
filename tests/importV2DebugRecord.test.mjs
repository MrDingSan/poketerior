import assert from "node:assert/strict";
import { buildImportV2DebugRecord } from "../src/import-engine/debugRecord.js";

function testStripsPixelBearingKeysAndValuesButKeepsGeometry() {
  const input = {
    cropBase64: "secret",
    source: { dataUrl: "data:image/png;base64,secret", width: 1280, height: 2022 },
    attempts: [{ region: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, candidates: ["2.2"], confidence: 0.61 }],
  };
  const record = buildImportV2DebugRecord(input);
  assert.doesNotMatch(JSON.stringify(record), /secret|base64/);
  assert.deepEqual(record.attempts[0].region, { x: 0.1, y: 0.2, width: 0.3, height: 0.1 });
  assert.deepEqual(record.attempts[0].candidates, ["2.2"]);
  assert.equal(record.attempts[0].confidence, 0.61);
  assert.equal(record.source.width, 1280);
  assert.equal("dataUrl" in record.source, false);
  assert.equal(record.version, 1);
}

function testStripsRecursivelyThroughNestingArraysAndAliases() {
  const record = buildImportV2DebugRecord({
    importId: "imp_1",
    fallback: [{ purpose: "action-amount", cropBase64: "AAAA", imageBase64: "BBBB", crop: { dataUrl: "data:image/jpeg;base64,CCCC" }, provider: "gemini", model: "g", confidence: 0.9 }],
    deep: { level1: { level2: [{ imageData: "DDDD", pixels: [1, 2, 3], blob: "EEEE", thumbnail: "data:image/png;base64,FFFF", keep: "yes" }] } },
    note: "data:image/png;base64,GGGG",
  });
  const text = JSON.stringify(record);
  assert.doesNotMatch(text, /AAAA|BBBB|CCCC|DDDD|EEEE|FFFF|GGGG|base64|imageData|pixels/);
  assert.equal(record.fallback[0].provider, "gemini");
  assert.equal(record.fallback[0].confidence, 0.9);
  assert.equal(record.deep.level1.level2[0].keep, "yes");
  assert.equal("note" in record, false, "a data-URL value is dropped even under an innocent key");
}

function testDropsLongOpaquePayloadsThatLookLikeEncodedImages() {
  const opaque = "QUJD".repeat(1000);
  const record = buildImportV2DebugRecord({ importId: "imp_2", rawOutput: opaque, short: "QUJD", text: "Bet 2.2 BB" });
  assert.equal("rawOutput" in record, false);
  assert.equal(record.short, "QUJD");
  assert.equal(record.text, "Bet 2.2 BB");
}

function testKeepsTheDiagnosticFieldsTheSpecRequires() {
  const hand = { hero: { cards: ["Ah", "4d"] }, board: { flop: ["6h", "7s", "8c"] } };
  const record = buildImportV2DebugRecord({
    importId: "imp_3",
    adapter: { id: "natural8", version: "1", profile: "classic-tall-v1" },
    detection: { score: 0.91, evidence: ["streetHeadings"] },
    attempts: [{ scope: "row:1", variant: "upscale2", confidence: 0.4 }, { scope: "row:1", variant: "threshold", confidence: 0.8 }],
    fallback: [{ purpose: "action-amount", field: "actions.river.1.amountBb", provider: "openrouter", model: "m", confidence: 0.7 }],
    validation: { valid: true, replayIssues: [{ code: "pot-mismatch", field: "streetPots.flop" }] },
    hand,
  });
  assert.equal(record.adapter.version, "1");
  assert.equal(record.detection.score, 0.91);
  assert.equal(record.attempts.length, 2);
  assert.equal(record.fallback[0].model, "m");
  assert.equal(record.validation.replayIssues[0].code, "pot-mismatch");
  assert.deepEqual(record.hand, hand);
  assert.match(record.recordedAt, /^\d{4}-\d{2}-\d{2}T/);
}

function testDoesNotMutateItsInputAndSurvivesOddValues() {
  const input = { importId: "imp_4", cropBase64: "secret", nested: { imageBase64: "secret", ok: 1 }, undef: undefined, nul: null, fn: () => 1 };
  const before = JSON.stringify(input);
  const record = buildImportV2DebugRecord(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(record.nul, null);
  assert.equal(record.nested.ok, 1);
  assert.doesNotThrow(() => JSON.stringify(record));
  assert.deepEqual(buildImportV2DebugRecord(undefined).version, 1);
}

testStripsPixelBearingKeysAndValuesButKeepsGeometry();
testStripsRecursivelyThroughNestingArraysAndAliases();
testDropsLongOpaquePayloadsThatLookLikeEncodedImages();
testKeepsTheDiagnosticFieldsTheSpecRequires();
testDoesNotMutateItsInputAndSurvivesOddValues();
console.log("import V2 debug record tests passed");
