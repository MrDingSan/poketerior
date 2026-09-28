const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/import-engine/ocr/workerPool.js"), "utf8"), sandbox, { filename: "workerPool.js" });
const ocr = sandbox.PokerCoachImportOcr;
assert.ok(ocr, "PokerCoachImportOcr must be attached");

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
  const d = {};
  d.promise = new Promise((resolve, reject) => { d.resolve = resolve; d.reject = reject; });
  return d;
}

function fakeFactory({ failFirst = false } = {}) {
  const created = [];
  created.allCalls = [];
  let attempts = 0;
  async function createWorker(language, oem, options) {
    attempts += 1;
    if (failFirst && attempts === 1) throw new Error("wasm failed to load");
    const worker = {
      id: created.length,
      language,
      oem,
      options,
      calls: [],
      params: [],
      terminated: 0,
      async setParameters(parameters) { worker.params.push(parameters); },
      recognize(image, recognizeOptions) {
        const call = { image, recognizeOptions, ...deferred() };
        worker.calls.push(call);
        created.allCalls.push(call);
        return call.promise;
      },
      async terminate() { worker.terminated += 1; },
    };
    created.push(worker);
    return worker;
  }
  return { createWorker, created, attempts: () => attempts };
}

// calls in the order they actually started, across all workers
const startedCalls = (created) => created.allCalls;

async function testFixedTwoWorkersRunFourJobsTwoAtATime() {
  const factory = fakeFactory();
  const pool = ocr.createPool({ createWorker: factory.createWorker });
  const jobs = ["a", "b", "c", "d"].map((image) => pool.recognize(image));
  await tick();
  assert.equal(factory.created.length, 2, "exactly two workers are created for four queued jobs");
  assert.equal(startedCalls(factory.created).length, 2, "only two jobs begin before either resolves");

  const first = startedCalls(factory.created)[0];
  const releasedWorker = factory.created.find((worker) => worker.calls.includes(first));
  first.settled = true;
  first.resolve({ data: { text: "one" } });
  await tick();
  assert.equal(startedCalls(factory.created).length, 3, "third job starts as soon as a worker is released");
  assert.equal(releasedWorker.calls.length, 2, "the third job runs on the released worker");
  assert.deepEqual(await jobs[0], { data: { text: "one" } });

  for (let round = 0; round < 4; round += 1) {
    for (const call of startedCalls(factory.created)) if (!call.settled) { call.settled = true; call.resolve({ data: { text: "done" } }); }
    await tick();
  }
  first.settled = true;
  const results = await Promise.all(jobs);
  assert.equal(results.length, 4);
  assert.equal(factory.created.length, 2, "workers are never recreated for later jobs");
}

async function testWorkersAreInitializedOnceAndReusedAcrossImports() {
  const factory = fakeFactory();
  const pool = ocr.createPool({ createWorker: factory.createWorker });
  for (let run = 0; run < 3; run += 1) {
    const job = pool.recognize(`img${run}`);
    await tick();
    startedCalls(factory.created).at(-1).resolve({ data: { text: String(run) } });
    await job;
  }
  assert.equal(factory.attempts(), 2);
  assert.equal(factory.created.length, 2);
}

async function testCreateWorkerReceivesLocalAssetOptionsAndParameters() {
  const factory = fakeFactory();
  const workerOptions = { workerPath: "/w.js", corePath: "/core/", langPath: "/lang/" };
  const pool = ocr.createPool({ createWorker: factory.createWorker, workerOptions });
  const job = pool.recognize("img", { parameters: { tessedit_char_whitelist: "0123456789.BB " } });
  await tick();
  const worker = factory.created[0];
  assert.equal(worker.language, "eng");
  assert.deepEqual(JSON.parse(JSON.stringify(worker.options)), workerOptions);
  assert.equal(worker.params[0].preserve_interword_spaces, "1", "interword spaces are preserved on init");
  const jobParameters = worker.params.at(-1);
  assert.equal(jobParameters.tessedit_char_whitelist, "0123456789.BB ");
  assert.equal(jobParameters.preserve_interword_spaces, "1");
  assert.equal(worker.calls[0].image, "img");
  worker.calls[0].resolve({ data: {} });
  await job;

  const next = pool.recognize("img2");
  await tick();
  const nextWorker = factory.created.find((candidate) => candidate.calls.length && candidate.calls.at(-1).image === "img2");
  assert.equal(nextWorker.params.at(-1).tessedit_char_whitelist, undefined, "a previous job's whitelist never leaks into the next job");
  nextWorker.calls.at(-1).resolve({ data: {} });
  await next;
}

