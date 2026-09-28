const assert = require("node:assert/strict");
require("../public/preflopBuilderModel.js");
require("../public/postflopBuilderModel.js");
require("../public/importBuilderAdapter.js");
const adapter = globalThis.PokerCoachImportBuilderAdapter;

const hand = {
  heroName: "Hero", heroHand: ["Ah", "Kh"],
  players: [
    { name: "V", position: "UTG", stackBb: 100 }, { name: "H", position: "HJ", stackBb: 100 },
    { name: "C", position: "CO", stackBb: 100 }, { name: "D", position: "BTN", stackBb: 100 },
    { name: "Hero", position: "SB", stackBb: 100, isHero: true }, { name: "B", position: "BB", stackBb: 100 },
  ],
  board: { flop: ["Qh", "7s", "4h"], turn: "Jc", river: "2d" },
  streets: {
    preflop: { actions: [
      { actor: "V", position: "UTG", action: "raise", amountBb: 2.5 },
      { actor: "H", position: "HJ", action: "fold" }, { actor: "C", position: "CO", action: "fold" },
      { actor: "D", position: "BTN", action: "fold" },
      { actor: "Hero", position: "SB", action: "raise", amountBb: 9 },
      { actor: "B", position: "BB", action: "fold" },
      { actor: "V", position: "UTG", action: "call", amountBb: 6.5 },
    ] },
    flop: { actions: [{ actor: "Hero", position: "SB", action: "check" }, { actor: "V", position: "UTG", action: "check" }] },
    turn: { actions: [{ actor: "Hero", position: "SB", action: "check" }, { actor: "V", position: "UTG", action: "check" }] },
    river: { actions: [{ actor: "Hero", position: "SB", action: "check" }, { actor: "V", position: "UTG", action: "check" }] },
  },
};

function testEditingFlopActionDiscardsLaterStreets() {
  const converted = adapter.fromImportedHand(hand, { heroName: "Hero" });
  const result = adapter.editImportedAction(converted, "flop:0", { action: "bet", amountBb: 6 });
  assert.deepEqual(Array.from(result.discardedStreets), ["turn", "river"]);
  assert.equal(result.converted.sourceHand.streets.flop.actions.length, 1);
  assert.equal(result.converted.sourceHand.streets.flop.actions[0].action, "bet");
  assert.deepEqual(Array.from(result.converted.sourceHand.streets.turn.actions), []);
  assert.equal(result.converted.sourceHand.board.turn, null);
  assert.equal(result.converted.sourceHand.board.river, null);
  assert.equal(result.converted.sourceHand.streets.flop.actions[0].userCorrected, true);
  assert.equal(hand.streets.flop.actions[0].action, "check");
}

function testDuplicateCardCorrectionIsRejectedWithoutChangingSource() {
  const converted = adapter.fromImportedHand(hand, { heroName: "Hero" });
  assert.throws(() => adapter.editImportedCards(converted, "flop", ["Ah", "7s", "4h"]), /already in use/i);
  assert.deepEqual(Array.from(converted.sourceHand.board.flop), ["Qh", "7s", "4h"]);
}

function testChangingHeroDoesNotMutateOriginalConversion() {
  const converted = adapter.fromImportedHand(hand, { heroName: "Hero" });
  const changed = adapter.changeImportedHero(converted, "V");
  assert.equal(changed.converted.sourceHand.heroName, "V");
  assert.equal(changed.converted.sourceHand.players.find((player) => player.name === "V").isHero, true);
  assert.equal(converted.sourceHand.heroName, "Hero");
}

testEditingFlopActionDiscardsLaterStreets();
testDuplicateCardCorrectionIsRejectedWithoutChangingSource();
testChangingHeroDoesNotMutateOriginalConversion();
