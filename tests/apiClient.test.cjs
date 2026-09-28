const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("public/apiClient.js", "utf8"), sandbox);
const api = sandbox.globalThis.PokerCoachApiClient;

assert.equal(
  api.resolveApiUrl("/api/analyze", { protocol: "file:", origin: "null" }),
  "http://localhost:4175/api/analyze",
);
assert.equal(
  api.resolveApiUrl("/api/range/interpret", { protocol: "file:", origin: "null" }),
  "http://localhost:4175/api/range/interpret",
);
assert.equal(
  api.resolveApiUrl("/api/analyze", { protocol: "http:", origin: "http://127.0.0.1:4175" }),
  "/api/analyze",
);
assert.equal(api.resolveApiUrl("https://example.com/test", { protocol: "file:", origin: "null" }), "https://example.com/test");

console.log("API client URL regression checks passed");
