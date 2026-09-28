const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/actionRowPresentation.js"), "utf8");
const sandbox = { window: {}, globalThis: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: "actionRowPresentation.js" });

const presentation = sandbox.PokerCoachActionRowPresentation;
assert.ok(presentation, "action-row presentation model should attach to global scope");
assert.equal(presentation.isHeroActor("SB", "SB"), true);
assert.equal(presentation.isHeroActor("UTG", "SB"), false);
assert.equal(presentation.isHeroActor("", "SB"), false);
assert.equal(presentation.isHeroActor("SB", ""), false);

console.log("action row presentation regression checks passed");
