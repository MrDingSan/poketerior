const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/importProgressModel.js"), "utf8");
const sandbox = { window: {}, globalThis: {}, setInterval, clearInterval };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: "importProgressModel.js" });

const updates = [];
const progress = sandbox.PokeTeriorImportProgress.create({
  setStatus: (message) => updates.push(message),
  intervalMs: 5,
});

progress.start();
setTimeout(() => {
  progress.stop();
  assert.match(updates.at(-1), /Still extracting/i);
  assert.match(updates.at(-1), /fallback/i);
  const countAfterStop = updates.length;
  setTimeout(() => {
    assert.equal(updates.length, countAfterStop, "stopping progress must clear status updates");
    console.log("screenshot import progress regression passed");
  }, 10);
}, 12);
