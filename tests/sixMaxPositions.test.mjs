import assert from "node:assert/strict";
import { fillSixMaxPositions } from "../src/analysis/pipeline.js";

const players = (pairs) => pairs.map(([name, position]) => ({ name, position }));
const preflop = (rows) => ({ preflop: { actions: rows.map(([actor, action]) => ({ actor, action, position: null })) } });

// CoinPoker's "UTG+1" badge, returned verbatim or as HJ/LJ, is the 6-max MP seat.
for (const label of ["UTG+1", "utg1", "HJ", "LJ"]) {
  assert.equal(fillSixMaxPositions({ players: players([["a", label]]) }).players[0].position, "MP");
}

// Six-handed, hero's badge missed by the vision model: the only free seat between UTG and CO is MP,
// and hero's action rows pick it up so the hand's decisions can load.
let hand = fillSixMaxPositions({
  players: players([["sb", "SB"], ["bb", "BB"], ["utg", "UTG"], ["hero", null], ["co", "CO"], ["btn", "BTN"]]),
  streets: {
    ...preflop([["sb", "blind"], ["bb", "blind"], ["utg", "raise"], ["hero", "call"], ["co", "fold"], ["btn", "fold"]]),
    flop: { actions: [{ actor: "hero", action: "check", position: null }] },
  },
});
assert.equal(hand.players[3].position, "MP");
assert.equal(hand.streets.preflop.actions[3].position, "MP");
assert.equal(hand.streets.flop.actions[0].position, "MP");

// Five-handed (no CO): both MP and CO are unused, so action order decides - the seat right after UTG.
hand = fillSixMaxPositions({
  players: players([["btn", "BTN"], ["sb", "SB"], ["bb", "BB"], ["utg", "UTG"], ["hero", null]]),
  streets: preflop([["sb", "blind"], ["bb", "blind"], ["utg", "fold"], ["hero", "raise"], ["btn", "fold"]]),
});
assert.equal(hand.players[4].position, "MP");

// A seat acting after MP and before BTN is the CO.
hand = fillSixMaxPositions({
  players: players([["utg", "UTG"], ["mp", "MP"], ["hero", null], ["btn", "BTN"], ["sb", "SB"], ["bb", "BB"]]),
  streets: preflop([["utg", "fold"], ["mp", "fold"], ["hero", "raise"], ["btn", "fold"]]),
});
assert.equal(hand.players[2].position, "CO");

// Two unlabeled players can't be placed with confidence; leave them for the user to fix.
hand = fillSixMaxPositions({ players: players([["a", null], ["b", null], ["c", "BTN"]]) });
assert.deepEqual(hand.players.map((p) => p.position), [null, null, "BTN"]);

console.log("six-max position backstop tests passed");
