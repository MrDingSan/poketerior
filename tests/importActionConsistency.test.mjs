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

// Hand-History-1790439008402: Hero's check came back both as an unnamed yellow bubble and as a named row.
// Attribution must not turn that into Hero checking twice, and a real repeat must be flagged.
{
  const { attributeYellowBubblesToHero } = await import("../src/analysis/importRepair.js");
  const players = [{ name: "hero", position: "BB", isHero: true }, { name: "villain", position: "CO" }];
  const repaired = attributeYellowBubblesToHero({
    heroName: "hero",
    players,
    streets: {
      flop: {
        actions: [
          { actor: null, position: null, bubble: "yellow", action: "check" },
          { actor: "hero", position: "BB", action: "check" },
          { actor: "villain", position: "CO", action: "bet", amountBb: 2.46 },
          { actor: "hero", position: "BB", action: "call", amountBb: 2.46 },
        ],
      },
    },
  });
  assert.deepEqual(repaired.streets.flop.actions.map((action) => `${action.actor}:${action.action}`), ["hero:check", "villain:bet", "hero:call"]);
  const repeated = validateImportedActionConsistency({
    players,
    streets: { flop: { actions: [{ actor: "hero", action: "check" }, { actor: "hero", action: "bet", amountBb: 2 }] } },
  });
  assert.equal(repeated.safe, false);
  assert.ok(repeated.issues.some((issue) => issue.code === "REPEATED_ACTOR"));
  console.log("repeated-action import checks passed");
}

// Hand-History-1790438742868: the model invented a yellow "Check" at the top of every postflop street
// for Hero (UTG), which would put Hero ahead of the BB. The bubble is dropped; a real out-of-turn row
// is flagged so the focused action repair runs.
{
  const { attributeYellowBubblesToHero } = await import("../src/analysis/importRepair.js");
  const players = [{ name: "hero", position: "UTG", isHero: true }, { name: "bb", position: "BB" }];
  const cleaned = attributeYellowBubblesToHero({
    heroName: "hero",
    players,
    streets: {
      flop: {
        actions: [
          { actor: null, bubble: "yellow", action: "check" },
          { actor: "bb", position: "BB", action: "check" },
          { actor: "hero", position: "UTG", action: "bet", amountBb: 2.64 },
          { actor: "bb", position: "BB", action: "call", amountBb: 2.64 },
        ],
      },
    },
  });
  assert.deepEqual(cleaned.streets.flop.actions.map((action) => `${action.actor}:${action.action}`), ["bb:check", "hero:bet", "bb:call"]);
  // When Hero really is first to act (BB against the CO), the leading bubble is Hero's check and stays.
  const firstToAct = attributeYellowBubblesToHero({
    heroName: "hero",
    players: [{ name: "hero", position: "BB", isHero: true }, { name: "co", position: "CO" }],
    streets: { flop: { actions: [{ actor: null, bubble: "yellow", action: "check" }, { actor: "co", position: "CO", action: "bet", amountBb: 2 }] } },
  });
  assert.deepEqual(firstToAct.streets.flop.actions.map((action) => `${action.actor}:${action.action}`), ["hero:check", "co:bet"]);
  const outOfTurn = validateImportedActionConsistency({
    players,
    streets: { flop: { actions: [{ actor: "hero", position: "UTG", action: "check" }, { actor: "bb", position: "BB", action: "check" }] } },
  });
  assert.equal(outOfTurn.safe, false);
  assert.ok(outOfTurn.issues.some((issue) => issue.code === "POSTFLOP_ORDER_VIOLATION"));
  console.log("postflop order import checks passed");
}

// Hand-History-1790498421556 (limped pot): the model returned UTG's 1 BB limp as "raise 1" and the BB's
// closing check as a yellow Hero bubble (Hero is the BTN). Both must be repaired or the replay rejects
// the hand and no decision can load.
{
  const { attributeYellowBubblesToHero } = await import("../src/analysis/importRepair.js");
  const { normalizeNonRaises } = await import("../src/analysis/importActionConsistency.js");
  const players = [
    { name: "sb", position: "SB" }, { name: "bb", position: "BB" }, { name: "utg", position: "UTG" },
    { name: "co", position: "CO" }, { name: "hero", position: "BTN", isHero: true },
  ];
  const repaired = normalizeNonRaises(attributeYellowBubblesToHero({
    heroName: "hero",
    players,
    streets: {
      preflop: {
        actions: [
          { actor: "sb", position: "SB", action: "blind", amountBb: 0.5 },
          { actor: "bb", position: "BB", action: "blind", amountBb: 1 },
          { actor: "utg", position: "UTG", action: "raise", amountBb: 1 },
          { actor: "co", position: "CO", action: "call", amountBb: 1 },
          { actor: "hero", position: "BTN", action: "call", amountBb: 1 },
          { actor: "sb", position: "SB", action: "fold" },
          { actor: null, position: null, bubble: "yellow", action: "check" },
        ],
      },
      flop: { actions: [{ actor: "bb", position: "BB", action: "check" }, { actor: "utg", position: "UTG", action: "raise", amountBb: 3.6 }] },
    },
  }));
  assert.deepEqual(
    repaired.streets.preflop.actions.map((action) => `${action.position}:${action.action}`),
    ["SB:blind", "BB:blind", "UTG:call", "CO:call", "BTN:call", "SB:fold", "BB:check"],
  );
  assert.equal(repaired.streets.flop.actions[1].action, "raise", "a real raise over no bet is left alone");
  console.log("limped-pot import repair checks passed");
}
