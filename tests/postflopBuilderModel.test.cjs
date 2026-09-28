const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadGlobal(file, name) {
  const sandbox = { globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, `../public/${file}`), "utf8"), sandbox);
  return sandbox.globalThis[name];
}

const preflop = loadGlobal("preflopBuilderModel.js", "PokerCoachPreflopBuilderModel");
const postflop = loadGlobal("postflopBuilderModel.js", "PokerCoachPostflopBuilderModel");

function testConvertsCompletedPreflopState() {
  const state = postflop.createFromPreflop(preflop.createInitialState({ example: true }));

  assert.equal(state.street, "flop");
  assert.equal(state.potUnits, 190);
  assert.equal(state.players.SB.stackUnits, 910);
  assert.equal(state.players.UTG.stackUnits, 910);
  assert.equal(state.players.BB.folded, true);
  assert.deepEqual(Array.from(state.heroCards), ["Ah", "Kh"]);
  assert.deepEqual(JSON.parse(JSON.stringify(state.board)), { flop: [], turn: null, river: null });
  assert.equal(state.currentActor, null, "board entry precedes flop action");
  assert.equal(postflop.toPostflopUnits(6.3), 63);
  assert.equal(postflop.formatPostflopBb(63), "6.3");
}

function testSetsFlopAndStartsWithFirstActivePostflopPlayer() {
  let state = postflop.createFromPreflop(preflop.createInitialState({ example: true }));
  state = postflop.setBoardCards(state, "flop", ["Qh", "7s", "4h"]);

  assert.deepEqual(Array.from(state.board.flop), ["Qh", "7s", "4h"]);
  assert.equal(state.currentActor, "SB");
  assert.deepEqual(Array.from(postflop.usedCards(state)), ["Ah", "Kh", "Qh", "7s", "4h"]);
}

function testRejectsInvalidBoardProgressionAndDuplicateCards() {
  const state = postflop.createFromPreflop(preflop.createInitialState({ example: true }));

  assert.throws(() => postflop.setBoardCards(state, "flop", ["Ah", "7s", "4h"]), /already in use/i);
  assert.throws(() => postflop.setBoardCards(state, "turn", ["Jc"]), /complete the flop/i);
  assert.throws(() => postflop.setBoardCards(state, "flop", ["Qh", "7s"]), /exactly three/i);
  assert.throws(() => postflop.setBoardCards(state, "flop", ["Qh", "Qh", "4h"]), /unique/i);
}

function referenceFlop() {
  return postflop.setBoardCards(
    postflop.createFromPreflop(preflop.createInitialState({ example: true })),
    "flop",
    ["Qh", "7s", "4h"],
  );
}

function testBetCallUpdatesPotStacksAndClosesAction() {
  let state = referenceFlop();
  assert.deepEqual(
    Array.from(postflop.legalActions(state).actions, (action) => action.type),
    ["check", "bet", "allin"],
  );
  assert.deepEqual(
    Array.from(postflop.betSizePresets(state), ({ fraction, amountUnits }) => ({ fraction, amountUnits })),
    [
      { fraction: "1/4", amountUnits: 48 },
      { fraction: "1/3", amountUnits: 63 },
      { fraction: "1/2", amountUnits: 95 },
      { fraction: "2/3", amountUnits: 127 },
      { fraction: "Pot", amountUnits: 190 },
    ],
  );

  state = postflop.applyAction(state, { actor: "SB", type: "bet", targetStreetContributionUnits: 63 });
  assert.equal(state.potUnits, 253);
  assert.equal(state.players.SB.stackUnits, 847);
  assert.equal(state.currentActor, "UTG");
  assert.equal(postflop.legalActions(state).amountToCallUnits, 63);
  assert.deepEqual(
    Array.from(postflop.legalActions(state).actions, (action) => action.type),
    ["fold", "call", "raise", "allin"],
  );

  state = postflop.applyAction(state, { actor: "UTG", type: "call", targetStreetContributionUnits: 63 });
  assert.equal(state.potUnits, 316);
  assert.equal(state.players.UTG.stackUnits, 847);
  assert.equal(state.streetComplete, true);
  assert.equal(state.currentActor, null);
  assert.deepEqual(
    JSON.parse(JSON.stringify(state.streetActions.flop)).map((action) => ({
      actor: action.actor,
      incrementAmountUnits: action.incrementAmountUnits,
      potBeforeUnits: action.potBeforeUnits,
      potAfterUnits: action.potAfterUnits,
    })),
    [
      { actor: "SB", incrementAmountUnits: 63, potBeforeUnits: 190, potAfterUnits: 253 },
      { actor: "UTG", incrementAmountUnits: 63, potBeforeUnits: 253, potAfterUnits: 316 },
    ],
  );
}

function testCheckThroughFoldAndInvalidActions() {
  let state = referenceFlop();
  assert.throws(
    () => postflop.applyAction(state, { actor: "UTG", type: "check", targetStreetContributionUnits: 0 }),
    /SB is next/i,
  );
  state = postflop.applyAction(state, { actor: "SB", type: "check", targetStreetContributionUnits: 0 });
  state = postflop.applyAction(state, { actor: "UTG", type: "check", targetStreetContributionUnits: 0 });
  assert.equal(state.streetComplete, true);
  assert.equal(state.potUnits, 190);

  let folded = referenceFlop();
  folded = postflop.applyAction(folded, { actor: "SB", type: "bet", targetStreetContributionUnits: 48 });
  folded = postflop.applyAction(folded, { actor: "UTG", type: "fold", targetStreetContributionUnits: 0 });
  assert.equal(folded.handComplete, true);
  assert.equal(folded.streetComplete, true);
  assert.equal(folded.potUnits, 238);

  const oversized = referenceFlop();
  assert.throws(
    () => postflop.applyAction(oversized, { actor: "SB", type: "bet", targetStreetContributionUnits: 920 }),
    /stack/i,
  );
}

testConvertsCompletedPreflopState();
testSetsFlopAndStartsWithFirstActivePostflopPlayer();
testRejectsInvalidBoardProgressionAndDuplicateCards();
testBetCallUpdatesPotStacksAndClosesAction();
testCheckThroughFoldAndInvalidActions();
