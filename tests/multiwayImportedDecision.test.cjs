const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/actionPolicy.js"), "utf8"), sandbox);
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/importDecisionModel.js"), "utf8"), sandbox);

const model = sandbox.PokerCoachImportDecisionModel;
const policy = sandbox.PokerCoachActionPolicy;
const hand = {
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

const context = model.buildImportedDecisionContext(hand, "river", 1, "dingsanpro");
const node = model.decisionNodeForImportedContext(context, "River");
const legalActions = policy.legalActionsForNode(node);

assert.equal(context.heroPosition, "MP");
assert.equal(context.primaryVillainPosition, "BB");
assert.equal(node.title, "River Node: Hero facing BB bet");
assert.equal(node.facingBet, true);
assert.notDeepEqual(Array.from(legalActions), ["Review"]);
assert.deepEqual(
  Array.from(context.actionsThroughTarget, (row) => `${row.actor}:${row.action}`),
  ["SB:check", "BB:bet"],
);

const reportedHand = {
  heroName: "dingsanpro",
  players: [
    { name: "dingsanpro", position: "SB", isHero: true },
    { name: "SeatEmpty", position: "BB", isHero: false },
    { name: "gerakla1", position: "UTG", isHero: false },
    { name: "dofamin", position: "MP", isHero: false },
    { name: "GordonCole", position: "CO", isHero: false },
    { name: "xoixeo68", position: "BTN", isHero: false },
  ],
  streets: {
    preflop: { actions: [
      { actor: "gerakla1", position: "UTG", action: "fold" },
      { actor: "dofamin", position: "MP", action: "fold" },
      { actor: "GordonCole", position: "CO", action: "raise", amountBb: 2.5 },
      { actor: "xoixeo68", position: "BTN", action: "fold" },
      { actor: "dingsanpro", position: "SB", action: "raise", amountBb: 7.72 },
      { actor: "SeatEmpty", position: "BB", action: "fold" },
      { actor: "GordonCole", position: "CO", action: "call", amountBb: 5.22 },
    ] },
    flop: { actions: [
      { actor: "dingsanpro", position: "SB", action: "check" },
      { actor: "GordonCole", position: "CO", action: "check" },
    ] },
  },
};

const heroFirstContext = model.buildImportedDecisionContext(reportedHand, "flop", 0, "dingsanpro");
const heroFirstNode = model.decisionNodeForImportedContext(heroFirstContext, "Flop");
heroFirstNode.legalActions = policy.legalActionsForNode(heroFirstNode);
assert.deepEqual(Array.from(heroFirstContext.actionsThroughTarget), []);
assert.equal(heroFirstContext.recordedHeroAction, "check");
assert.equal(heroFirstNode.terminal, false);
assert.deepEqual(Array.from(heroFirstNode.legalActions), ["Check", "Bet"]);
assert.deepEqual(Array.from(heroFirstContext.activeOpponents, (opponent) => opponent.name), ["GordonCole"]);
assert.equal(heroFirstContext.primaryVillainName, "GordonCole");
assert.equal(heroFirstContext.primaryVillainPosition, "CO");
assert.equal(model.validateImportedDecisionNode(heroFirstContext, heroFirstNode).valid, true);

const opponentCheckContext = model.buildImportedDecisionContext(reportedHand, "flop", 1, "dingsanpro");
assert.equal(opponentCheckContext.primaryVillainName, "GordonCole");
assert.equal(opponentCheckContext.primaryVillainPosition, "CO");

const responseHand = {
  heroName: "Hero",
  players: [
    { name: "Hero", position: "BB", isHero: true },
    { name: "Villain", position: "SB", isHero: false },
  ],
  streets: {
    flop: { actions: [
      { actor: "Villain", position: "SB", action: "bet", amountBb: 5 },
      { actor: "Hero", position: "BB", action: "call", amountBb: 5 },
    ] },
    turn: { actions: [
      { actor: "Villain", position: "SB", action: "allin", amountBb: 20 },
      { actor: "Hero", position: "BB", action: "call", amountBb: 20 },
    ] },
  },
};
const callContext = model.buildImportedDecisionContext(responseHand, "flop", 1, "Hero");
const callNode = model.decisionNodeForImportedContext(callContext, "Flop");
assert.deepEqual(Array.from(callContext.actionsThroughTarget, (row) => row.action), ["bet"]);
assert.equal(callContext.recordedHeroAction, "call");
assert.deepEqual(Array.from(policy.legalActionsForNode(callNode)), ["Fold", "Call", "Raise"]);

const allInCallContext = model.buildImportedDecisionContext(responseHand, "turn", 1, "Hero");
const allInCallNode = model.decisionNodeForImportedContext(allInCallContext, "Turn");
assert.deepEqual(Array.from(allInCallContext.actionsThroughTarget, (row) => row.action), ["allin"]);
assert.equal(allInCallContext.recordedHeroAction, "call");
assert.deepEqual(Array.from(policy.legalActionsForNode(allInCallNode)), ["Fold", "Call"]);

const multiwayHand = {
  heroName: "Hero",
  players: [
    { name: "Hero", position: "SB", isHero: true },
    { name: "FoldedBB", position: "BB", isHero: false },
    { name: "Opener", position: "CO", isHero: false },
    { name: "Caller", position: "BTN", isHero: false },
  ],
  streets: {
    preflop: { actions: [
      { actor: "Opener", position: "CO", action: "raise", amountBb: 2.5 },
      { actor: "Caller", position: "BTN", action: "call", amountBb: 2.5 },
      { actor: "Hero", position: "SB", action: "call", amountBb: 2 },
      { actor: "FoldedBB", position: "BB", action: "fold" },
    ] },
    flop: { actions: [{ actor: "Hero", position: "SB", action: "check" }] },
  },
};
const multiwayContext = model.buildImportedDecisionContext(multiwayHand, "flop", 0, "Hero");
assert.deepEqual(Array.from(multiwayContext.activeOpponents, (opponent) => opponent.name), ["Opener", "Caller"]);
assert.equal(multiwayContext.primaryVillainName, "Opener");
assert.equal(multiwayContext.primaryVillainPosition, "CO");

const missingPositionHand = {
  heroName: "Hero",
  players: [
    { name: "Hero", position: "SB", isHero: true },
    { name: "UnknownVillain", position: null, isHero: false },
  ],
  streets: { flop: { actions: [{ actor: "Hero", position: "SB", action: "check" }] } },
};
const missingPositionContext = model.buildImportedDecisionContext(missingPositionHand, "flop", 0, "Hero");
const missingPositionNode = model.decisionNodeForImportedContext(missingPositionContext, "Flop");
missingPositionNode.legalActions = policy.legalActionsForNode(missingPositionNode);
assert.equal(model.validateImportedDecisionNode(missingPositionContext, missingPositionNode).valid, false);

const appSource = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
assert.match(appSource, /buildImportedDecisionContext\(/);
assert.match(appSource, /analyze\(triggerButton, prepared\.cacheState, prepared\.importedDecisionContext\)/);
assert.match(appSource, /decisionNodeForImportedContext\(/);
assert.match(appSource, /validateImportedDecisionNode\(/);

console.log("multiway imported decision regression passed");
