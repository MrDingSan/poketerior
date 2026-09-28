const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/importHeroCardModel.js"), "utf8"), sandbox);
const model = sandbox.globalThis.PokerCoachImportHeroCards;

const hand = model.initializeCardOwnership({
  heroName: "dingsanpro",
  heroHandOwner: "dingsanpro",
  heroHand: ["2d", "Kh"],
});
assert.deepEqual(Array.from(model.cardsForSelectedHero(hand, "dingsanpro")), ["2d", "Kh"]);
assert.deepEqual(Array.from(model.cardsForSelectedHero(hand, "MauroG27129")), []);

model.setCardsForSelectedHero(hand, " MauroG27129 ", ["Js", "Ks"]);
assert.deepEqual(Array.from(model.cardsForSelectedHero(hand, "maurog27129")), ["Js", "Ks"]);
assert.deepEqual(Array.from(model.cardsForSelectedHero(hand, "DINGSANPRO")), ["2d", "Kh"]);

const appSource = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
assert.doesNotMatch(appSource, /repairImportedCoinPokerHeroBlackDuplicateDiamonds/);
assert.doesNotMatch(appSource, /repairImportedCoinPokerHeroRedSuits/);

console.log("import hero card ownership tests passed");
