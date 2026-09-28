const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appSource = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");

// ---- static wiring: the unchanged legacy importer, script order, markup ------------------------------------
function functionSource(source, name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `app.js must define ${name}`);
  const open = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && (depth -= 1) === 0) return source.slice(start, index + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

function testLegacyEndpointCallIsUnchangedAndStillReachable() {
  const importFn = functionSource(appSource, "importScreenshotFile");
  assert.match(importFn, /postJson\("\/api\/import\/screenshot",\s*\{\s*imageBase64: payload\.imageBase64,\s*mimeType: payload\.mimeType,\s*\}\)/, "the whole-image request is byte-for-byte the existing call");
  assert.ok(importFn.indexOf("attemptImportEngineV2(") > 0, "V2 is attempted from the upload handler");
  assert.ok(importFn.indexOf("attemptImportEngineV2(") < importFn.indexOf("fileToPayload(file)"), "V2 is tried before the legacy payload is built, and legacy still follows");
  assert.match(importFn, /if \(await attemptImportEngineV2\(file, importGeneration\)\) return;/);
}

function testModulesLoadInDependencyOrderBeforeApp() {
  const order = (name) => htmlSource.indexOf(`./${name}"`);
  for (const [earlier, later] of [
    ["import-engine/types.js", "import-engine/legacyAdapter.js"],
    ["import-engine/legacyAdapter.js", "import-engine/validation/validator.js"],
    ["import-engine/validation/validator.js", "import-engine/engine.js"],
    ["import-engine/dispatch.js", "app.js"],
    ["import-engine/progressView.js", "app.js"], // handWorkspaceView reads it lazily, at render time
    ["vendor/tesseract/tesseract.min.js", "import-engine/ocr/workerPool.js"],
    ["importBuilderAdapter.js", "import-engine/validation/validator.js"],
    ["importProgressModel.js", "import-engine/engine.js"],
  ]) {
    assert.ok(order(earlier) > 0 && order(later) > 0, `${earlier} and ${later} must both be loaded`);
    assert.ok(order(earlier) < order(later), `${earlier} must load before ${later}`);
  }
  assert.match(htmlSource, /id="importStages"[^>]*class="[^"]*is-hidden/);
  assert.ok(htmlSource.indexOf('id="importStages"') > htmlSource.indexOf('id="importStatus"'), "the stage list sits below the status line");
}

function testProgressControlsAreWiredToExistingCorrectionControls() {
  assert.match(appSource, /\$\("importStages"\)\?\.addEventListener\("click"/);
  assert.match(appSource, /data-import-field-ref|importFieldRef/);
  const focus = functionSource(appSource, "focusImportField");
  assert.match(focus, /resolveFieldRef/);
  assert.match(focus, /data-decision-key/);
}

// ---- behaviour: run the real app.js functions against stubs ---------------------------------------------------
function element() {
  const classes = new Set();
  return { innerHTML: "", textContent: "", classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) }, addEventListener() {}, querySelector: () => null, focus() {}, scrollIntoView() {} };
}

function makeHarness({ health = { importEngineV2Enabled: true, importEngineV2Sites: ["Natural8"] }, runtime } = {}) {
  const ctx = { console };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const file of ["preflopBuilderModel.js", "postflopBuilderModel.js", "importBuilderAdapter.js", "handSessionModel.js", "importDecisionModel.js", "import-engine/dispatch.js", "import-engine/progressView.js", "importProgressModel.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../public", file), "utf8"), ctx, { filename: file });
  }
  const elements = {};
  Object.assign(ctx, {
    $: (id) => (elements[id] ||= element()),
    elements,
    API_CLIENT: null,
    fetch: async () => ({ ok: Boolean(health), json: async () => health }),
    postJson: async () => { throw new Error("postJson must not be used by the V2 attempt"); },
    IMPORT_DISPATCH: ctx.PokerCoachImportDispatch,
    IMPORT_PROGRESS_VIEW: ctx.PokerCoachImportProgressView,
    IMPORT_BUILDER_ADAPTER: ctx.PokerCoachImportBuilderAdapter,
    HAND_SESSION_MODEL: ctx.PokerCoachHandSessionModel,
    IMPORT_DECISION_MODEL: ctx.PokerCoachImportDecisionModel,
    normalizeImportedHand: (hand) => JSON.parse(JSON.stringify({ ...hand, confidenceNotes: hand.confidenceNotes || [] })),
    renderImportedHand: () => { ctx.rendered = (ctx.rendered || 0) + 1; },
    importedAnalysisCache: { clear() {} },
    importWorkspace: { setSession(next) { ctx.workspaceSession = next; } },
    URL: { createObjectURL: () => "blob:test" },
    showImportPreview: () => {},
    screenshotImportGeneration: 1,
    importedHand: { marker: "previous-hand" },
    importSession: { marker: "previous-session" },
    currentVisionImportId: "previous-import",
    importEngineCapabilities: undefined,
  });
  ctx.PokerCoachImportRuntime = runtime;
  for (const name of ["loadImportEngineCapabilities", "hideImportStages", "renderImportStages", "attemptImportEngineV2"]) {
    vm.runInContext(functionSource(appSource, name).replace(/^async function|^function/, (match) => `${match}`), ctx, { filename: `app.js:${name}` });
  }
  vm.runInContext("let __marker = 0;", ctx);
  return ctx;
}

