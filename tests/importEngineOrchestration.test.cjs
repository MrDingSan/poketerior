const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const files = [
  "importProgressModel.js",
  "import-engine/types.js",
  "import-engine/legacyAdapter.js",
  "import-engine/adapters/registry.js",
  "import-engine/vision/regions.js",
  "import-engine/adapters/natural8.js",
  "import-engine/parsing/actions.js",
  "preflopBuilderModel.js",
  "postflopBuilderModel.js",
  "importBuilderAdapter.js",
  "import-engine/validation/validator.js",
  "import-engine/engine.js",
];
for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, "../public", file), "utf8"), sandbox, { filename: file });
const Engine = sandbox.PokerCoachImportEngineV2;
assert.ok(Engine, "PokerCoachImportEngineV2 must be attached");
const plain = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { const d = {}; d.promise = new Promise((resolve, reject) => { d.resolve = resolve; d.reject = reject; }); return d; };

const SOURCE = { width: 1280, height: 2022 };
const ALL_ANCHORS = { tallAspect: true, historyBoundary: true, fiveColumns: true, streetHeadings: true, tableCards: true };
const region = (street, index) => ({ x: 0.4, y: 0.56 + index * 0.04, width: 0.2, height: 0.04, street });

const row = (street, index, text, actorName, position) => ({ text, actorName, position, confidence: 0.95, sourceRegion: region(street, index) });
const ROWS = {
  preflop: [
    ["Raise 2.5 BB", "Opener", "UTG"], ["Fold", "HJ", "HJ"], ["Fold", "CO", "CO"], ["Fold", "BTN", "BTN"],
    ["Raise 9 BB", "Hero", "SB"], ["Fold", "BB", "BB"], ["Call 6.5 BB", "Opener", "UTG"],
  ],
  flop: [["Check", "Hero", "SB"], ["Bet 5 BB", "Opener", "UTG"], ["Call 5 BB", "Hero", "SB"]],
  turn: [["Check", "Hero", "SB"], ["Bet 8.2 BB", "Opener", "UTG"], ["Call 8.2 BB", "Hero", "SB"]],
  river: [["Check", "Hero", "SB"], ["Bet 9 BB", "Opener", "UTG"], ["Call 9 BB", "Hero", "SB"]],
};
const POTS = { preflop: 1.5, flop: 19, turn: 29, river: 45.4 };

function streetResult(street, { confidence = 0.95, mutate } = {}) {
  const rows = ROWS[street].map(([text, actor, position], index) => row(street, index, text, actor, position));
  if (mutate) mutate(rows);
  return { street, rows, confidence, rawText: rows.map((entry) => entry.text).join("\n"), potBb: POTS[street] };
}
const HERO = () => ({ cards: ["Ah", "Kh"], confidence: 0.97, heroName: "Hero", heroPosition: "SB", sourceRegion: { x: 0.43, y: 0.375, width: 0.14, height: 0.04 } });
const BOARD = () => ({ flop: ["Qh", "7s", "4h"], turn: "Jc", river: "2d", confidence: 0.96, sourceRegion: { x: 0.27, y: 0.22, width: 0.45, height: 0.08 } });

// Recognizers stay pending until the test resolves them, so ordering and concurrency are observable.
function deferredRecognizers({ retry = {} } = {}) {
  const calls = [];
  const pending = {};
  const make = (name) => (context) => {
    calls.push({ name, attempt: context.attempt });
    if (context.attempt > 0 && retry[name]) return Promise.resolve(retry[name]());
    const job = deferred();
    pending[name] = job;
    return job.promise;
  };
  return {
    calls,
    pending,
    recognizers: { heroCards: make("heroCards"), board: make("board"), streets: { preflop: make("preflop"), flop: make("flop"), turn: make("turn"), river: make("river") } },
  };
}

function immediateRecognizers(overrides = {}) {
  const calls = [];
  const make = (name, value) => (context) => {
    calls.push({ name, attempt: context.attempt });
    const produced = overrides[name] ? overrides[name](context) : value();
    return produced instanceof Error ? Promise.reject(produced) : Promise.resolve(produced);
  };
  return {
    calls,
    recognizers: {
      heroCards: make("heroCards", HERO), board: make("board", BOARD),
      streets: Object.fromEntries(["preflop", "flop", "turn", "river"].map((street) => [street, make(street, () => streetResult(street))])),
    },
  };
}

