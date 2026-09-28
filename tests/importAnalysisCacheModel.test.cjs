const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/importAnalysisCacheModel.js"), "utf8");
const sandbox = { window: {}, globalThis: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: "importAnalysisCacheModel.js" });

const model = sandbox.PokerCoachImportAnalysisCacheModel;
assert.ok(model, "import analysis cache model should be attached to global scope");

const baseState = {
  importId: "imp_123",
  heroName: "Hero",
  street: "turn",
  index: 2,
  heroHand: "Ad 7d",
  board: { flop: "Ah 2c 6s", turn: "3s", river: "" },
  rows: {
    preflop: [
      { actor: "MP", action: "open", amount: 2.2 },
      { actor: "SB", action: "raise", amount: 6.97 },
      { actor: "MP", action: "call", amount: 4.77 },
    ],
    flop: [
      { actor: "SB", action: "bet", amount: 5.25 },
      { actor: "MP", action: "call", amount: 5.25 },
    ],
    turn: [{ actor: "MP", action: "bet", amount: 26.4 }],
    river: [],
  },
};

const sameStateDifferentObjectOrder = {
  index: 2,
  street: "turn",
  heroName: "Hero",
  importId: "imp_123",
  heroHand: "Ad 7d",
  board: { river: "", turn: "3s", flop: "Ah 2c 6s" },
  rows: baseState.rows,
};

assert.equal(
  model.cacheKeyForImportedDecision(baseState),
  model.cacheKeyForImportedDecision(sameStateDifferentObjectOrder),
  "Equivalent imported node state should produce a stable cache key.",
);

const editedState = {
  ...baseState,
  board: { ...baseState.board, turn: "4s" },
};

assert.notEqual(
  model.cacheKeyForImportedDecision(baseState),
  model.cacheKeyForImportedDecision(editedState),
  "Editing visible card state should invalidate the imported node cache.",
);

const cache = model.createImportAnalysisCache();
cache.set(baseState, { html: "<p>cached</p>" });
assert.deepEqual(JSON.parse(JSON.stringify(cache.get(sameStateDifferentObjectOrder))), { html: "<p>cached</p>" });
assert.equal(cache.get(editedState), null);

console.log("import analysis cache model regression checks passed");
