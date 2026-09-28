const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../public/actionPolicy.js"), "utf8"),
  sandbox,
);
const policy = sandbox.globalThis.PokerCoachActionPolicy;

const allInNode = { facingBet: true, facingAllIn: true };
assert.deepEqual(Array.from(policy.legalActionsForNode(allInNode)), ["Fold", "Call"]);
assert.equal(
  policy.constrainRecommendation("Raise", allInNode, {
    equity: 0.79,
    potOdds: 0.28,
    ev: 20,
  }),
  "Call",
);

const raiseNode = { facingBet: true, facingAllIn: false };
assert.deepEqual(Array.from(policy.legalActionsForNode(raiseNode)), ["Fold", "Call", "Raise"]);
assert.equal(policy.constrainRecommendation("Raise", raiseNode, { equity: 0.79, potOdds: 0.28, ev: 20 }), "Raise");

console.log("action policy regression checks passed");
