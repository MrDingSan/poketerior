import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { applyFocusedHeroHandVerification } from "../src/analysis/importRepair.js";

const broad = {
  site: "CoinPoker",
  heroName: "MauroG27129",
  heroHand: ["Js", "Ks"],
  board: { flop: ["Jc", "5c", "9c"], turn: "Qh", river: "2s" },
  players: [
    { name: "MauroG27129", position: "SB", isHero: true },
    { name: "dingsanpro", position: "BB", isHero: false },
  ],
  confidenceNotes: [],
};
const focused = {
  seat: "bottom-center",
  playerName: "dingsanpro",
  heroHand: ["2d", "Kh"],
  confidence: "high",
  evidence: "Bottom-left red diamond 2; bottom-right red heart K.",
};

const repaired = applyFocusedHeroHandVerification(broad, focused);
assert.equal(repaired.heroName, "dingsanpro");
assert.equal(repaired.heroHandOwner, "dingsanpro");
assert.deepEqual(repaired.heroHand, ["2d", "Kh"]);
assert.equal(repaired.heroHand.includes("Jd"), false);
assert.equal(repaired.heroHand.includes("Kd"), false);

const dirname = path.dirname(fileURLToPath(import.meta.url));
const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(dirname, "../public/importHeroCardModel.js"), "utf8"),
  sandbox,
);
const model = sandbox.globalThis.PokerCoachImportHeroCards;
model.initializeCardOwnership(repaired);
assert.deepEqual(Array.from(model.cardsForSelectedHero(repaired, "dingsanpro")), ["2d", "Kh"]);
assert.deepEqual(Array.from(model.cardsForSelectedHero(repaired, "MauroG27129")), []);

console.log("CoinPoker hero attribution regression passed");
