const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/handSessionModel.js"), "utf8"), sandbox);
const model = sandbox.globalThis.PokerCoachHandSessionModel;

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function testSessionsNeverShareMutableState() {
  const manual = model.replaceHand(model.createSession("manual"), { id: "M-1" }, { label: "manual" });
  const imported = model.replaceHand(model.createSession("screenshot"), { id: "I-1" }, { label: "import" });

  assert.equal(manual.source, "manual");
  assert.equal(imported.source, "screenshot");
  assert.notEqual(manual.handState, imported.handState);
  assert.deepEqual(plain(manual.handState), { id: "M-1" });
  assert.deepEqual(plain(imported.handState), { id: "I-1" });
}

function testReplacingOneHandChangesOnlyThatRevision() {
  const manual = model.createSession("manual");
  const imported = model.replaceHand(model.createSession("screenshot"), { id: "I-1" }, {});
  const revised = model.replaceHand(imported, { id: "I-2" }, {});

  assert.equal(manual.revision, 0);
  assert.equal(imported.revision, 1);
  assert.equal(revised.revision, 2);
  assert.deepEqual(plain(imported.handState), { id: "I-1" });
}

function testDecisionIdentityScopesCacheAndResults() {
  let session = model.replaceHand(model.createSession("screenshot"), { id: "I-1" }, {});
  session = model.selectDecision(session, { key: "flop:1", street: "flop" });
  assert.equal(model.analysisCacheKey(session), "screenshot:1:flop:1");

  const started = model.beginRequest(session, "analysis");
  const accepted = model.acceptResult(started.session, started.token, { recommendation: "Call" });
  assert.equal(accepted.accepted, true);
  assert.deepEqual(plain(accepted.session.analysisState.byDecision["flop:1"]), { recommendation: "Call" });
}

function testStaleTokensCannotOverwriteRevisedOrReselectedSession() {
  let session = model.replaceHand(model.createSession("screenshot"), { id: "I-1" }, {});
  session = model.selectDecision(session, { key: "turn:0", street: "turn" });
  const started = model.beginRequest(session, "analysis");
  const revised = model.replaceHand(started.session, { id: "I-2" }, {});
  assert.equal(model.acceptResult(revised, started.token, { recommendation: "Fold" }).accepted, false);

  const freshStarted = model.beginRequest(model.selectDecision(revised, { key: "river:0" }), "analysis");
  const reselected = model.selectDecision(freshStarted.session, { key: "river:1" });
  assert.equal(model.acceptResult(reselected, freshStarted.token, { recommendation: "Raise" }).accepted, false);
}

testSessionsNeverShareMutableState();
testReplacingOneHandChangesOnlyThatRevision();
testDecisionIdentityScopesCacheAndResults();
testStaleTokensCannotOverwriteRevisedOrReselectedSession();
