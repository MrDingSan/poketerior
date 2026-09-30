const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../public/styles.css"), "utf8");
const dashboardCss = fs.readFileSync(path.join(__dirname, "../public/poketerior-dashboard.css"), "utf8");

assert.match(html, /<title>PokerTerior<\/title>/, "the browser title should use the PokerTerior brand");
assert.match(html, /Posterior reasoning for better poker decisions/, "the header should explain the posterior reasoning product");
assert.match(html, /class="brand-word-poke"/, "the light half of the wordmark should be independently styled");
assert.match(html, /class="brand-word-terior"/, "the emerald half of the wordmark should be independently styled");
assert.match(html, /class="brand-spade"/, "the wordmark should include its small spade detail");
assert.match(html, /class="brand-i" aria-hidden="true"><span class="brand-spade">♠<\/span><\/span>or/, "the spade should replace the i dot over a dedicated stem");
assert.doesNotMatch(html, /class="brand-mark"/, "the header should not use a standalone casino-style mark");

for (const id of [
  "importModeBtn",
  "quickEntryModeBtn",
  "manualModeBtn",
  "preflopBuilder",
  "postflopBuilder",
  "nextActionPanel",
  "postflopNextAction",
  "preflopTimeline",
  "postflopTimeline",
  "rangeComboCount",
]) {
  assert.match(html, new RegExp(`id="${id}"`), `the refactor should preserve the ${id} behavior hook`);
}

for (const label of ["Ranges", "Equity", "AI Analysis", "Breakdown"]) {
  assert.match(html, new RegExp(`>${label}<`), `analysis navigation should include ${label}`);
}

assert.match(html, /<details[^>]*class="[^"]*developer-details[^"]*"[^>]*>/, "technical output should be collapsed in developer details");
assert.match(html, /<summary>Developer Details<\/summary>/, "the diagnostic disclosure should have a clear label");

assert.match(css, /--accent:\s*#(?:10b981|18c982|20c997|22c55e|2bd98f)/i, "the primary accent should be emerald");
assert.doesNotMatch(css, /--accent:\s*#d6b15d/i, "the mustard accent token should be removed");
assert.match(css, /\/\* PokeTerior final cascade \*\/[\s\S]*\.mode-tab\.is-active[\s\S]*rgba\(32, 201, 151/, "the final cascade should keep active navigation restrained and emerald");
assert.match(css, /\.brand-i::before\s*\{/, "the wordmark should draw a dotless i stem beneath the spade");
const importCss = fs.readFileSync(path.join(__dirname, "../public/import-screen.css"), "utf8");
assert.match(importCss, /#importSection > \.import-dropzone\s*\{[^}]*min-height:\s*340px/s, "the empty screenshot uploader should be a large, inviting dropzone");
assert.match(importCss, /\.import-dropzone-button\s*\{[^}]*background:\s*var\(--imp-ok\)/s, "the uploader should expose one clear primary file action");
assert.match(importCss, /#importSection:not\(\[data-import-state="empty"\]\) > \.import-dropzone\s*\{[^}]*min-height:\s*0/s, "the dropzone should shrink to a slim bar once a hand is loading or loaded");
assert.match(html, /data-import-state="empty"/, "the import section should start in the empty state");
assert.match(html, /class="import-help"/, "the empty state should explain how import works");
for (const selector of [".brand-word-poke", ".brand-word-terior", ".brand-spade", ".analysis-workspace"]) {
  assert.ok(css.includes(selector), `${selector} should have PokeTerior styling`);
}

assert.match(dashboardCss, /\.builder-rail,\s*\.postflop-rail\s*\{[^}]*height:\s*auto[^}]*min-height:\s*478px/s, "decision rails must expand for raise sizing controls");
assert.match(dashboardCss, /\.timeline-street-label\s*\{[^}]*align-self:\s*center/s, "timeline street markers must stay vertically aligned with action cards");

console.log("PokeTerior shell checks passed");