async function testDefaultsAreTwoWorkersAndLocalAssets() {
  assert.equal(ocr.DEFAULT_POOL_SIZE, 2);
  assert.match(ocr.LOCAL_WORKER_OPTIONS.workerPath, /vendor\/tesseract\/worker\.min\.js$/);
  assert.match(ocr.LOCAL_WORKER_OPTIONS.corePath, /vendor\/tesseract\/?$/);
  assert.match(ocr.LOCAL_WORKER_OPTIONS.langPath, /vendor\/tesseract\/?$/);
  assert.ok(!/^https?:/i.test(ocr.LOCAL_WORKER_OPTIONS.workerPath + ocr.LOCAL_WORKER_OPTIONS.corePath + ocr.LOCAL_WORKER_OPTIONS.langPath), "no CDN assets");
  const factory = fakeFactory();
  const pool = ocr.createPool({ createWorker: factory.createWorker });
  const job = pool.recognize("x");
  await tick();
  assert.equal(factory.created[0].options.workerPath, ocr.LOCAL_WORKER_OPTIONS.workerPath);
  factory.created[0].calls[0].resolve({});
  await job;
  await assert.rejects(ocr.createPool({ createWorker: null }).recognize("x"), /createWorker/, "a missing Tesseract runtime fails clearly");
}

async function testJobFailureRejectsOnlyThatJobAndReleasesTheWorker() {
  const factory = fakeFactory();
  const pool = ocr.createPool({ createWorker: factory.createWorker, size: 1 });
  const failing = pool.recognize("bad");
  const following = pool.recognize("good");
  await tick();
  factory.created[0].calls[0].reject(new Error("recognition crashed"));
  await assert.rejects(failing, /recognition crashed/);
  await tick();
  assert.equal(factory.created[0].calls.length, 2, "the queued job runs after a failure");
  factory.created[0].calls[1].resolve({ data: { text: "ok" } });
  assert.deepEqual(await following, { data: { text: "ok" } });
}

async function testInitFailureRejectsQueuedJobsAndCanRetry() {
  const factory = fakeFactory({ failFirst: true });
  const pool = ocr.createPool({ createWorker: factory.createWorker });
  await assert.rejects(pool.recognize("a"), /wasm failed to load/);
  await tick();
  for (const worker of factory.created) assert.equal(worker.terminated, 1, "workers created before the failure are cleaned up");
  const retry = pool.recognize("b");
  await tick();
  assert.ok(startedCalls(factory.created).length >= 1, "a later call retries initialization");
  startedCalls(factory.created).forEach((call) => call.resolve({ data: {} }));
  await retry;
}

async function testTerminateStopsEachWorkerExactlyOnce() {
  const factory = fakeFactory();
  const pool = ocr.createPool({ createWorker: factory.createWorker });
  const running = pool.recognize("a");
  const queued = [pool.recognize("b"), pool.recognize("c")];
  await tick();
  const outcomes = Promise.allSettled([running, ...queued]);
  await pool.terminate();
  await pool.terminate();
  assert.deepEqual(factory.created.map((worker) => worker.terminated), [1, 1]);
  await assert.rejects(pool.recognize("late"), /terminated/i);
  startedCalls(factory.created).forEach((call) => call.reject(new Error("worker terminated")));
  const settled = await outcomes;
  assert.ok(settled.every((entry) => entry.status === "rejected"), "queued and running jobs settle after terminate");

  const untouched = ocr.createPool({ createWorker: fakeFactory().createWorker });
  await untouched.terminate();
}

// An awaited promise that never settles would drain the event loop and exit 0 silently; fail loudly instead.
let completed = false;
process.on("exit", () => {
  if (!completed) {
    console.error("import OCR pool tests did not complete: an awaited job never settled");
    process.exitCode = 1;
  }
});

(async () => {
  await testFixedTwoWorkersRunFourJobsTwoAtATime();
  await testWorkersAreInitializedOnceAndReusedAcrossImports();
  await testCreateWorkerReceivesLocalAssetOptionsAndParameters();
  await testDefaultsAreTwoWorkersAndLocalAssets();
  await testJobFailureRejectsOnlyThatJobAndReleasesTheWorker();
  await testInitFailureRejectsQueuedJobsAndCanRetry();
  await testTerminateStopsEachWorkerExactlyOnce();
  completed = true;
  console.log("import OCR pool tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