function buildEngine(recognizers, { fallback, discover } = {}) {
  const fallbackCalls = [];
  const engine = Engine.create({
    registry: sandbox.PokerCoachImportAdapters.createRegistry([sandbox.PokerCoachNatural8Adapter]),
    recognizers,
    fallback: fallback ? { resolve: async (request) => { fallbackCalls.push(request); return fallback(request); } } : { resolve: async (request) => { fallbackCalls.push(request); return null; } },
    discoverDecisions: discover || ((converted) => Object.keys(converted.actionIndex)),
  });
  return { engine, fallbackCalls };
}

async function testAllSixJobsStartConcurrentlyAndProgressFollowsCompletionOrder() {
  const { calls, pending, recognizers } = deferredRecognizers();
  const { engine } = buildEngine(recognizers);
  const events = [];
  const run = engine.import(SOURCE, { anchors: ALL_ANCHORS, onProgress: (snapshot, change) => events.push(change) });
  await tick();
  assert.deepEqual(calls.map((call) => call.name).sort(), ["board", "flop", "heroCards", "preflop", "river", "turn"], "all six jobs are invoked before any resolves");
  assert.ok(calls.every((call) => call.attempt === 0));

  const resolveOrder = ["river", "board", "flop", "preflop", "turn", "heroCards"];
  const values = { heroCards: HERO(), board: BOARD(), preflop: streetResult("preflop"), flop: streetResult("flop"), turn: streetResult("turn"), river: streetResult("river") };
  for (const name of resolveOrder) {
    pending[name].resolve(values[name]);
    await tick();
  }
  const result = await run;
  const completions = events.filter((change) => change.from === "running" && resolveOrder.includes(change.stage)).map((change) => change.stage);
  assert.deepEqual(completions, resolveOrder, "progress is emitted in actual completion order");
  assert.equal(result.route, "v2");
  assert.equal(result.valid, true);
  assert.equal(result.fullImageProviderCalls, 0);
  assert.equal(calls.length, 6, "confident results trigger no retries");
  for (const stage of ["site", "heroCards", "board", "preflop", "flop", "turn", "river", "validation", "reconstruction", "decisions"]) {
    assert.equal(result.progress[stage].status, "complete", `${stage} should be complete`);
  }
  assert.equal(result.hand.actions.flop[1].amountBb, 5);
  assert.deepEqual(Array.from(result.hand.hero.cards), ["Ah", "Kh"]);
  assert.ok(result.decisionKeys.length > 0);
  assert.equal(result.converted.unresolved.length, 0);
  assert.equal(plain(result.legacy.streets.flop.actions[1]).action, "bet");
}

async function testFinalValidationWaitsForEverySettledJob() {
  const { pending, recognizers } = deferredRecognizers();
  const { engine } = buildEngine(recognizers);
  const events = [];
  const run = engine.import(SOURCE, { anchors: ALL_ANCHORS, onProgress: (snapshot, change) => events.push(change.stage) });
  await tick();
  pending.heroCards.resolve(HERO());
  pending.board.resolve(BOARD());
  pending.preflop.resolve(streetResult("preflop"));
  pending.flop.resolve(streetResult("flop"));
  pending.turn.resolve(streetResult("turn"));
  await tick();
  assert.ok(!events.includes("validation"), "strict validation must not start while the river job is still pending");
  pending.river.resolve(streetResult("river"));
  await run;
  assert.ok(events.includes("validation"));
}

