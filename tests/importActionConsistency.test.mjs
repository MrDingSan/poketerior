import assert from "node:assert/strict";
import { stripNonDecisionActions, validateImportedActionConsistency } from "../src/analysis/importActionConsistency.js";

const corrupted = {
  heroName: "xoixo68",
  players: [{ name: "dingsanpro", position: "SB" }, { name: "xoixo68", position: "BTN" }],
  streets: {
    flop: { actions: [
      { actor: "xoixo68", position: "BB", action: "bet", amountBb: 8.7 },
      { actor: "xoixo68", position: "BB", action: "call", amountBb: 8.7 },
    ] },
    turn: { actions: [{ actor: "xoixo68", position: "BB", action: "check" }] },
    river: { actions: [
      { actor: "xoixo68", position: "BB", action: "allin", amountBb: 86.56 },
      { actor: "xoixo68", position: "BB", action: "return", amountBb: 86.56 },
    ] },
  },
};

const stripped = stripNonDecisionActions(corrupted);
assert.deepEqual(stripped.streets.river.actions.map((action) => action.action), ["allin"]);
assert.equal(corrupted.streets.river.actions.length, 2, "input must not be mutated");
const invalid = validateImportedActionConsistency(stripped);
assert.equal(invalid.safe, false);
assert.ok(invalid.issues.some((issue) => issue.code === "SELF_RESPONSE"));
assert.ok(invalid.issues.some((issue) => issue.code === "COLLAPSED_POSTFLOP_ACTORS"));
assert.ok(invalid.issues.some((issue) => issue.code === "ACTOR_POSITION_CONFLICT"));

const valid = validateImportedActionConsistency({
  heroName: "dingsanpro",
  players: [{ name: "dingsanpro", position: "SB" }, { name: "xoixo68", position: "BTN" }],
  streets: {
    flop: { actions: [
      { actor: "dingsanpro", position: "SB", action: "bet", amountBb: 8.7 },
      { actor: "xoixo68", position: "BTN", action: "call", amountBb: 8.7 },
    ] },
    turn: { actions: [
      { actor: "dingsanpro", position: "SB", action: "check" },
      { actor: "xoixo68", position: "BTN", action: "check" },
    ] },
    river: { actions: [
      { actor: "dingsanpro", position: "SB", action: "bet", amountBb: 73 },
      { actor: "xoixo68", position: "BTN", action: "allin", amountBb: 166 },
      { actor: "dingsanpro", position: "SB", action: "allin", amountBb: 79.84 },
    ] },
  },
});
assert.deepEqual(valid, { safe: true, issues: [] });

const sameActorAcrossStreets = validateImportedActionConsistency({
  players: [{ name: "hero", position: "SB" }, { name: "villain", position: "BB" }],
  streets: {
    turn: { actions: [{ actor: "hero", position: "SB", action: "check" }] },
    river: { actions: [{ actor: "hero", position: "SB", action: "bet", amountBb: 5 }] },
  },
});
assert.equal(sameActorAcrossStreets.safe, true);

console.log("import action consistency tests passed");

{
  const missingHeroPreflop = {
    heroName: "dingsan",
    players: [{ name: "dingsan", position: null }, { name: "C_Red", position: "MP" }],
    streets: {
      preflop: { actions: [{ actor: "C_Red", position: "MP", action: "raise", amountBb: 8.6 }] },
      flop: { actions: [{ actor: "C_Red", position: "MP", action: "bet", amountBb: 14.1 }, { actor: "dingsan", position: null, action: "call", amountBb: 14.1 }] },
    },
  };
  const result = validateImportedActionConsistency(missingHeroPreflop);
  if (result.safe || !result.issues.some((issue) => issue.code === "HERO_PREFLOP_ACTION_MISSING")) {
    throw new Error("A hero who acts postflop without any preflop action must be flagged.");
  }
}

{
  const outOfOrder = validateImportedActionConsistency({
    heroName: "dingsan",
    players: [{ name: "dingsan", position: null }, { name: "C_Red", position: "MP" }, { name: "Nnight_", position: "SB" }],
    streets: { preflop: { actions: [
      { actor: "Nnight_", position: "SB", action: "raise", amountBb: 3 },
      { actor: "C_Red", position: "MP", action: "raise", amountBb: 8.6 },
    ] } },
  });
  assert.ok(outOfOrder.issues.some((issue) => issue.code === "PREFLOP_ORDER_VIOLATION"));
}

{
  const foldedActs = validateImportedActionConsistency({
    heroName: "dingsan",
    players: [{ name: "CheNeSacc", position: "CO" }, { name: "dingsan", position: null }],
    streets: {
      preflop: { actions: [
        { actor: "Nnight_", position: "SB", action: "blind", amountBb: 0.5 },
        { actor: "dingsan", position: null, action: "raise", amountBb: 3 },
        { actor: "CheNeSacc", position: "CO", action: "fold" },
      ] },
      flop: { actions: [{ actor: "CheNeSacc", position: "CO", action: "call", amountBb: 14.1 }] },
    },
  });
  assert.ok(foldedActs.issues.some((issue) => issue.code === "FOLDED_PLAYER_ACTS"));
  assert.ok(!foldedActs.issues.some((issue) => issue.code === "PREFLOP_ORDER_VIOLATION"), "blind rows must not trip the order check");
}
