const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "../public", file), "utf8");
const css = read("import-screen.css");
const html = read("index.html");
const app = read("app.js");
const progressView = read("import-engine/progressView.js");
const workspaceCss = read("analysis-workspace.css");

// Every import state the JS can set has a rule keyed off it.
const states = [...new Set([...app.matchAll(/setImportState\("(\w+)"\)/g)].map((match) => match[1]))];
assert.deepEqual(states.sort(), ["empty", "failed", "reading", "review"].filter((state) => states.includes(state)).sort());
for (const state of ["reading", "review", "failed"]) {
  assert.match(css, new RegExp(`data-import-state="${state}"`), `the ${state} state needs its own styling`);
}
assert.match(css, /data-import-state="empty"/, "the empty state needs its own styling");

// Every progress-step status the renderer can emit is styled, so no state falls back to unstyled text.
const statuses = [...progressView.matchAll(/(\w+): "(?:Pending|In progress|Complete|Needs review|Failed)"/g)].map((match) => match[1]);
assert.deepEqual(statuses.sort(), ["complete", "error", "pending", "running", "warning"]);
for (const status of statuses) assert.match(css, new RegExp(`\\.import-stage\\.is-${status}\\b`), `is-${status} steps need styling`);

// The timeline holds up to four streets, so it must grow instead of clipping.
// The rule now lives in the shared hand stage, which the import layout opts into.
assert.match(read("hand-stage.css"), /\.import-builder-timeline\s*\{[^}]*height:\s*auto[^}]*overflow:\s*visible/s, "the decision path must not clip later streets");
assert.match(read("handWorkspaceView.js"), /import-builder-layout hand-stage/, "the import layout uses the shared hand stage");
// Color identifies the player, not the street: a villain keeps one hue for the whole hand.
for (let index = 0; index < 5; index += 1) {
  assert.match(css, new RegExp(`--imp-villain-${index}:`), `villain ${index} needs a color token`);
  assert.match(css, new RegExp(`data-villain="${index}"\\]\\s*\\{[^}]*border-left-color:\\s*var\\(--imp-villain-${index}\\)`), `villain ${index} boxes use their own color`);
}
assert.doesNotMatch(css, /data-action-street/, "boxes must not change color from street to street");
assert.doesNotMatch(css, /--imp-street-/, "no per-street color tokens");
for (const street of ["preflop", "flop", "turn", "river"]) {
  assert.doesNotMatch(css, new RegExp(`data-timeline-street="${street}"\\]\\s*\\{[^}]*color:`), `${street} heading stays neutral`);
}
assert.match(css, /data-action-role="hero"/, "Hero actions are color coded");
assert.match(app, /class="is-hero"/, "the Hero player chip is marked so it can be color coded");

// The imported-hand review card is out of the normal view, but stays in the DOM and returns when it has a job.
assert.match(css, /\.import-summary\.is-collapsed\s*\{\s*display:\s*none\s*!important/, "the review card is hidden by default");
assert.match(app, /function syncImportReviewVisibility\(cardsValid\)/, "one function decides whether the review card shows");
assert.match(app, /!cardsValid \|\| importedHand\?\.actionAttribution\?\.safe === false \|\| importCardReviewRequested/, "it returns for invalid cards, unverifiable attribution, or a card-field check");
assert.match(app, /if \(target\.kind === "cards"\) \{\s*importCardReviewRequested = true;/, "a card-field check pill reveals the inputs before focusing them");
for (const id of ["importHeroHandEdit", "importFlopEdit", "importTurnEdit", "importRiverEdit", "importHeroSelect", "importCardWarning"]) {
  assert.ok(app.includes(`id="${id}"`), `${id} must stay in the DOM: corrections and validation read it`);
}

// Wiring: styles load after the dashboard cascade, and the empty analysis strip stays hidden.
assert.ok(html.indexOf("import-screen.css") > html.indexOf("poketerior-dashboard.css"), "import styles must load after the dashboard cascade");
assert.ok(html.indexOf("design-tokens.css") > html.indexOf("poketerior-dashboard.css") && html.indexOf("design-tokens.css") < html.indexOf("import-screen.css"), "shared tokens load after the legacy styles and before the components that read them");
assert.match(workspaceCss, /\.analysis-summary:has\(\.verdict-badge\[data-empty\]\)\s*\{\s*display:\s*none/, "the summary strip is hidden until the first analysis");

// WCAG AA for the pairs the legend relies on.
const tokensCss = read("design-tokens.css");
// --imp-* tokens alias the shared --pt-* palette; resolve through it to the hex value.
function token(name) {
  const value = css.match(new RegExp(`--imp-${name}:\\s*([^;]+);`))?.[1].trim();
  const alias = value?.match(/^var\(--pt-([\w-]+)\)$/)?.[1];
  if (!alias) return value;
  return tokensCss.match(new RegExp(`--pt-${alias}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
}
function luminance(hex) {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function contrast(foreground, background) {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}
const pairs = [
  ["ok-ink", "ok"], ["warn-ink", "warn"], ["bad-ink", "bad"], ["info-ink", "info"],
  ["tx", "s1"], ["tx-2", "s1"], ["tx-3", "s1"], ["tx-2", "s2"],
  ["ok", "s1"], ["warn", "s1"], ["bad", "s1"], ["info", "s1"],
];
for (const [foreground, background] of pairs) {
  const ratio = contrast(token(foreground), token(background));
  assert.ok(ratio >= 4.5, `--imp-${foreground} on --imp-${background} is ${ratio.toFixed(2)}:1, below WCAG AA`);
}

console.log("import screen styling checks passed");
