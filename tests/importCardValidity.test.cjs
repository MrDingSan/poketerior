const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/importCardValidity.js"), "utf8"), sandbox);
const { validateImportedCards } = sandbox.globalThis.PokerCoachImportCardValidity;

{
  const result = validateImportedCards({
    heroHand: ["Ad", "Kd"],
    board: { flop: ["Ad", "6s", "5d"], turn: null, river: null },
  });
  assert.equal(result.valid, false);
  assert.match(result.warnings.join(" "), /both hero hand and community board/i);
}

{
  const result = validateImportedCards({
    heroHand: ["Ad", "Kd"],
    board: { flop: ["Ah", "2c", "6c"], turn: "3s", river: "3s" },
  });
  assert.equal(result.valid, false);
  assert.match(result.warnings.join(" "), /duplicate community card 3s/i);
}

{
  const result = validateImportedCards({
    heroHand: ["7d", "Ad"],
    board: { flop: ["Ah", "2c", "6c"], turn: "3s", river: "Jh" },
  });
  assert.equal(result.valid, true);
  assert.deepEqual(Array.from(result.warnings), []);
}

console.log("importCardValidity tests passed");
