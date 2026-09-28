import assert from "node:assert/strict";
import { applyFocusedActionRepair } from "../src/analysis/importRepair.js";

const broad = {
  site: "Unknown",
  heroName: "xoixo68",
  heroHand: ["Ad", "Tc"],
  players: [{ name: "xoixo68", position: "BB", isHero: true }],
  streets: { flop: { actions: [
    { actor: "xoixo68", position: "BB", action: "bet", amountBb: 8.7 },
    { actor: "xoixo68", position: "BB", action: "call", amountBb: 8.7 },
  ] } },
};
const repair = {
  heroName: "dingsanpro",
  heroHand: ["Ts", "Ah"],
  players: [
    { name: "dingsanpro", position: "SB", isHero: true },
    { name: "xoixo68", position: "BTN", isHero: false },
  ],
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
      { actor: "xoixo68", position: "BTN", action: "return", amountBb: 86.56 },
    ] },
  },
};

const accepted = applyFocusedActionRepair(broad, repair);
assert.equal(accepted.accepted, true);
assert.equal(accepted.hand.heroName, "dingsanpro");
assert.deepEqual(accepted.hand.heroHand, ["Ts", "Ah"]);
assert.equal(accepted.hand.players.length, 2);
assert.deepEqual(accepted.hand.streets.river.actions.map((action) => action.action), ["bet", "allin", "allin"]);
assert.equal(accepted.issues.length, 0);

const rejected = applyFocusedActionRepair(broad, broad);
assert.equal(rejected.accepted, false);
assert.equal(rejected.hand, broad);
assert.ok(rejected.issues.some((issue) => issue.code === "SELF_RESPONSE"));

console.log("import action repair tests passed");