async function testOnlyTheMediumConfidenceStreetIsRetried() {
  const { calls, pending, recognizers } = deferredRecognizers({ retry: { flop: () => streetResult("flop", { confidence: 0.95 }) } });
  const { engine, fallbackCalls } = buildEngine(recognizers);
  const events = [];
  const run = engine.import(SOURCE, { anchors: ALL_ANCHORS, onProgress: (snapshot, change) => events.push(`${change.stage}:${change.to}`) });
  await tick();
  pending.heroCards.resolve(HERO());
  pending.board.resolve(BOARD());
  pending.preflop.resolve(streetResult("preflop"));
  pending.flop.resolve(streetResult("flop", { confidence: 0.8 }));
  pending.turn.resolve(streetResult("turn"));
  pending.river.resolve(streetResult("river"));
  const result = await run;
  assert.deepEqual(calls.filter((call) => call.name === "flop").map((call) => call.attempt), [0, 1]);
  for (const name of ["heroCards", "board", "preflop", "turn", "river"]) {
    assert.equal(calls.filter((call) => call.name === name).length, 1, `${name} is not retried`);
  }
  assert.ok(events.includes("flop:warning"), "the medium result is first reported as needing review");
  assert.equal(result.progress.flop.status, "complete", "the improved retry upgrades the stage");
  assert.equal(fallbackCalls.length, 0, "a deterministic retry that succeeds needs no AI");
  assert.equal(result.hand.confidence.level, "high");
}

async function testARetryThatIsNotBetterKeepsTheOriginalResult() {
  const first = () => streetResult("flop", { confidence: 0.8 });
  const { recognizers } = immediateRecognizers({ flop: (context) => (context.attempt === 0 ? first() : streetResult("flop", { confidence: 0.5 })) });
  const { engine } = buildEngine(recognizers);
  const result = await engine.import(SOURCE, { anchors: ALL_ANCHORS });
  assert.equal(result.hand.confidence.fields["actions.flop.0"], 0.8);
  assert.equal(result.hand.actions.flop.length, 3);
}

async function testLowConfidenceAmountUsesExactlyOneTargetedFallback() {
  const { recognizers, calls } = immediateRecognizers({
    river: () => streetResult("river", { mutate: (rows) => { rows[1].text = "Bet O.B BB"; } }),
  });
  const { engine, fallbackCalls } = buildEngine(recognizers, { fallback: async () => ({ value: 9, confidence: 0.93 }) });
  const result = await engine.import(SOURCE, { anchors: ALL_ANCHORS });
  assert.equal(fallbackCalls.length, 1, "exactly one targeted request");
  const request = fallbackCalls[0];
  assert.equal(request.purpose, "action-amount");
  assert.equal(request.field, "actions.river.1.amountBb");
  assert.deepEqual(plain(request.region), plain(region("river", 1)), "only that row's crop region is sent");
  assert.equal(request.context.street, "river");
  assert.equal(request.context.actorName, "Opener");
  assert.equal(result.hand.actions.river[1].amountBb, 9);
  assert.equal(result.fullImageProviderCalls, 0);
  assert.equal(result.fallbackCalls.length, 1);
  assert.equal(result.valid, true, "the recovered amount passes the same strict validator");
  assert.equal(calls.filter((call) => call.name === "river").length, 1, "a low-confidence field goes to AI instead of another local retry");
  assert.equal(result.progress.validation.status, "complete");
}

async function testFallbackResultIsValidatedAndNeverRequestedTwice() {
  const { recognizers } = immediateRecognizers({
    river: () => streetResult("river", { mutate: (rows) => { rows[1].text = "Bet O.B BB"; } }),
  });
  const { engine, fallbackCalls } = buildEngine(recognizers, { fallback: async () => ({ value: 1, confidence: 0.9 }) });
  const result = await engine.import(SOURCE, { anchors: ALL_ANCHORS });
  assert.equal(fallbackCalls.length, 1, "one request per unresolved field per import");
  assert.equal(result.hand.actions.river[1].amountBb, 1);
  assert.equal(result.valid, false, "an AI answer that breaks poker rules is still rejected by the validator");
  assert.ok(result.validation.replayIssues.some((issue) => issue.field.startsWith("actions.river")));
  assert.equal(result.progress.validation.status, "warning");
}

async function testMissingFallbackAnswerLeavesAPartialCorrectableHand() {
  const { recognizers } = immediateRecognizers({
    river: () => streetResult("river", { mutate: (rows) => { rows[1].text = "Bet O.B BB"; } }),
  });
  const { engine } = buildEngine(recognizers);
  const result = await engine.import(SOURCE, { anchors: ALL_ANCHORS });
  assert.equal(result.route, "v2");
  assert.equal(result.valid, false);
  assert.equal(result.hand.actions.river[1].amountBb, null, "no amount is invented");
  assert.equal(result.hand.actions.flop.length, 3, "unrelated valid fields are kept");
  assert.equal(result.progress.validation.status, "warning");
  assert.ok(Array.from(result.progress.validation.fieldRefs).includes("actions.river.1.amountBb"), "the warning names the exact field");
  assert.ok(result.converted.unresolved.some((entry) => entry.key === "river:1"));
}

