const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../public/preflopBuilderModel.js"), "utf8"),
  sandbox,
);
const model = sandbox.globalThis.PokerCoachPreflopBuilderModel;

function exampleState() {
  return model.createInitialState({ example: true });
}

function testInitialStateStartsAsCleanSheet() {
  const state = model.createInitialState();

  assert.deepEqual(Array.from(state.heroCards), []);
  assert.equal(state.actions.length, 0);
  assert.equal(state.potUnits, 3);
  assert.equal(model.formatBb(state.potUnits), "1.5");
}

function testExplicitExampleCalculatesNineteenBigBlinds() {
  const state = exampleState();

  assert.equal(state.heroPosition, "SB");
  assert.deepEqual(Array.from(state.heroCards), ["Ah", "Kh"]);
  assert.equal(state.potUnits, 38);
  assert.equal(model.formatBb(state.potUnits), "19");
  assert.deepEqual(
    JSON.parse(JSON.stringify(state.actions))
      .filter((action) => !action.automatic)
      .map(({ actor, type, targetUnits }) => ({ actor, type, targetUnits })),
    [
      { actor: "UTG", type: "raise", targetUnits: 5 },
      { actor: "SB", type: "raise", targetUnits: 18 },
      { actor: "UTG", type: "call", targetUnits: 18 },
    ],
  );
}

function testInfersActorOrderAndLegalActions() {
  let state = model.createInitialState({ empty: true });
  assert.equal(state.currentActor, "UTG");
  assert.deepEqual(
    Array.from(model.legalActions(state).actions, (item) => item.type),
    ["fold", "call", "raise", "allin"],
  );

  state = model.applyAction(state, { actor: "UTG", type: "raise", targetUnits: 5 });
  assert.equal(state.currentActor, "HJ");
  assert.equal(model.legalActions(state).amountToCallUnits, 5);
  assert.equal(model.legalActions(state).actions.find((item) => item.type === "call").label, "Call 2.5 bb");
  assert.equal(model.legalActions(state).actions.find((item) => item.type === "raise").label, "3-Bet");

  state = model.applyAction(state, { actor: "HJ", type: "fold", targetUnits: 0 });
  assert.equal(state.currentActor, "CO");
  assert.throws(
    () => model.applyAction(state, { actor: "BTN", type: "call", targetUnits: 5 }),
    /CO is next to act/,
  );
}

function testBlindsAreLiveContributionsAndCallsShowOnlyTheAdditionalAmount() {
  let state = model.createInitialState({ empty: true, heroPosition: "BB" });
  state = model.applyAction(state, { actor: "UTG", type: "fold", targetUnits: 0 });
  state = model.applyAction(state, { actor: "HJ", type: "raise", targetUnits: 5 });
  state = model.applyAction(state, { actor: "CO", type: "fold", targetUnits: 0 });
  state = model.applyAction(state, { actor: "BTN", type: "fold", targetUnits: 0 });
  state = model.applyAction(state, { actor: "SB", type: "fold", targetUnits: 1 });

  assert.equal(state.currentActor, "BB");
  assert.equal(state.contributions.SB, 1);
  assert.equal(state.contributions.BB, 2);
  assert.equal(state.potUnits, 8);
  assert.equal(model.legalActions(state).amountToCallUnits, 3);
  assert.equal(model.legalActions(state).actions.find((item) => item.type === "call").label, "Call 1.5 bb");
}

function testValidatesSizingAndRewindsEdits() {
  const openState = model.createInitialState({ empty: true });
  assert.throws(
    () => model.applyAction(openState, { actor: "UTG", type: "raise", targetUnits: 2 }),
    /minimum raise/i,
  );
  assert.equal(model.isAnalyzable(openState), false);
  assert.equal(model.isAnalyzable(exampleState()), true);

  const example = exampleState();
  const edited = model.replaceAction(example, 4, { actor: "SB", type: "raise", targetUnits: 20 });
  assert.equal(edited.actions.length, 5);
  assert.equal(edited.potUnits, 27);
  assert.equal(edited.currentActor, "BB");
}

function testUpdatesHeroCardsAndResetsOnlyHandData() {
  const example = exampleState();
  assert.deepEqual(Array.from(model.setHeroCards(example, ["As", "Kd"]).heroCards), ["As", "Kd"]);
  assert.deepEqual(Array.from(model.setHeroCards(example, ["5s", "Qd"]).heroCards), ["Qd", "5s"]);
  assert.throws(() => model.setHeroCards(example, ["As", "As"]), /unique/i);
  assert.equal(model.setHero(example, "BTN").heroPosition, "BTN");

  const reset = model.resetHand(example);
  assert.equal(reset.actions.length, 0);
  assert.deepEqual(Array.from(reset.heroCards), []);
  assert.deepEqual(JSON.parse(JSON.stringify(reset.settings)), JSON.parse(JSON.stringify(example.settings)));
}

function testInitialHeroCardsAreStoredHighestRankFirst() {
  const state = model.createInitialState({ heroCards: ["5s", "Qd"] });
  assert.deepEqual(Array.from(state.heroCards), ["Qd", "5s"]);
}

function testConvertsExampleToLegacyAnalysisInput() {
  const legacy = JSON.parse(JSON.stringify(model.toLegacyPreflopInput(exampleState())));
  assert.deepEqual(legacy, {
    heroPosition: "SB",
    heroHand: "Ah Kh",
    villainPosition: "UTG",
    preflopActions: [
      { actor: "UTG", action: "open", amount: 2.5 },
      { actor: "HJ", action: "fold", amount: 0 },
      { actor: "CO", action: "fold", amount: 0 },
      { actor: "BTN", action: "fold", amount: 0 },
      { actor: "SB", action: "raise", amount: 9 },
      { actor: "BB", action: "fold", amount: 1 },
      { actor: "UTG", action: "call", amount: 9 },
    ],
    preflopPotBb: 19,
    preflopCallBb: 0,
  });
}

testInitialStateStartsAsCleanSheet();
testExplicitExampleCalculatesNineteenBigBlinds();
testInfersActorOrderAndLegalActions();
testBlindsAreLiveContributionsAndCallsShowOnlyTheAdditionalAmount();
testValidatesSizingAndRewindsEdits();
testUpdatesHeroCardsAndResetsOnlyHandData();
testInitialHeroCardsAreStoredHighestRankFirst();
testConvertsExampleToLegacyAnalysisInput();
