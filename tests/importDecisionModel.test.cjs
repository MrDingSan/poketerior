const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/importDecisionModel.js"), "utf8");
const sandbox = { window: {}, globalThis: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: "importDecisionModel.js" });

const model = sandbox.PokerCoachImportDecisionModel;
assert.ok(model, "import decision model should be attached to global scope");

const hand = {
  heroName: null,
  players: [
    { name: "Chlwlsdnr", position: "SB", isHero: false },
    { name: "DerKalm", position: "BTN", isHero: false },
    { name: "BigDweaner", position: "BB", isHero: false },
    { name: "dingsanpro", position: "UTG", isHero: true },
  ],
  streets: {
    flop: {
      actions: [
        { actor: "BigDweaner", position: "BB", action: "check", amountBb: null },
        { actor: "dingsanpro", position: "UTG", action: "bet", amountBb: 1.65 },
        { actor: "BigDweaner", position: "BB", action: "raise", amountBb: 9.95 },
        { actor: "dingsanpro", position: "UTG", action: "raise", amountBb: 22.4 },
        { actor: "BigDweaner", position: "BB", action: "call", amountBb: 12.45 },
      ],
    },
    turn: {
      actions: [
        { actor: "BigDweaner", position: "BB", action: "check", amountBb: null },
        { actor: "dingsanpro", position: "UTG", action: "allin", amountBb: 44.58 },
        { actor: "BigDweaner", position: "BB", action: "fold", amountBb: null },
      ],
    },
  },
};

assert.equal(model.resolveImportedHeroName(hand, ""), "dingsanpro");

const flopRows = model.relevantImportedActionsForStreet(hand, "flop", "dingsanpro");
assert.deepEqual(
  flopRows.map(({ action }) => `${action.position}:${action.action}`),
  ["BB:check", "UTG:bet", "BB:raise", "UTG:raise", "BB:call"],
);

assert.equal(model.pointKind(hand, "flop", flopRows[1].action, "dingsanpro").label, "Review Hero Action");
assert.match(
  model.pointKind(hand, "flop", flopRows[1].action, "dingsanpro").className,
  /hero-action-cell/,
  "reviewed hero actions should receive the shared hero cell treatment",
);
assert.equal(model.pointKind(hand, "flop", flopRows[3].action, "dingsanpro").label, "Review Hero Action");
assert.equal(model.pointKind(hand, "flop", flopRows[2].action, "dingsanpro").label, "Villain Key Action");
assert.doesNotMatch(
  model.pointKind(hand, "flop", flopRows[2].action, "dingsanpro").className,
  /hero-action-cell/,
  "villain actions should remain visually neutral",
);

const turnRows = model.relevantImportedActionsForStreet(hand, "turn", "dingsanpro");
assert.equal(model.pointKind(hand, "turn", turnRows[1].action, "dingsanpro").label, "Review Hero Action");

const threeBetPot = {
  players: [
    { name: "Opener", position: "MP", isHero: false },
    { name: "Hero", position: "SB", isHero: true },
  ],
  streets: {
    preflop: {
      actions: [
        { actor: "Opener", position: "MP", action: "raise", amountBb: 2.2 },
        { actor: "Hero", position: "SB", action: "raise", amountBb: 6.97 },
        { actor: "Opener", position: "MP", action: "call", amountBb: 4.77 },
      ],
    },
    flop: {
      actions: [
        { actor: "Hero", position: "SB", action: "bet", amountBb: 5.25 },
        { actor: "Opener", position: "MP", action: "call", amountBb: 5.25 },
      ],
    },
  },
};

assert.deepEqual(
  JSON.parse(JSON.stringify(model.importedStreetRowsForAnalysis(threeBetPot, "preflop", "flop", 0, "Hero"))),
  [
    { actor: "MP", action: "open", amount: 2.2 },
    { actor: "SB", action: "raise", amount: 6.97 },
    { actor: "MP", action: "call", amount: 4.77 },
  ],
  "Imported preflop context must preserve the original opener before hero's 3-bet.",
);

const multiwayHand = {
  heroName: "dingsanpro",
  players: [
    { name: "dofamin", position: "SB", isHero: false },
    { name: "GordonCole", position: "BB", isHero: false },
    { name: "dingsanpro", position: "UTG+1", isHero: true },
  ],
  streets: {
    river: {
      actions: [
        { actor: "dofamin", position: "SB", action: "check", amountBb: null },
        { actor: "GordonCole", position: "BB", action: "bet", amountBb: 7.35 },
        { actor: "dingsanpro", position: "UTG+1", action: "fold", amountBb: null },
        { actor: "dofamin", position: "SB", action: "fold", amountBb: null },
      ],
    },
  },
};

assert.equal(model.normalizeAnalyzerPosition("UTG+1"), "MP");
assert.equal(model.normalizeAnalyzerPosition("HJ"), "MP");

const multiwayContext = model.buildImportedDecisionContext(multiwayHand, "river", 1, "dingsanpro");
assert.deepEqual(JSON.parse(JSON.stringify(multiwayContext)), {
  heroName: "dingsanpro",
  heroPosition: "MP",
  displayHeroPosition: "UTG+1",
  targetActor: "GordonCole",
  targetPosition: "BB",
  targetAction: "bet",
  targetAmount: 7.35,
  targetIsHero: false,
  recordedHeroAction: null,
  recordedHeroAmount: "",
  actionsThroughTarget: [
    { actorName: "dofamin", actor: "SB", action: "check", amount: "" },
    { actorName: "GordonCole", actor: "BB", action: "bet", amount: 7.35 },
  ],
  heroHasResponded: false,
  activeOpponents: [
    { name: "dofamin", position: "SB", displayPosition: "SB" },
    { name: "GordonCole", position: "BB", displayPosition: "BB" },
  ],
  primaryVillainName: "GordonCole",
  primaryVillainPosition: "BB",
});

const multiwayNode = model.decisionNodeForImportedContext(multiwayContext, "River");
assert.deepEqual(JSON.parse(JSON.stringify(multiwayNode)), {
  street: "River",
  title: "River Node: Hero facing BB bet",
  description: "BB bet 7.35bb and Hero has the next unresolved decision.",
  facingBet: true,
  facingAllIn: false,
  importedTargetIsHero: false,
});
assert.deepEqual(
  JSON.parse(JSON.stringify(model.validateImportedDecisionNode(multiwayContext, {
    ...multiwayNode,
    legalActions: ["Fold", "Call", "Raise"],
  }))),
  { valid: true, errors: [] },
);
assert.equal(
  model.validateImportedDecisionNode(multiwayContext, {
    ...multiwayNode,
    facingBet: false,
    legalActions: ["Review"],
  }).valid,
  false,
);

const heroBetContext = model.buildImportedDecisionContext(hand, "flop", 1, "dingsanpro");
const heroBetNode = model.decisionNodeForImportedContext(heroBetContext, "Flop");
assert.equal(heroBetNode.importedTargetIsHero, true);
assert.equal(heroBetNode.terminal, false);
assert.equal(heroBetContext.recordedHeroAction, "bet");
assert.deepEqual(heroBetContext.actionsThroughTarget.map((row) => row.action), ["check"]);

const villainCheckContext = model.buildImportedDecisionContext(hand, "flop", 0, "dingsanpro");
const villainCheckNode = model.decisionNodeForImportedContext(villainCheckContext, "Flop");
assert.equal(villainCheckNode.title, "Flop Node: Hero after BB check");
assert.equal(villainCheckNode.facingBet, false);

console.log("import decision model regression checks passed");
