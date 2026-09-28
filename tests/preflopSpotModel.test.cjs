const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/preflopSpotModel.js"), "utf8");
const sandbox = { window: {}, globalThis: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: "preflopSpotModel.js" });

const model = sandbox.PokerCoachPreflopSpotModel;
assert.ok(model, "preflop spot model should be attached to global scope");

assert.deepEqual(
  JSON.parse(JSON.stringify(model.inferPreflopSpot([{ actor: "BB", action: "call", amount: 1.5 }], "BB", "BTN"))),
  {
    action: "open",
    description: "BTN opened preflop, BB called",
  },
  "A blind call with no visible opener should infer the selected villain opened, not 3-bet.",
);

assert.deepEqual(
  JSON.parse(JSON.stringify(model.inferPreflopSpot(
    [
      { actor: "BB", action: "open", amount: 2.5 },
      { actor: "BTN", action: "call", amount: 2.5 },
    ],
    "BB",
    "BTN",
  ))),
  {
    action: "call_vs_open",
    description: "BTN called versus BB open",
  },
);

assert.deepEqual(
  JSON.parse(JSON.stringify(model.inferPreflopSpot(
    [
      { actor: "BB", action: "open", amount: 2.5 },
      { actor: "BTN", action: "raise", amount: 8 },
    ],
    "BB",
    "BTN",
  ))),
  {
    action: "3bet_vs_open",
    description: "BTN raised versus BB open",
  },
);

assert.deepEqual(
  JSON.parse(JSON.stringify(model.inferPreflopSpot(
    [
      { actor: "MP", action: "open", amount: 2.2 },
      { actor: "SB", action: "raise", amount: 6.97 },
      { actor: "MP", action: "call", amount: 4.77 },
    ],
    "SB",
    "MP",
  ))),
  {
    action: "call_vs_3bet",
    description: "MP opened, SB raised, MP called",
  },
  "A villain opener who calls hero's 3-bet must be modeled as call_vs_3bet.",
);

console.log("preflop spot model regression checks passed");
