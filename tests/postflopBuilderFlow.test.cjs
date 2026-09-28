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

function checkThrough(state) {
  while (state.currentActor) {
    state = postflop.applyAction(state, {
      actor: state.currentActor,
      type: "check",
      targetStreetContributionUnits: state.players[state.currentActor].streetContributionUnits,
    });
  }
  return state;
}

function buildCompleteHand() {
  let state = postflop.createFromPreflop(preflop.createInitialState({ example: true }));
  state = postflop.setBoardCards(state, "flop", ["Qh", "7s", "4h"]);
  state = checkThrough(state);
  state = postflop.advanceStreet(state);
  state = postflop.setBoardCards(state, "turn", ["Jc"]);
  state = checkThrough(state);
  state = postflop.advanceStreet(state);
  state = postflop.setBoardCards(state, "river", ["2d"]);
  state = checkThrough(state);
  return postflop.advanceStreet(state);
}

function testAdvancesFromFlopThroughResults() {
  const state = buildCompleteHand();

  assert.equal(state.street, "results");
  assert.deepEqual(JSON.parse(JSON.stringify(state.board)), {
    flop: ["Qh", "7s", "4h"],
    turn: "Jc",
    river: "2d",
  });
  assert.equal(state.potUnits, 190);
  assert.equal(state.streetActions.flop.length, 2);
  assert.equal(state.streetActions.turn.length, 2);
  assert.equal(state.streetActions.river.length, 2);
  assert.throws(() => postflop.advanceStreet(state), /results/i);
}

function testRewindingFlopClearsAllDownstreamState() {
  const complete = buildCompleteHand();
  complete.rangesByStreet = { preflop: { comboCount: 144 }, flop: { comboCount: 100 }, turn: { comboCount: 80 } };
  complete.analysisByStreet = { flop: { confidence: "high" }, river: { confidence: "medium" } };
  const rewound = postflop.rewindToStreet(complete, "flop");

  assert.equal(rewound.street, "flop");
  assert.deepEqual(Array.from(rewound.board.flop), ["Qh", "7s", "4h"]);
  assert.equal(rewound.board.turn, null);
  assert.equal(rewound.board.river, null);
  assert.equal(rewound.streetActions.flop.length, 0);
  assert.equal(rewound.streetActions.turn.length, 0);
  assert.equal(rewound.streetActions.river.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(rewound.rangesByStreet)), { preflop: { comboCount: 144 } });
  assert.deepEqual(JSON.parse(JSON.stringify(rewound.analysisByStreet)), {});
  assert.ok(rewound.preflopActions.length > 0);
  assert.equal(rewound.currentActor, "SB");
}

function testReplacesActionAndProducesLegacyAnalysisInput() {
  let state = postflop.createFromPreflop(preflop.createInitialState({ example: true }));
  state = postflop.setBoardCards(state, "flop", ["Qh", "7s", "4h"]);
  state = checkThrough(state);
  state = postflop.replaceAction(state, "flop", 0, {
    actor: "SB",
    type: "bet",
    targetStreetContributionUnits: 63,
  });

  assert.equal(state.streetActions.flop.length, 1);
  assert.equal(state.currentActor, "UTG");
  const legacy = JSON.parse(JSON.stringify(postflop.toLegacyAnalysisInput(state)));
  assert.equal(legacy.heroPosition, "SB");
  assert.equal(legacy.heroHand, "Ah Kh");
  assert.equal(legacy.boardCards, "Qh 7s 4h");
  assert.equal(legacy.potSize, 25.3);
  assert.deepEqual(legacy.actionsByStreet.flop, [{ actor: "SB", action: "bet", amount: 6.3 }]);
}

function testTurnBetSurvivesLegacyAnalysisHandoff() {
  let state = postflop.createFromPreflop(preflop.createInitialState({ example: true }));
  state = postflop.setBoardCards(state, "flop", ["3c", "Ks", "Jd"]);
  state = checkThrough(state);
  state = postflop.advanceStreet(state);
  state = postflop.setBoardCards(state, "turn", ["5c"]);
  state = postflop.applyAction(state, { actor: "SB", type: "bet", targetStreetContributionUnits: 45 });

  const legacy = postflop.toLegacyAnalysisInput(state);
  assert.deepEqual(JSON.parse(JSON.stringify(legacy.actionsByStreet.turn)), [
    { actor: "SB", action: "bet", amount: 4.5 },
  ]);
  assert.deepEqual(Array.from(postflop.legalActions(state).actions, (action) => action.type), ["fold", "call", "raise", "allin"]);
}

testAdvancesFromFlopThroughResults();
testRewindingFlopClearsAllDownstreamState();
testReplacesActionAndProducesLegacyAnalysisInput();
testTurnBetSurvivesLegacyAnalysisHandoff();
