const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));

assert.equal(html.includes("ruleRangeTab"), false, "rule-based range tab should not be rendered.");
assert.equal(html.includes("Rule-based"), false, "rule-based range label should not be rendered.");
assert.equal(html.includes("llmRangeTab"), false, "range switch tab UI should be removed when LLM range is the only mode.");
assert.equal(html.includes("range-switch"), false, "range switch container should be removed.");

assert.equal(app.includes("renderRuleRangeView"), false, "rule range renderer should not be used by the UI.");
assert.equal(app.includes("setRangeView("), false, "range view switching should be removed.");
assert.equal(app.includes('active: "rule"'), false, "range state should not default to rule mode.");
assert.match(app, /currentRangeViews = \{ llm: \{ status: "loading" \} \}/, "analysis should initialize the range panel in LLM loading mode.");
assert.match(app, /renderLLMRangeView\(currentRangeViews\.llm\)/, "active range rendering should be LLM-only.");

for (const removed of [
  "RANGE_LIBRARY",
  "DEFAULT_RANGES",
  "PDF_RFI_RANGES_6MAX",
  "LOOSE_LOW_STAKES_ADDITIONS",
  "getRangeProfile",
  "buildCumulativeRange",
  "actionKeepsCombo",
  "narrowRangeForAction",
]) {
  assert.equal(app.includes(removed), false, `hard-coded range code ${removed} should be removed.`);
}
assert.match(
  app,
  /const rangeView = await renderLLMRangeInterpretation\(/,
  "equity should wait for the LLM range interpretation.",
);
assert.match(
  app,
  /estimateEquity\(heroCards, range\.combos, boardCards\)/,
  "equity should be computed against the parsed LLM range.",
);

assert.match(
  pkg.scripts.check,
  /tests\/llmOnlyRangeUi\.test\.cjs/,
  "npm run check should include the LLM-only range UI regression.",
);

console.log("LLM-only range UI regression checks passed");