async function testAFailedJobDoesNotEraseTheOtherFields() {
  const { recognizers } = immediateRecognizers({ turn: () => new Error("ocr crashed") });
  const { engine } = buildEngine(recognizers);
  const result = await engine.import(SOURCE, { anchors: ALL_ANCHORS });
  assert.equal(result.route, "v2");
  assert.equal(result.progress.turn.status, "error");
  assert.match(result.progress.turn.message, /ocr crashed/);
  assert.equal(result.progress.flop.status, "complete");
  assert.deepEqual(Array.from(result.hand.hero.cards), ["Ah", "Kh"]);
  assert.equal(result.hand.actions.flop.length, 3);
  assert.equal(result.hand.actions.turn.length, 0);
}

async function testUnsupportedLayoutRoutesToTheLegacyImporter() {
  const { recognizers, calls } = immediateRecognizers();
  const { engine } = buildEngine(recognizers);
  const result = await engine.import(SOURCE, { anchors: { tallAspect: true } });
  assert.equal(result.route, "legacy");
  assert.equal(result.reason, "unsupported-layout");
  assert.equal(calls.length, 0, "no recognition work starts for an unsupported site");
  assert.equal(result.progress.site.status, "warning");
  assert.equal(result.progress.heroCards.status, "pending");
  assert.ok(result.detection.score < 0.8);
}

async function testPartialHandsAreEmittedAsJobsFinish() {
  const { pending, recognizers } = deferredRecognizers();
  const { engine } = buildEngine(recognizers);
  const partials = [];
  const run = engine.import(SOURCE, { anchors: ALL_ANCHORS, onPartial: (hand) => partials.push(hand) });
  await tick();
  pending.heroCards.resolve(HERO());
  await tick();
  assert.equal(partials.length, 1);
  assert.deepEqual(Array.from(partials[0].hero.cards), ["Ah", "Kh"]);
  assert.equal(partials[0].validation.valid, null, "partial hands are tentative until validated");
  pending.flop.resolve(streetResult("flop"));
  await tick();
  assert.equal(partials.length, 2);
  assert.equal(partials[1].actions.flop.length, 3);
  pending.board.resolve(BOARD());
  pending.preflop.resolve(streetResult("preflop"));
  pending.turn.resolve(streetResult("turn"));
  pending.river.resolve(streetResult("river"));
  await run;
}

async function testStageProgressCanBeDrivenByTheRealProgressModel() {
  const { recognizers } = immediateRecognizers();
  const { engine } = buildEngine(recognizers);
  const snapshots = [];
  await engine.import(SOURCE, { anchors: ALL_ANCHORS, onProgress: (snapshot) => snapshots.push(snapshot) });
  assert.ok(snapshots.length >= 10);
  assert.ok(snapshots.every((snapshot) => Object.isFrozen(snapshot)));
}

let completed = false;
process.on("exit", () => {
  if (!completed) {
    console.error("import engine orchestration tests did not complete: an awaited job never settled");
    process.exitCode = 1;
  }
});

(async () => {
  await testAllSixJobsStartConcurrentlyAndProgressFollowsCompletionOrder();
  await testFinalValidationWaitsForEverySettledJob();
  await testOnlyTheMediumConfidenceStreetIsRetried();
  await testARetryThatIsNotBetterKeepsTheOriginalResult();
  await testLowConfidenceAmountUsesExactlyOneTargetedFallback();
  await testFallbackResultIsValidatedAndNeverRequestedTwice();
  await testMissingFallbackAnswerLeavesAPartialCorrectableHand();
  await testAFailedJobDoesNotEraseTheOtherFields();
  await testUnsupportedLayoutRoutesToTheLegacyImporter();
  await testPartialHandsAreEmittedAsJobsFinish();
  await testStageProgressCanBeDrivenByTheRealProgressModel();
  completed = true;
  console.log("import engine orchestration tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
