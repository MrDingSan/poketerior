const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { window: {}, setInterval, clearInterval };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/importProgressModel.js"), "utf8"), sandbox, { filename: "importProgressModel.js" });
const model = sandbox.PokeTeriorImportProgress;
assert.equal(typeof model.createStageProgress, "function", "createStageProgress must be exported");
assert.equal(typeof model.create, "function", "the legacy timer API must remain for the whole-image path");
const plain = (value) => JSON.parse(JSON.stringify(value));

const EXPECTED_STAGES = ["site", "heroCards", "board", "preflop", "flop", "turn", "river", "validation", "reconstruction", "decisions"];

function testAllTenStagesStartPendingInSpecOrder() {
  const progress = model.createStageProgress({});
  const snapshot = progress.snapshot();
  assert.deepEqual(Array.from(model.STAGES), EXPECTED_STAGES);
  assert.deepEqual(Array.from(snapshot.stages, (stage) => stage.id), EXPECTED_STAGES);
  assert.ok(snapshot.stages.every((stage) => stage.status === "pending"));
  assert.ok(snapshot.stages.every((stage) => typeof stage.label === "string" && stage.label.length > 0));
  assert.equal(snapshot.byId.preflop.status, "pending");
  assert.deepEqual(plain(snapshot.byId.river.fieldRefs), []);
}

function testLegalTransitionsAreEmittedInOrder() {
  const changes = [];
  const progress = model.createStageProgress({ onChange: (snapshot, change) => changes.push({ snapshot, change }) });
  progress.start("site");
  progress.complete("site", { message: "Natural8 layout detected." });
  progress.start("flop");
  progress.warn("flop", { message: "Bet amount is uncertain.", fieldRefs: ["actions.flop.1.amountBb"] });
  progress.start("turn");
  progress.fail("turn", { message: "OCR failed." });
  assert.deepEqual(changes.map(({ change }) => `${change.stage}:${change.from}>${change.to}`), [
    "site:pending>running", "site:running>complete", "flop:pending>running", "flop:running>warning", "turn:pending>running", "turn:running>error",
  ]);
  const last = progress.snapshot();
  assert.equal(last.byId.site.message, "Natural8 layout detected.");
  assert.equal(last.byId.flop.status, "warning");
  assert.deepEqual(plain(last.byId.flop.fieldRefs), ["actions.flop.1.amountBb"]);
  assert.equal(last.byId.turn.status, "error");
  assert.equal(last.byId.river.status, "pending", "untouched stages stay pending");
}

function testStagesCanCompleteWithoutAnExplicitStart() {
  const progress = model.createStageProgress({});
  progress.complete("heroCards", { message: "Ah 4d" });
  assert.equal(progress.snapshot().byId.heroCards.status, "complete");
}

function testIllegalAndUnknownTransitionsThrow() {
  const progress = model.createStageProgress({});
  assert.throws(() => progress.start("showdown"), /unknown.*stage/i);
  assert.throws(() => progress.complete("nope"), /unknown.*stage/i);
  progress.start("board");
  progress.complete("board");
  assert.throws(() => progress.start("board"), /illegal|transition/i, "a completed stage cannot restart");
  assert.throws(() => progress.fail("board"), /illegal|transition/i);
  assert.equal(progress.snapshot().byId.board.status, "complete", "a rejected transition leaves state untouched");
}

function testWarningAndErrorStagesCanBeRetried() {
  const progress = model.createStageProgress({});
  progress.start("river");
  progress.warn("river", { message: "low confidence", fieldRefs: ["actions.river.0.amountBb"] });
  progress.start("river", { message: "Retrying river" });
  const retrying = progress.snapshot().byId.river;
  assert.equal(retrying.status, "running");
  assert.deepEqual(plain(retrying.fieldRefs), [], "a retry clears stale field references");
  progress.complete("river", { message: "River recognized" });
  assert.equal(progress.snapshot().byId.river.status, "complete");
}

function testSnapshotsAreImmutableAndIndependentOfLaterChanges() {
  const emitted = [];
  const progress = model.createStageProgress({ onChange: (snapshot) => emitted.push(snapshot) });
  const first = progress.snapshot();
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.stages), true);
  assert.equal(Object.isFrozen(first.stages[0]), true);
  assert.equal(Object.isFrozen(first.byId.site.fieldRefs), true);
  assert.throws(() => { "use strict"; first.stages[0].status = "complete"; }, TypeError);

  const fieldRefs = ["hero.cards"];
  progress.warn("heroCards", { message: "unclear", fieldRefs });
  fieldRefs.push("mutated.later");
  assert.deepEqual(plain(progress.snapshot().byId.heroCards.fieldRefs), ["hero.cards"], "detail is cloned on the way in");
  assert.equal(first.byId.heroCards.status, "pending", "an earlier snapshot never changes");
  assert.equal(emitted.length, 1);
  assert.notEqual(emitted[0], progress.snapshot(), "every read is a fresh snapshot");
}

function testMessagesDefaultFromTheStageLabel() {
  const progress = model.createStageProgress({});
  progress.start("validation");
  assert.match(progress.snapshot().byId.validation.message, /validat/i);
  progress.complete("validation");
  assert.match(progress.snapshot().byId.validation.message, /validat/i);
}

function testLegacyTimerStillWorks() {
  const updates = [];
  const legacy = model.create({ setStatus: (message) => updates.push(message), intervalMs: 5 });
  legacy.start();
  return new Promise((resolve) => setTimeout(() => {
    legacy.stop();
    assert.ok(updates.length > 0);
    resolve();
  }, 20));
}

testAllTenStagesStartPendingInSpecOrder();
testLegalTransitionsAreEmittedInOrder();
testStagesCanCompleteWithoutAnExplicitStart();
testIllegalAndUnknownTransitionsThrow();
testWarningAndErrorStagesCanBeRetried();
testSnapshotsAreImmutableAndIndependentOfLaterChanges();
testMessagesDefaultFromTheStageLabel();
testLegacyTimerStillWorks().then(() => console.log("import stage progress tests passed"));
