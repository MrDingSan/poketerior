const assert = require("node:assert/strict");
require("../public/preflopBuilderModel.js");
require("../public/postflopBuilderModel.js");
require("../public/importBuilderAdapter.js");
const adapter = globalThis.PokerCoachImportBuilderAdapter;

const hand = {
  handId: "import-1",
  heroName: "Hero",
  heroHand: ["Ah", "Kh"],
  players: [
    { name: "Opener", position: "UTG", stackBb: 100 },
    { name: "HJ", position: "HJ", stackBb: 100 },
    { name: "CO", position: "CO", stackBb: 100 },
    { name: "BTN", position: "BTN", stackBb: 100 },
    { name: "Hero", position: "SB", stackBb: 100, isHero: true },
    { name: "BB", position: "BB", stackBb: 100 },
  ],
  board: { flop: ["Qh", "7s", "4h"], turn: "Jc", river: "2d" },
  streets: {
    preflop: { actions: [
      { actor: "Opener", position: "UTG", action: "raise", amountBb: 2.5 },
      { actor: "HJ", position: "HJ", action: "fold", amountBb: null },
      { actor: "CO", position: "CO", action: "fold", amountBb: null },
      { actor: "BTN", position: "BTN", action: "fold", amountBb: null },
      { actor: "Hero", position: "SB", action: "raise", amountBb: 9 },
      { actor: "BB", position: "BB", action: "fold", amountBb: null },
      { actor: "Opener", position: "UTG", action: "call", amountBb: 6.5 },
    ] },
    flop: { actions: [
      { actor: "Hero", position: "SB", action: "check", amountBb: null },
      { actor: "Opener", position: "UTG", action: "bet", amountBb: 5 },
      { actor: "Hero", position: "SB", action: "call", amountBb: 5 },
    ] },
    turn: { actions: [
      { actor: "Hero", position: "SB", action: "check", amountBb: null },
      { actor: "Opener", position: "UTG", action: "bet", amountBb: 8.2 },
      { actor: "Hero", position: "SB", action: "call", amountBb: 8.2 },
    ] },
    river: { actions: [
      { actor: "Hero", position: "SB", action: "check", amountBb: null },
      { actor: "Opener", position: "UTG", action: "bet", amountBb: 9 },
      { actor: "Hero", position: "SB", action: "call", amountBb: 9 },
    ] },
  },
  validationWarnings: ["River amount was low confidence."],
};

function testConvertsCompleteImportWithoutMutatingEvidence() {
  const sourceJson = JSON.stringify(hand);
  const converted = adapter.fromImportedHand(hand, { heroName: "Hero" });

  assert.equal(converted.preflopState.potUnits, 38);
  assert.equal(converted.postflopState.potUnits, 634);
  assert.equal(converted.postflopState.street, "results");
  assert.deepEqual(Array.from(converted.postflopState.board.flop), ["Qh", "7s", "4h"]);
  assert.equal(converted.postflopState.board.turn, "Jc");
  assert.equal(converted.actionIndex["turn:1"].actor, "UTG");
  assert.equal(converted.actionIndex["turn:1"].recordedAction.action, "bet");
  assert.deepEqual(Array.from(converted.warnings), ["River amount was low confidence."]);
  assert.equal(JSON.stringify(hand), sourceJson);
  assert.notEqual(converted.sourceHand, hand);
}

function testReportsMissingAggressiveAmountInsteadOfGuessing() {
  const broken = JSON.parse(JSON.stringify(hand));
  broken.streets.flop.actions[1].amountBb = null;
  const converted = adapter.fromImportedHand(broken, { heroName: "Hero" });

  assert.match(converted.unresolved[0].message, /amount/i);
  assert.equal(converted.unresolved[0].key, "flop:1");
  assert.equal(converted.postflopState.street, "flop");
  assert.equal(converted.postflopState.streetActions.flop.length, 1);
}

function testUsesExtractedShortStackAndAntesForAllInReplay() {
  const short = JSON.parse(JSON.stringify(hand));
  short.players.find((player) => player.position === "UTG").stackBb = 20;
  short.streets.preflop.actions = [
    ...short.players.map((player) => ({ actor: player.name, position: player.position, action: "ante", amountBb: 0.1 })),
    { actor: "Opener", position: "UTG", action: "allin", amountBb: 20 },
    { actor: "HJ", position: "HJ", action: "fold" },
    { actor: "CO", position: "CO", action: "fold" },
    { actor: "BTN", position: "BTN", action: "fold" },
    { actor: "Hero", position: "SB", action: "fold" },
    { actor: "BB", position: "BB", action: "fold" },
  ];
  short.board = { flop: [], turn: null, river: null };
  short.streets.flop.actions = [];
  short.streets.turn.actions = [];
  short.streets.river.actions = [];
  const converted = adapter.fromImportedHand(short, { heroName: "Hero" });

  assert.equal(converted.preflopState.seats.UTG.stackUnits, 40);
  assert.equal(converted.preflopState.potUnits, 44);
  assert.equal(converted.preflopState.seats.UTG.allin, true);
}

