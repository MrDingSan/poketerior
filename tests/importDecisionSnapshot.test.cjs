const assert = require("node:assert/strict");
require("../public/preflopBuilderModel.js");
require("../public/postflopBuilderModel.js");
require("../public/importBuilderAdapter.js");
require("../public/importDecisionModel.js");

const adapter = globalThis.PokerCoachImportBuilderAdapter;
const decisions = globalThis.PokerCoachImportDecisionModel;

const hand = {
  heroName: "Hero",
  heroHand: ["Ah", "Kh"],
  players: [
    { name: "Villain", position: "UTG", stackBb: 100 },
    { name: "HJ", position: "HJ", stackBb: 100 },
    { name: "CO", position: "CO", stackBb: 100 },
    { name: "BTN", position: "BTN", stackBb: 100 },
    { name: "Hero", position: "SB", stackBb: 100, isHero: true },
    { name: "BB", position: "BB", stackBb: 100 },
  ],
  board: { flop: ["Qh", "7s", "4h"], turn: null, river: null },
  streets: {
    preflop: { actions: [
      { actor: "Villain", position: "UTG", action: "raise", amountBb: 2.5 },
      { actor: "HJ", position: "HJ", action: "fold" },
      { actor: "CO", position: "CO", action: "fold" },
      { actor: "BTN", position: "BTN", action: "fold" },
      { actor: "Hero", position: "SB", action: "raise", amountBb: 9 },
      { actor: "BB", position: "BB", action: "fold" },
      { actor: "Villain", position: "UTG", action: "call", amountBb: 6.5 },
    ] },
    flop: { actions: [
      { actor: "Hero", position: "SB", action: "check" },
      { actor: "Villain", position: "UTG", action: "bet", amountBb: 5 },
      { actor: "Hero", position: "SB", action: "call", amountBb: 5 },
    ] },
    turn: { actions: [] },
    river: { actions: [] },
  },
};

const converted = adapter.fromImportedHand(hand, { heroName: "Hero" });

function testHeroCallSnapshotStopsBeforeRecordedCall() {
  const snapshot = decisions.decisionSnapshotForAction(converted, "flop:2");
  assert.equal(snapshot.owner.position, "SB");
  assert.equal(snapshot.recordedAction.action, "call");
  assert.equal(snapshot.stateBefore.streetActions.flop.length, 2);
  assert.equal(snapshot.stateBefore.currentActor, "SB");
  assert.deepEqual(Array.from(snapshot.legalActions, (action) => action.type), ["fold", "call", "raise", "allin"]);
  assert.equal(snapshot.stateBefore.preflopActions.length, 7);
}

function testOpponentBetSnapshotMakesOpponentDecisionOwner() {
  const snapshot = decisions.decisionSnapshotForAction(converted, "flop:1");
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.owner)), { name: "Villain", position: "UTG", isHero: false });
  assert.equal(snapshot.stateBefore.currentActor, "UTG");
  assert.equal(snapshot.stateBefore.streetActions.flop.length, 1);
  assert.deepEqual(Array.from(snapshot.legalActions, (action) => action.type), ["check", "bet", "allin"]);
}

function testSelectableKeysExcludeForcedBookkeepingAndFolds() {
  assert.deepEqual(
    Array.from(decisions.selectableDecisionKeys(converted)),
    ["preflop:0", "preflop:4", "preflop:6", "flop:0", "flop:1", "flop:2"],
  );
}

testHeroCallSnapshotStopsBeforeRecordedCall();
testOpponentBetSnapshotMakesOpponentDecisionOwner();
testSelectableKeysExcludeForcedBookkeepingAndFolds();
