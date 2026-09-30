const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");

assert.match(html, /id="developerDiagnostics"/, "the shell should retain a dedicated raw diagnostic target");
assert.match(app, /function appendDeveloperDiagnostic/, "analysis renderers should route technical detail through one diagnostic boundary");
assert.match(app, /AI range analysis unavailable/, "range failures should have concise product-facing copy");
assert.doesNotMatch(
  app,
  /LLM range interpretation is unavailable: \$\{escapeHtml\(view\.error\)\}/,
  "raw range errors should not be interpolated into the primary interface",
);
assert.doesNotMatch(
  app,
  /AI reasoning is unavailable: \$\{escapeHtml\(error\.message\)\}/,
  "raw reasoning errors should not be interpolated into the recommendation card",
);
assert.doesNotMatch(app, /Asking Gemini/, "loading copy should not expose a provider name");
assert.doesNotMatch(app, /Poker Coach/, "user-facing analysis copy should use the PokeTerior brand");
assert.match(app, /class="full-reasoning"/, "the complete provider response should be progressively disclosed");
assert.match(app, /Full skill-grounded analysis/, "advanced users should have an explicit full-reasoning control");
assert.match(app, /Full Harrington analysis/, "the Harrington card keeps its full-analysis control");

console.log("PokeTerior diagnostic disclosure checks passed");
