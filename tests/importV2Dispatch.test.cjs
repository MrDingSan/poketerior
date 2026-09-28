const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/import-engine/dispatch.js"), "utf8"), sandbox, { filename: "dispatch.js" });
const dispatch = sandbox.PokerCoachImportDispatch;
assert.ok(dispatch, "PokerCoachImportDispatch must be attached");
const plain = (value) => JSON.parse(JSON.stringify(value));

const ENABLED = { importEngineV2Enabled: true, importEngineV2Sites: ["Natural8"] };
const SUPPORTED = { supported: true, adapter: { site: "Natural8" }, detection: { site: "Natural8", score: 0.95 } };

function testV2RunsOnlyWhenEnabledAndConfigured() {
  assert.equal(dispatch.chooseRoute({ capabilities: ENABLED, runtime: {}, detection: SUPPORTED }).route, "v2");
  assert.deepEqual(plain(dispatch.chooseRoute({ capabilities: null, runtime: {}, detection: SUPPORTED })), { route: "legacy", reason: "v2-disabled" });
  assert.deepEqual(plain(dispatch.chooseRoute({ capabilities: { importEngineV2Enabled: false, importEngineV2Sites: ["Natural8"] }, runtime: {}, detection: SUPPORTED })), { route: "legacy", reason: "v2-disabled" });
  assert.deepEqual(plain(dispatch.chooseRoute({ capabilities: ENABLED, runtime: null, detection: SUPPORTED })), { route: "legacy", reason: "runtime-unavailable" });
}

function testUnsupportedOrUnconfiguredSitesUseTheUnchangedLegacyImporter() {
  assert.deepEqual(plain(dispatch.chooseRoute({ capabilities: ENABLED, runtime: {}, detection: { supported: false, detection: { score: 0.4 } } })), { route: "legacy", reason: "unsupported-layout" });
  assert.deepEqual(plain(dispatch.chooseRoute({ capabilities: ENABLED, runtime: {}, detection: null })), { route: "legacy", reason: "unsupported-layout" });
  const other = { supported: true, adapter: { site: "CoinPoker" }, detection: { site: "CoinPoker" } };
  assert.deepEqual(plain(dispatch.chooseRoute({ capabilities: ENABLED, runtime: {}, detection: other })), { route: "legacy", reason: "site-not-configured" });
  assert.equal(dispatch.chooseRoute({ capabilities: { importEngineV2Enabled: true, importEngineV2Sites: ["natural8"] }, runtime: {}, detection: SUPPORTED }).route, "v2", "site names compare case-insensitively");
  assert.equal(dispatch.chooseRoute({ capabilities: { importEngineV2Enabled: true, importEngineV2Sites: [] }, runtime: {}, detection: SUPPORTED }).reason, "site-not-configured");
}

function testReplayableRequiresARealReplayedHand() {
  const good = { route: "v2", converted: { preflopState: {} }, hand: { actions: { preflop: [{}], flop: [] } } };
  assert.equal(dispatch.isReplayable(good), true);
  assert.equal(dispatch.isReplayable(null), false);
  assert.equal(dispatch.isReplayable({ ...good, route: "legacy" }), false);
  assert.equal(dispatch.isReplayable({ ...good, converted: null }), false);
  assert.equal(dispatch.isReplayable({ ...good, hand: { actions: { preflop: [] } } }), false, "an import with no recognized actions must not replace a good session");
}

function testProjectionCarriesWarningsAndSafety() {
  const result = {
    valid: false,
    legacy: { heroName: "Hero", streets: {}, validationWarnings: ["stale"] },
    hand: { warnings: [{ code: "pot-mismatch", severity: "warning", field: "streetPots.flop", message: "Pot differs." }, { code: "undersized-call", severity: "error", field: "actions.flop.2.amountBb", message: "Call too small." }] },
    validation: { blockingIssues: [], replayIssues: [{ code: "undersized-call" }] },
  };
  const projected = dispatch.legacyHandFromResult(result);
  assert.deepEqual(plain(projected.validationWarnings), ["Pot differs.", "Call too small."]);
  assert.equal(projected.actionAttribution.safe, false);
  assert.deepEqual(plain(projected.actionAttribution.issues).sort(), ["pot-mismatch", "undersized-call"]);
  assert.equal(projected.heroName, "Hero");
  const clean = dispatch.legacyHandFromResult({ valid: true, legacy: { streets: {} }, hand: { warnings: [] }, validation: {} });
  assert.equal(clean.actionAttribution.safe, true);
}

function testProviderLabelNamesTheEngineAndAdapter() {
  const label = dispatch.providerLabel({ hand: { source: { adapterId: "natural8", adapterVersion: "1" } } });
  assert.deepEqual(plain(label), { provider: "import-engine-v2", model: "natural8@1" });
  assert.equal(dispatch.providerLabel({}).provider, "import-engine-v2");
}

testV2RunsOnlyWhenEnabledAndConfigured();
testUnsupportedOrUnconfiguredSitesUseTheUnchangedLegacyImporter();
testReplayableRequiresARealReplayedHand();
testProjectionCarriesWarningsAndSafety();
testProviderLabelNamesTheEngineAndAdapter();
console.log("import V2 dispatch tests passed");
