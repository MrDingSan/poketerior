const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/handStagePresentation.js"), "utf8");
const sandbox = { window: {}, globalThis: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: "handStagePresentation.js" });

const model = sandbox.PokeTeriorHandStagePresentation;
assert.ok(model, "presentation model must be exported");

assert.deepEqual(
  JSON.parse(JSON.stringify(model.buildProgress("flop", ["preflop"]))),
  [
    { street: "preflop", status: "complete" },
    { street: "flop", status: "current" },
    { street: "turn", status: "pending" },
    { street: "river", status: "pending" },
    { street: "results", status: "pending" },
  ],
);

const timeline = model.buildTimeline([
  { key: "preflop:0", street: "preflop", actor: "UTG", label: "Raise 2.5 bb" },
  { key: "preflop:1", street: "preflop", actor: "CO", label: "Call" },
  { key: "flop:0", street: "flop", actor: "UTG", label: "Check" },
], "flop:0");

assert.equal(timeline.filter((entry) => entry.type === "street").length, 2);
assert.equal(timeline.filter((entry) => entry.type === "action" && entry.selected).length, 1);
assert.equal(timeline.at(-1).key, "flop:0");

console.log("hand stage presentation checks passed");
