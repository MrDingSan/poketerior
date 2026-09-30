import assert from "node:assert/strict";
import {
  applyFocusedHeroHandVerification,
  repairImportedHeroHandFromNotes,
} from "../src/analysis/importRepair.js";

const repaired = repairImportedHeroHandFromNotes({
  heroHand: ["Ad", "6d"],
  confidenceNotes: ["Hero (MrD3) has Ah6h, making two pair."],
});

assert.deepEqual(repaired.heroHand, ["Ah", "6h"]);
assert.match(repaired.confidenceNotes.at(-1), /repaired/i);

const unchanged = repairImportedHeroHandFromNotes({
  heroHand: ["Ad", "6d"],
  confidenceNotes: ["Villain has Ah6h."],
});

assert.deepEqual(unchanged.heroHand, ["Ad", "6d"]);

const focusedRepair = applyFocusedHeroHandVerification(
  {
    site: "CoinPoker",
    heroName: "Hero",
    heroHand: ["Jc", "7c"],
    players: [{ name: "Hero", position: "BB", isHero: true }],
    confidenceNotes: [],
  },
  {
    seat: "bottom-center",
    playerName: "Hero",
    heroHand: ["Jd", "7d"],
    confidence: "high",
    evidence: "Both bottom card pips are red diamonds.",
  },
);
assert.deepEqual(focusedRepair.heroHand, ["Jd", "7d"]);
assert.match(focusedRepair.confidenceNotes.at(-1), /focused bottom-seat card verification/i);
assert.equal(focusedRepair.focusedHeroDecision.accepted, true);

const correctedWrongPlayerAttribution = applyFocusedHeroHandVerification(
  {
    site: "CoinPoker",
    heroName: "MauroG27129",
    heroHand: ["Js", "Ks"],
    players: [
      { name: "MauroG27129", position: "SB", isHero: true },
      { name: "dingsanpro", position: "BB", isHero: false },
    ],
    confidenceNotes: [],
  },
  {
    seat: "bottom-center",
    playerName: " dingsanpro ",
    heroHand: ["2d", "Kh"],
    confidence: "high",
    evidence: "Red diamond 2 and red heart K at bottom-center.",
  },
);
assert.equal(correctedWrongPlayerAttribution.heroName, "dingsanpro");
assert.equal(correctedWrongPlayerAttribution.heroHandOwner, "dingsanpro");
assert.deepEqual(correctedWrongPlayerAttribution.heroHand, ["2d", "Kh"]);
assert.equal(
  correctedWrongPlayerAttribution.players.find((player) => player.name === "dingsanpro").isHero,
  true,
);
assert.equal(
  correctedWrongPlayerAttribution.players.find((player) => player.name === "MauroG27129").isHero,
  false,
);
assert.equal(correctedWrongPlayerAttribution.focusedHeroDecision.accepted, true);

const baseHand = {
  site: "CoinPoker",
  heroName: "MauroG27129",
  heroHand: ["Js", "Ks"],
  players: [
    { name: "MauroG27129", position: "SB", isHero: true },
    { name: "dingsanpro", position: "BB", isHero: false },
  ],
  confidenceNotes: [],
};

for (const focused of [
  {
    seat: "right",
    playerName: "dingsanpro",
    heroHand: ["2d", "Kh"],
    confidence: "high",
  },
  {
    seat: "bottom-center",
    playerName: "different",
    heroHand: ["2d", "Kh"],
    confidence: "high",
  },
  {
    seat: "bottom-center",
    playerName: "dingsanpro",
    heroHand: ["2d", "Kh"],
    confidence: "low",
  },
  {
    seat: "bottom-center",
    playerName: "dingsanpro",
    heroHand: ["2d", "2d"],
    confidence: "high",
  },
]) {
  const result = applyFocusedHeroHandVerification(baseHand, focused);
  assert.deepEqual(result.heroHand, baseHand.heroHand);
  assert.equal(result.focusedHeroDecision.accepted, false);
}

console.log("import repair regression checks passed");

{
  const { attributeYellowBubblesToHero } = await import("../src/analysis/importRepair.js");
  const fixed = attributeYellowBubblesToHero({
    heroName: "dingsan",
    players: [{ name: "dingsan", position: "UTG", isHero: true }, { name: "C_Red", position: "MP" }],
    streets: { preflop: { actions: [
      { actor: "C_Red", position: "MP", action: "raise", amountBb: 3, bubble: "yellow" },
      { actor: "C_Red", position: "MP", action: "raise", amountBb: 8.6, bubble: "white" },
    ] } },
  });
  assert.deepEqual(fixed.streets.preflop.actions.map((action) => [action.actor, action.position]), [["dingsan", "UTG"], ["C_Red", "MP"]]);
}



// Hand-History-1790497998567: the focused crop read the hole cards correctly as "J♥", "J♣" (symbols, not
// letters) and the read was thrown away as invalid, leaving the broad read's Jc Js.
{
  const symbolRead = applyFocusedHeroHandVerification(
    { heroName: "hero", heroHand: ["Jc", "Js"], players: [{ name: "hero", position: "BB", isHero: true }] },
    { seat: "bottom-center", playerName: "hero", heroHand: ["J♥", "J♣"], confidence: "high" },
  );
  assert.deepEqual(symbolRead.heroHand, ["Jh", "Jc"]);
  assert.equal(symbolRead.focusedHeroDecision.accepted, true);
  console.log("suit-symbol hero read checks passed");
}
