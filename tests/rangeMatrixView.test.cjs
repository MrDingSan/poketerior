const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("public/rangeMatrixView.js", "utf8"), sandbox);
const rangeView = sandbox.globalThis.PokerCoachRangeMatrixView;

const normalized = rangeView.normalizeRangeData({ weights: { AA: 1, AKs: 0.6, AKo: -1, QJs: 2 } });
assert.equal(normalized.weights.AA, 1);
assert.equal(normalized.weights.AKs, 0.6);
assert.equal(normalized.weights.AKo, 0);
assert.equal(normalized.weights.QJs, 1);
assert.equal(normalized.cells.length, 169);
assert.equal(normalized.available, true);
assert.equal(rangeView.normalizeRangeData(null).available, false);
assert.equal(normalized.cells[0].label, "AA");
assert.equal(normalized.cells[1].label, "AKs");
assert.equal(normalized.cells[13].label, "AKo");
