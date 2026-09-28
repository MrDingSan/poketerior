const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { window: {}, globalThis: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "../public/rangeDecisionContext.js"), "utf8"),
  sandbox,
  { filename: "rangeDecisionContext.js" },
);

const { buildRangeDecisionContext, rangeDecisionOwner } = sandbox.PokerCoachRangeDecisionContext;

assert.equal(
  rangeDecisionOwner(null),
  "hero",
  "a manual analysis is Hero's decision and must use the no-future-information range contract",
);

const firstToAct = buildRangeDecisionContext({
  street: "flop",
  heroPosition: "BB",
  decisionOwner: "hero",
  decisionNode: "Flop Node: Decision before Hero bet",
  decisionDescription: "Evaluate Hero's options immediately before the recorded bet 9.8bb.",
  recordedHeroAction: "bet",
  recordedHeroAmount: 9.8,
  streetActions: [],
});

assert.equal(firstToAct.recordedHeroAction, undefined, "the future Hero bet must not reach range inference");
assert.equal(firstToAct.recordedHeroAmount, undefined, "the future Hero size must not reach range inference");
assert.equal(firstToAct.decisionNode, "Flop Node: Hero to act");
assert.equal(firstToAct.freezeToPriorStreetRange, true, "a first-to-act Hero node must retain the prior-street range");

const heroResponse = buildRangeDecisionContext({
  street: "flop",
  heroPosition: "BB",
  decisionOwner: "hero",
  decisionNode: "Flop Node: Decision before Hero fold",
  decisionDescription: "Evaluate Hero's options immediately before the recorded fold.",
  recordedHeroAction: "fold",
  streetActions: [
    { actor: "CO", action: "allin", amount: 33.3 },
  ],
});

assert.equal(heroResponse.recordedHeroAction, undefined, "Hero's recorded response must not leak after a Villain action");
assert.equal(heroResponse.freezeToPriorStreetRange, false, "an observed Villain action may update the current-street range");
assert.deepEqual(
  JSON.parse(JSON.stringify(heroResponse.streetActions)),
  [{ actor: "CO", action: "allin", amount: 33.3 }],
  "actions completed before Hero's decision remain range evidence",
);

console.log("range decision context regression checks passed");
