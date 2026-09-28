const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/analysisRequestModel.js"), "utf8");
const sandbox = { window: {}, globalThis: {}, AbortController };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: "analysisRequestModel.js" });

const coordinator = sandbox.PokerCoachAnalysisRequestModel.createAnalysisRequestCoordinator();
const first = coordinator.begin("first");
assert.equal(first.aborted, false);
const second = coordinator.begin("second");
assert.equal(first.aborted, true, "starting a replacement analysis must abort obsolete provider work");
assert.equal(second.aborted, false);
coordinator.finish("first");
assert.equal(second.aborted, false, "finishing a stale analysis must not cancel the current analysis");
coordinator.cancel();
assert.equal(second.aborted, true, "explicit cancellation must abort the active analysis");

console.log("analysis request coordinator checks passed");