const ROWS = (actor, position, action, amountBb = null) => ({ actor, position, action, amountBb });
function replayableResult() {
  const legacy = {
    heroName: "Hero", heroHand: ["Ah", "Kh"],
    players: [["Opener", "UTG"], ["HJ", "HJ"], ["CO", "CO"], ["BTN", "BTN"], ["Hero", "SB"], ["BB", "BB"]].map(([name, position]) => ({ name, position, stackBb: 100, isHero: name === "Hero" })),
    board: { flop: [], turn: null, river: null },
    streets: {
      preflop: { actions: [ROWS("Opener", "UTG", "raise", 2.5), ROWS("HJ", "HJ", "fold"), ROWS("CO", "CO", "fold"), ROWS("BTN", "BTN", "fold"), ROWS("Hero", "SB", "raise", 9), ROWS("BB", "BB", "fold"), ROWS("Opener", "UTG", "call", 6.5)] },
      flop: { actions: [] }, turn: { actions: [] }, river: { actions: [] },
    },
  };
  return { route: "v2", converted: { preflopState: {} }, legacy, valid: true, hand: { warnings: [], actions: { preflop: [{}] }, source: { adapterId: "natural8", adapterVersion: "1" } }, validation: {} };
}

function runtimeFor({ detection, importImpl }) {
  const engineCalls = [];
  return {
    engineCalls,
    prepare: async () => ({ detection, source: { width: 10, height: 20 }, anchors: { tallAspect: true }, createEngine: () => ({ import: async (source, options) => { engineCalls.push({ source, options }); return importImpl(source, options); } }) }),
  };
}
const SUPPORTED = { supported: true, adapter: { site: "Natural8" }, detection: { site: "Natural8", score: 0.95 } };

async function testDisabledOrUnsupportedRoutesFallBackToTheLegacyImporter() {
  const disabled = makeHarness({ health: { importEngineV2Enabled: false, importEngineV2Sites: ["Natural8"] }, runtime: runtimeFor({ detection: SUPPORTED, importImpl: async () => replayableResult() }) });
  assert.equal(await disabled.attemptImportEngineV2({}, 1), false);
  assert.equal(disabled.PokerCoachImportRuntime.engineCalls.length, 0, "a disabled flag never runs the engine");
  assert.equal(disabled.importSession.marker, "previous-session");

  const unsupported = makeHarness({ runtime: runtimeFor({ detection: { supported: false, detection: { score: 0.3 } }, importImpl: async () => replayableResult() }) });
  assert.equal(await unsupported.attemptImportEngineV2({}, 1), false);
  assert.equal(unsupported.PokerCoachImportRuntime.engineCalls.length, 0);

  const noRuntime = makeHarness({ runtime: undefined });
  assert.equal(await noRuntime.attemptImportEngineV2({}, 1), false, "V2 enabled but no runtime yet: legacy importer");

  const unhealthy = makeHarness({ health: null, runtime: runtimeFor({ detection: SUPPORTED, importImpl: async () => replayableResult() }) });
  assert.equal(await unhealthy.attemptImportEngineV2({}, 1), false, "an unreachable health check never blocks the legacy importer");

  const otherSite = makeHarness({ health: { importEngineV2Enabled: true, importEngineV2Sites: ["CoinPoker"] }, runtime: runtimeFor({ detection: SUPPORTED, importImpl: async () => replayableResult() }) });
  assert.equal(await otherSite.attemptImportEngineV2({}, 1), false);
}

async function testSuccessfulV2ImportReplacesTheSessionThroughTheExistingAdapter() {
  const runtime = runtimeFor({ detection: SUPPORTED, importImpl: async (source, options) => {
    const { createStageProgress } = harness.PokeTeriorImportProgress;
    const progress = createStageProgress({ onChange: options.onProgress });
    progress.start("site");
    return replayableResult();
  } });
  const harness = makeHarness({ runtime });
  const previousSession = harness.importSession;
  const handled = await harness.attemptImportEngineV2({ name: "shot.png" }, 1);
  assert.equal(handled, true, harness.elements.importStatus.textContent);
  assert.notEqual(harness.importSession, previousSession, "the session object was replaced");
  assert.ok(harness.importSession.handState, "and now holds a replayed builder hand");
  assert.equal(harness.importSession.handState.actionIndex["preflop:0"].actor, "UTG", "the session holds a replayed builder hand");
  assert.equal(harness.importSession.metadata.provider, "import-engine-v2");
  assert.equal(harness.importSession.metadata.model, "natural8@1");
  assert.equal(harness.importedHand.heroName, "Hero");
  assert.match(harness.currentVisionImportId, /^imp_v2_/);
  assert.equal(harness.rendered, 1);
  assert.equal(harness.workspaceSession.selectedDecisionKey, null);
  assert.equal(runtime.engineCalls[0].options.importId, harness.currentVisionImportId);
  assert.match(harness.elements.importStages.innerHTML, /import-stage-list/, "progress is rendered while the engine runs");
  assert.ok(!harness.elements.importStages.classList.contains("is-hidden"));
  assert.match(harness.elements.importStatus.textContent, /local import engine/i);
}

