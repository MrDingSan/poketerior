const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const css = fs.readFileSync(path.join(__dirname, "../public/styles.css"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
const workspaceCss = fs.readFileSync(path.join(__dirname, "../public/analysis-workspace.css"), "utf8");
const workspace = html.slice(html.indexOf('id="analysisWorkspace"'), html.indexOf("</main>"));

const panels = [...workspace.matchAll(/data-analysis-panel="(\w+)"/g)].map((match) => match[1]);
assert.deepEqual(panels, ["ranges", "equity", "ai", "breakdown"], "each analysis tab must own exactly one panel");
const tabs = [...workspace.matchAll(/data-analysis-tab="(\w+)"/g)].map((match) => match[1]);
assert.deepEqual(tabs, panels, "tab buttons must map 1:1 to panels");

function panelHtml(name) {
  const start = workspace.indexOf(`data-analysis-panel="${name}"`);
  const next = workspace.indexOf("data-analysis-panel=", start + 1);
  return workspace.slice(start, next === -1 ? undefined : next);
}
const placement = {
  ranges: ["rangeComboCount", "rangeText", "llmRangeMeta", "rangeTimeline", "rangeBreakdown", "actionBuckets", "rangeDetails"],
  equity: ["equityMetric", "potOddsMetric", "evMetric", "confluenceMetric", "equityBuckets", "boardTextureSummary"],
  ai: ["recommendation", "aiReasoning", "harringtonAnalysis", "pokerSkillAnalysis"],
  breakdown: ["calculationLog", "solverResult", "developerDiagnostics"],
};
for (const [panel, ids] of Object.entries(placement)) {
  for (const id of ids) {
    assert.match(panelHtml(panel), new RegExp(`id="${id}"`), `${id} must live under the ${panel} tab`);
  }
}
assert.doesNotMatch(html, /harrington-panel|pokerskill-panel/, "style analyses must not render outside the AI Analysis tab");
assert.match(workspaceCss, /\.tab-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/, "tab grids must ignore content-based minimum widths");
assert.match(workspaceCss, /overflow-wrap:\s*anywhere/, "long range and calculation text must wrap inside its card");
assert.ok(html.indexOf("analysis-workspace.css") > html.indexOf("poketerior-dashboard.css"), "workspace styles must load after the dashboard cascade");
assert.ok(html.indexOf("analysisTabsView.js") < html.indexOf("app.js"), "tab controller must load before app.js");

// The per-street action forms duplicate the builders, so they are data only: still in the DOM (analyze() reads
// them) but wrapped so they are never displayed.
const legacyStart = html.indexOf('<div class="legacy-street-inputs" hidden');
assert.ok(legacyStart > -1, "legacy street inputs must sit in a hidden wrapper");
const legacyBlock = html.slice(legacyStart, html.indexOf('<section id="analysisWorkspace"') > -1 ? html.indexOf('<section id="analysisWorkspace"') : html.indexOf('id="analysisWorkspace"'));
for (const id of ["flopSection", "turnSection", "riverSection", "flopActions", "turnActions", "riverActions", "boardCards", "turnCard", "riverCard"]) {
  assert.match(legacyBlock, new RegExp(`id="${id}"`), `${id} must stay in the DOM inside the hidden wrapper`);
}
assert.match(workspaceCss, /\.legacy-street-inputs\s*\{\s*display:\s*none\s*!important/, "the wrapper can never be shown");

// Spacing: rows are equal height, and nothing sits beside a much shorter card.
assert.match(workspaceCss, /\.tab-grid\s*\{[^}]*align-items:\s*stretch/, "cards in a row stretch to the same height");
assert.match(panelHtml("ranges"), /class="ws-card span-2">\s*<div class="ws-card-head"><span>Range evolution/, "range evolution stays a two-column card so the action-bucket matrix can sit beside it");
assert.match(panelHtml("ranges"), /class="ws-card">\s*<div class="ws-card-head"><span>Action buckets/, "the action-bucket matrix is a narrow column next to range evolution, not a full-width row");
assert.match(workspaceCss, /max-width:\s*1050px\)\s*\{[^}]*\.stat-card,[^}]*\.three-up > \.ai-card:last-child\s*\{\s*grid-column:\s*1 \/ -1/, "in the two-column layout an odd card spans the row instead of leaving half of it empty");
assert.match(workspaceCss, /\.calculation-log\s*\{[^}]*columns:\s*2/, "the calculation trail uses two balanced columns");
assert.match(workspaceCss, /\.equity-buckets \.combo-buckets\s*\{[^}]*repeat\(3/, "the three hand groups sit side by side");

assert.ok(
  html.indexOf("providerAttribution.js") < html.indexOf("app.js"),
  "provider attribution helper must load before app.js",
);
assert.doesNotMatch(app, /Gemini reasoning/, "main reasoning UI copy must be provider-neutral");
assert.doesNotMatch(
  app,
  /This section uses Gemini/,
  "Harrington failure copy must be provider-neutral",
);

console.log("results layout regression checks passed");
