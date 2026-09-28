const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("public/importDecisionModel.js", "utf8"), sandbox);
const model = sandbox.globalThis.PokerCoachImportDecisionModel;
const hand = {
  heroName: "xoixo68",
  actionAttribution: { safe: false, issues: [{ code: "SELF_RESPONSE" }] },
  players: [{ name: "xoixo68", position: "BB", isHero: true }],
  streets: { flop: { actions: [
    { actor: "xoixo68", position: "BB", action: "bet", amountBb: 8.7 },
    { actor: "xoixo68", position: "BB", action: "call", amountBb: 8.7 },
  ] } },
};

assert.deepEqual(Array.from(model.relevantImportedActionsForStreet(hand, "flop", "xoixo68")), []);
assert.throws(() => model.buildImportedDecisionContext(hand, "flop", 0, "xoixo68"), /could not be verified/i);

console.log("unsafe import attribution UI tests passed");