testConvertsCompleteImportWithoutMutatingEvidence();
testReportsMissingAggressiveAmountInsteadOfGuessing();
testUsesExtractedShortStackAndAntesForAllInReplay();

(function testInfersMissingSeatWhenOnlyOneSeatIsFree() {
  const noSeat = JSON.parse(JSON.stringify(hand));
  noSeat.players.find((player) => player.name === "Opener").position = "?";
  for (const action of Object.values(noSeat.streets).flatMap((street) => street.actions)) {
    if (action.actor === "Opener") action.position = "?";
  }
  const converted = adapter.fromImportedHand(noSeat, { heroName: "Hero" });
  assert.equal(converted.sourceHand.players.find((player) => player.name === "Opener").position, "UTG");
  assert.equal(converted.unresolved.length, 0, JSON.stringify(converted.unresolved));
})();

(function testImpliedChecksUnlockLaterPostflopActions() {
  const h = JSON.parse(JSON.stringify(hand));
  // Opener (UTG) acts first postflop, so the SB hero's later bet needs no implied check; drop the opener check instead.
  h.streets.flop.actions = [
    { actor: "Hero", position: "SB", action: "check", amountBb: null },
    { actor: "Opener", position: "UTG", action: "bet", amountBb: 5 },
    { actor: "Hero", position: "SB", action: "call", amountBb: 5 },
  ];
  const skipped = JSON.parse(JSON.stringify(h));
  skipped.streets.flop.actions.shift();
  const converted = adapter.fromImportedHand(skipped, { heroName: "Hero" });
  assert.equal(converted.unresolved.filter((entry) => entry.key === "flop:0").length, 0, JSON.stringify(converted.unresolved));
})();

(function testEndOfHandStacksDoNotBlockLaterBets() {
  const h = JSON.parse(JSON.stringify(hand));
  h.players.find((player) => player.name === "Opener").stackBb = 40;
  h.streets.turn.actions = [
    { actor: "Hero", position: "SB", action: "check", amountBb: null },
    { actor: "Opener", position: "UTG", action: "bet", amountBb: 30 },
    { actor: "Hero", position: "SB", action: "call", amountBb: 30 },
  ];
  const converted = adapter.fromImportedHand(h, { heroName: "Hero" });
  assert.equal(converted.unresolved.filter((entry) => entry.key.startsWith("turn")).length, 0, JSON.stringify(converted.unresolved));
})();

// Hand-History-1790497998567: CO posted a big blind to join ("AUTOBB"), everyone folded to CO, CO checked,
// Hero (BB) raised and CO called. The post must count as CO's wager, so the check is legal and every
// later decision stays selectable.
{
  const autoBb = adapter.fromImportedHand({
    heroName: "hero",
    heroHand: ["Jh", "Jc"],
    board: { flop: ["Qd", "8h", "4h"], turn: "Qc", river: "7c" },
    players: [
      { name: "sb", position: "SB", stackBb: 151 },
      { name: "hero", position: "BB", stackBb: 70.2, isHero: true },
      { name: "co", position: "CO", stackBb: 100 },
      { name: "utg", position: "UTG", stackBb: 100 },
      { name: "mp", position: "MP", stackBb: 113 },
      { name: "btn", position: "BTN", stackBb: 249 },
    ],
    streets: {
      preflop: {
        actions: [
          { actor: "sb", position: "SB", action: "blind", amountBb: 0.5 },
          { actor: "hero", position: "BB", action: "blind", amountBb: 1 },
          { actor: "co", position: "CO", action: "blind", amountBb: 1 },
          { actor: "utg", position: "UTG", action: "fold" },
          { actor: "mp", position: "MP", action: "fold" },
          { actor: "co", position: "CO", action: "check" },
          { actor: "btn", position: "BTN", action: "fold" },
          { actor: "sb", position: "SB", action: "fold" },
          { actor: "hero", position: "BB", action: "raise", amountBb: 3.5 },
          { actor: "co", position: "CO", action: "call", amountBb: 2.5 },
        ],
      },
      flop: { actions: [{ actor: "hero", position: "BB", action: "bet", amountBb: 4.3 }, { actor: "co", position: "CO", action: "call", amountBb: 4.3 }] },
    },
  }, { heroName: "hero" });
  assert.deepEqual(autoBb.unresolved, []);
  assert.equal(autoBb.preflopState.potUnits, 2 * (0.5 + 3.5 + 3.5));
  assert.ok(autoBb.actionIndex["flop:0"], "decisions after the posted blind stay available");
  console.log("posted-blind import checks passed");
}
