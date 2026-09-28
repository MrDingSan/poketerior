const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "../public/providerAttribution.js"), "utf8"),
  sandbox,
);
const { attributionForResult } = sandbox.globalThis.PokerCoachProviderAttribution;

assert.deepEqual(
  { ...attributionForResult({
    provider: "nebius",
    model: "nvidia/nemotron-3-super-120b-a12b",
  }) },
  {
    label: "Powered by NVIDIA Nemotron via Nebius Token Factory",
    detail: "nvidia/nemotron-3-super-120b-a12b",
  },
);
assert.equal(
  attributionForResult({ provider: "gemini", model: "gemini-2.5-flash" }),
  null,
);
assert.equal(attributionForResult({ provider: "openrouter" }), null);
assert.equal(attributionForResult(null), null);

console.log("providerAttribution tests passed");