async function testAFailedOrNonReplayableV2ImportKeepsThePreviousSession() {
  for (const importImpl of [
    async () => { throw new Error("worker crashed"); },
    async () => ({ ...replayableResult(), hand: { warnings: [], actions: { preflop: [] } } }),
    async () => ({ route: "legacy", reason: "unsupported-layout" }),
  ]) {
    const harness = makeHarness({ runtime: runtimeFor({ detection: SUPPORTED, importImpl }) });
    const previousSession = harness.importSession;
    assert.equal(await harness.attemptImportEngineV2({}, 1), false, "the caller falls back to the full-image importer");
    assert.equal(harness.importSession, previousSession, "the very same session object is kept");
    assert.equal(harness.importedHand.marker, "previous-hand");
    assert.equal(harness.currentVisionImportId, "previous-import");
    assert.match(harness.elements.importStatus.textContent, /full-image importer/);
  }
}

async function testAStaleGenerationCanNeverReplaceTheSession() {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const harness = makeHarness({ runtime: runtimeFor({ detection: SUPPORTED, importImpl: async () => { await gate; return replayableResult(); } }) });
  const pending = harness.attemptImportEngineV2({}, 1);
  await new Promise((resolve) => setImmediate(resolve));
  harness.screenshotImportGeneration = 2; // the user dropped a newer screenshot
  const previousSession = harness.importSession;
  release();
  assert.equal(await pending, true, "a superseded import is finished, not retried on the legacy path");
  assert.equal(harness.importSession, previousSession, "the stale result must not replace the session");
  assert.equal(harness.importedHand.marker, "previous-hand");
  assert.equal(harness.rendered, undefined);

  const supersededEarly = makeHarness({ runtime: runtimeFor({ detection: SUPPORTED, importImpl: async () => replayableResult() }) });
  supersededEarly.screenshotImportGeneration = 5;
  assert.equal(await supersededEarly.attemptImportEngineV2({}, 1), true, "superseded before it started");
  assert.equal(supersededEarly.PokerCoachImportRuntime.engineCalls.length, 0);
}

async function testStaleProgressEventsAreNotRendered() {
  let harnessRef;
  const runtime = runtimeFor({ detection: SUPPORTED, importImpl: async (source, options) => {
    harnessRef.screenshotImportGeneration = 9;
    const progress = harnessRef.PokeTeriorImportProgress.createStageProgress({ onChange: options.onProgress });
    progress.start("site");
    return replayableResult();
  } });
  harnessRef = makeHarness({ runtime });
  await harnessRef.attemptImportEngineV2({}, 1);
  assert.equal(harnessRef.elements.importStages?.innerHTML || "", "", "a stale import cannot draw into the progress list");
}

async function testCapabilitiesAreCachedOnlyOnSuccess() {
  let fetches = 0;
  const harness = makeHarness({ runtime: undefined });
  harness.fetch = async () => { fetches += 1; return { ok: true, json: async () => ({ importEngineV2Enabled: true, importEngineV2Sites: ["Natural8"] }) }; };
  await harness.loadImportEngineCapabilities();
  await harness.loadImportEngineCapabilities();
  assert.equal(fetches, 1);
  const failing = makeHarness({ runtime: undefined });
  let attempts = 0;
  failing.fetch = async () => { attempts += 1; throw new Error("offline"); };
  assert.equal(await failing.loadImportEngineCapabilities(), null);
  assert.equal(await failing.loadImportEngineCapabilities(), null);
  assert.equal(attempts, 2, "a failed health check is retried on the next upload");
}

testLegacyEndpointCallIsUnchangedAndStillReachable();
testModulesLoadInDependencyOrderBeforeApp();
testProgressControlsAreWiredToExistingCorrectionControls();
let completed = false;
process.on("exit", () => { if (!completed) { console.error("import V2 wiring tests did not complete"); process.exitCode = 1; } });
(async () => {
  await testDisabledOrUnsupportedRoutesFallBackToTheLegacyImporter();
  await testSuccessfulV2ImportReplacesTheSessionThroughTheExistingAdapter();
  await testAFailedOrNonReplayableV2ImportKeepsThePreviousSession();
  await testAStaleGenerationCanNeverReplaceTheSession();
  await testStaleProgressEventsAreNotRendered();
  await testCapabilitiesAreCachedOnlyOnSuccess();
  completed = true;
  console.log("import V2 wiring tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
