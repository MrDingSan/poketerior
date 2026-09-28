const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const file of ["types.js", "adapters/registry.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/import-engine", file), "utf8"), sandbox, { filename: file });
}
const adapters = sandbox.PokerCoachImportAdapters;
assert.ok(adapters, "PokerCoachImportAdapters must be attached");
const context = { width: 1280, height: 2022, anchors: {} };

function testSelectsBestScoreAtOrAboveThreshold() {
  const registry = adapters.createRegistry([
    { id: "weak", detect: () => ({ score: 0.79, evidence: [] }) },
    { id: "natural8", detect: () => ({ score: 0.91, evidence: ["street-columns"] }) },
  ]);
  const result = registry.detect(context);
  assert.equal(result.supported, true);
  assert.equal(result.adapter.id, "natural8");
  assert.equal(result.detection.score, 0.91);
  assert.equal(result.attempts.length, 2);
  assert.deepEqual(Array.from(result.attempts, (attempt) => attempt.id), ["weak", "natural8"]);
}

function testThresholdIsInclusiveAndBelowIsUnsupported() {
  const exact = adapters.createRegistry([{ id: "a", detect: () => ({ score: 0.8, evidence: [] }) }]).detect(context);
  assert.equal(exact.supported, true);
  const below = adapters.createRegistry([{ id: "a", detect: () => ({ score: 0.7999, evidence: [] }) }]).detect(context);
  assert.equal(below.supported, false);
  assert.equal(below.adapter, null);
  assert.equal(below.detection.score, 0.7999, "best rejected detection stays visible for diagnostics");
  assert.equal(adapters.SUPPORTED_SCORE_THRESHOLD, 0.8);
}

function testEmptyRegistryAndAdapterFailuresAreContained() {
  const empty = adapters.createRegistry([]).detect(context);
  assert.equal(empty.supported, false);
  assert.equal(empty.adapter, null);
  assert.equal(empty.detection, null);

  const registry = adapters.createRegistry([
    { id: "broken", detect: () => { throw new Error("boom"); } },
    { id: "good", detect: () => ({ score: 0.85, evidence: ["ok"] }) },
  ]);
  const result = registry.detect(context);
  assert.equal(result.supported, true);
  assert.equal(result.adapter.id, "good");
  const broken = result.attempts.find((attempt) => attempt.id === "broken");
  assert.equal(broken.score, 0);
  assert.match(broken.error, /boom/);
}

function testTiesKeepRegistrationOrderAndScoresAreClamped() {
  const registry = adapters.createRegistry([
    { id: "first", detect: () => ({ score: 0.9, evidence: [] }) },
    { id: "second", detect: () => ({ score: 0.9, evidence: [] }) },
    { id: "wild", detect: () => ({ score: 7, evidence: [] }) },
  ]);
  const result = registry.detect(context);
  assert.equal(result.adapter.id, "wild");
  assert.equal(result.detection.score, 1);
  const tie = adapters.createRegistry(registry.adapters.slice(0, 2)).detect(context);
  assert.equal(tie.adapter.id, "first");
  assert.throws(() => adapters.createRegistry([{ id: "x" }]), /detect/);
}

testSelectsBestScoreAtOrAboveThreshold();
testThresholdIsInclusiveAndBelowIsUnsupported();
testEmptyRegistryAndAdapterFailuresAreContained();
testTiesKeepRegistrationOrderAndScoresAreClamped();
console.log("import adapter registry tests passed");
