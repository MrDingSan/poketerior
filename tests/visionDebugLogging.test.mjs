import assert from "node:assert/strict";
import { buildVisionImportRecord, attachVisionImportToAnalysis } from "../src/analysis/visionDebug.js";

const rawVisionOutput = `${"full raw model output ".repeat(80)}END_MARKER`;
const record = buildVisionImportRecord({
  importId: "imp_test",
  request: { mimeType: "image/png", imageBase64: "SECRET_IMAGE_BYTES" },
  result: {
    hand: { heroHand: ["9s", "9h"], board: { flop: ["Th", "6s", "5d"], turn: "7s", river: "Jc" } },
    provider: "gemini",
    model: "vision-model",
    normalizationNotes: ["split board"],
    debug: {
      rawVisionOutput,
      parsedVisionHand: { heroHand: ["9s", "9h"] },
      focusedHeroRawVisionOutput: "focused full raw output",
      focusedHeroCropRegion: { left: 242, top: 410, width: 726, height: 512 },
      focusedHeroCropFailure: null,
      focusedHeroDecision: {
        accepted: true,
        reason: "verified-bottom-center-player",
        originalCards: ["Js", "Ks"],
        focusedCards: ["2d", "Kh"],
        playerName: "dingsanpro",
      },
      focusedActionRepairRawVisionOutput: "full targeted action output",
      focusedActionRepairParsedOutput: { heroName: "dingsanpro" },
      focusedActionRepairProvider: "openrouter",
      focusedActionRepairModel: "openrouter/free",
      actionConsistencyIssues: [{ code: "SELF_RESPONSE", street: "flop" }],
      focusedActionRepairDecision: { accepted: true, reason: "verified-action-identities" },
      actionAttributionSafe: true,
    },
  },
});

assert.equal(record.rawVisionOutput, rawVisionOutput);
assert.match(record.rawVisionOutput, /END_MARKER$/);
assert.equal(record.focusedHeroRawVisionOutput, "focused full raw output");
assert.deepEqual(record.focusedHeroCropRegion, { left: 242, top: 410, width: 726, height: 512 });
assert.equal(record.focusedHeroCropFailure, null);
assert.deepEqual(record.focusedHeroDecision, {
  accepted: true,
  reason: "verified-bottom-center-player",
  originalCards: ["Js", "Ks"],
  focusedCards: ["2d", "Kh"],
  playerName: "dingsanpro",
});
assert.equal(record.focusedActionRepairRawVisionOutput, "full targeted action output");
assert.deepEqual(record.focusedActionRepairParsedOutput, { heroName: "dingsanpro" });
assert.equal(record.focusedActionRepairProvider, "openrouter");
assert.equal(record.focusedActionRepairModel, "openrouter/free");
assert.deepEqual(record.actionConsistencyIssues, [{ code: "SELF_RESPONSE", street: "flop" }]);
assert.deepEqual(record.focusedActionRepairDecision, { accepted: true, reason: "verified-action-identities" });
assert.equal(record.actionAttributionSafe, true);
assert.equal(JSON.stringify(record).includes("SECRET_IMAGE_BYTES"), false);

const analysis = { analysisId: "pc_test", local: { pokerFacts: {} }, endpoints: {} };
const attached = attachVisionImportToAnalysis(analysis, record);
assert.equal(attached.visionImport.importId, "imp_test");
assert.equal(attached.visionImport.rawVisionOutput, rawVisionOutput);

console.log("visionDebugLogging tests passed");
