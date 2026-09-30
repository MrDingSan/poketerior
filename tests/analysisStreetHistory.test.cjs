const assert = require("node:assert/strict");
require("../public/analysisStreetHistory.js");

const { createStreetHistory, continuesLine } = globalThis.PokerCoachAnalysisStreetHistory;

const preflop = [{ actor: "BTN", action: "open", amount: 2.5 }, { actor: "BB", action: "call", amount: 2.5 }];
const flop = [{ actor: "BB", action: "check", amount: 0 }, { actor: "BTN", action: "bet", amount: 2.8 }, { actor: "BB", action: "call", amount: 2.8 }];
const turnCheck = [{ actor: "BB", action: "check", amount: 0 }];
const turnRaise = [...turnCheck, { actor: "BTN", action: "bet", amount: 3.7 }, { actor: "BB", action: "raise", amount: 9.9 }];
const seats = { heroHand: "As 3h", heroPosition: "BTN", villainPosition: "BB" };

const flopSpot = { ...seats, street: "flop", board: "8s 3s Th", allStreetActions: { preflop, flop: flop.slice(0, 1) } };
const turnSpot = { ...seats, street: "turn", board: "8s 3s Th Js", allStreetActions: { preflop, flop, turn: turnCheck } };
const turnFacingRaise = { ...turnSpot, allStreetActions: { preflop, flop, turn: turnRaise } };
const riverSpot = { ...seats, street: "river", board: "8s 3s Th Js 8h", allStreetActions: { preflop, flop, turn: [...turnRaise, { actor: "BTN", action: "call", amount: 9.9 }], river: turnCheck } };

assert.ok(continuesLine(flopSpot, riverSpot), "the river spot continues the flop decision");
assert.ok(!continuesLine(riverSpot, flopSpot), "a later street never counts as earlier");
assert.ok(!continuesLine(flopSpot, { ...riverSpot, board: "8s 3s 9h Js 8h" }), "a different flop is a different hand");
assert.ok(!continuesLine(flopSpot, { ...riverSpot, heroHand: "Ah 3h" }), "a different hero hand is a different hand");
assert.ok(
  !continuesLine(turnSpot, { ...riverSpot, allStreetActions: { ...riverSpot.allStreetActions, turn: [{ actor: "BB", action: "bet", amount: 5 }] } }),
  "a different turn line does not continue the turn decision",
);

const history = createStreetHistory();
history.record(flopSpot, { equityMetric: { html: "flop" } });
history.record(turnFacingRaise, { equityMetric: { html: "turn vs raise" } });
history.record(turnSpot, { equityMetric: { html: "turn first" } });
assert.equal(history.lookup(riverSpot, "flop").equityMetric.html, "flop");
assert.equal(history.lookup(riverSpot, "turn").equityMetric.html, "turn vs raise", "the latest decision on a street wins");
assert.equal(history.lookup(riverSpot, "river"), null, "the current street is never served from history");
assert.equal(history.lookup({ ...riverSpot, board: "8s 3s 9h Js 8h" }, "flop"), null, "another hand does not see this hand's history");

console.log("analysisStreetHistory tests passed");
