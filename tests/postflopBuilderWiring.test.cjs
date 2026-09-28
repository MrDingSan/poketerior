const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("public/index.html", "utf8");
const css = fs.readFileSync("public/styles.css", "utf8");
const view = fs.readFileSync("public/postflopBuilderView.js", "utf8");
const analysisView = fs.readFileSync("public/postflopAnalysisView.js", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");

assert.match(view, /Your Decision/, "the postflop action rail should use the PokeTerior decision hierarchy");

require("./apiClient.test.cjs");

function loadCompatibility() {
  const sandbox = { globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync("public/postflopCompatibility.js", "utf8"), sandbox);
  return sandbox.globalThis.PokerCoachPostflopCompatibility;
}

function loadPostflopView() {
  const sandbox = { globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync("public/postflopBuilderView.js", "utf8"), sandbox);
  return sandbox.globalThis.PokerCoachPostflopBuilderView;
}

function testPostflopHeroCardsRenderHighestRankFirst() {
  const viewModel = loadPostflopView();
  assert.deepEqual(Array.from(viewModel.orderCards(["5s", "Qd"])), ["Qd", "5s"]);
}

function testLegacyPostflopActionsPreserveBetForAnalysis() {
  const compatibility = loadCompatibility();
  const row = JSON.parse(JSON.stringify(compatibility.actionRowData({
    actor: "CO",
    action: "bet",
    amount: 4.5,
  })));
  assert.deepEqual(row, { actor: "CO", action: "bet", amount: 4.5 });
}

function testPostflopWorkspaceHasSemanticHooks() {
  for (const id of [
    "postflopBuilder",
    "streetNavigator",
    "postflopTable",
    "boardCardSlots",
    "postflopNextAction",
    "postflopTimeline",
    "postflopCardDialog",
    "postflopAnalysis",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), `Missing #${id}`);
  }
  assert.match(html, /<dialog[^>]+id="postflopCardDialog"/);
}

function testScriptsLoadInDependencyOrder() {
  assert.ok(html.includes("apiClient.js"), "Missing apiClient.js");
  assert.ok(html.indexOf("apiClient.js") < html.indexOf("app.js"));
  assert.ok(html.includes("postflopCompatibility.js"), "Missing postflopCompatibility.js");
  assert.ok(html.indexOf("postflopCompatibility.js") < html.indexOf("app.js"));
  for (const script of ["postflopBuilderModel.js", "rangeMatrixView.js", "postflopAnalysisView.js", "postflopBuilderView.js"]) {
    assert.ok(html.includes(script), `Missing ${script}`);
  }
  assert.ok(html.indexOf("postflopBuilderModel.js") < html.indexOf("postflopBuilderView.js"));
  assert.ok(html.indexOf("rangeMatrixView.js") < html.indexOf("postflopAnalysisView.js"));
  assert.ok(html.indexOf("postflopAnalysisView.js") < html.indexOf("postflopBuilderView.js"));
  assert.ok(html.indexOf("postflopBuilderView.js") < html.indexOf("app.js"));
}

function testPostflopVisualContractsExist() {
  for (const selector of [
    ".postflop-layout",
    ".street-navigator",
    ".postflop-main",
    ".postflop-table-workspace",
    ".board-card-slot",
    ".postflop-builder.is-active",
  ]) {
    assert.ok(css.includes(selector), `Missing CSS contract: ${selector}`);
  }
}

testPostflopWorkspaceHasSemanticHooks();
testScriptsLoadInDependencyOrder();
testPostflopVisualContractsExist();
testLegacyPostflopActionsPreserveBetForAnalysis();
testPostflopHeroCardsRenderHighestRankFirst();

for (const hook of [
  "data-postflop-action", "data-postflop-size", "data-postflop-edit", "data-street-target",
  "postflopCustomSize", "postflopAdvanceBtn", "postflopAnalyzeBtn",
]) assert.ok(view.includes(hook) || html.includes(hook), `Missing ${hook}`);

for (const selector of [
  ".postflop-action-call", ".postflop-action-aggressive", ".postflop-size.is-selected",
  ".street-action.is-pending", ".felt-commitment",
]) assert.ok(css.includes(selector), `Missing ${selector}`);

for (const selector of [
  ".postflop-card-picker-grid", ".timeline-street-label", ".street-action[data-action-street=\"flop\"]",
  ".street-action[data-action-street=\"turn\"]", ".street-action[data-action-street=\"river\"]",
  ".postflop-selected-cards", ".postflop-analysis-empty",
]) assert.ok(css.includes(selector), `Missing post-flop visual contract: ${selector}`);

for (const contract of ["focusTimelineOnCurrentStreet", "scrollIntoView"]) {
  assert.ok(view.includes(contract), `Missing active post-flop interaction contract: ${contract}`);
}

assert.match(html, /id="postflopSelectedCards" class="postflop-selected-cards"/);

assert.ok(analysisView.includes("postflop-analysis-empty"), "Empty analysis needs a dedicated panel state.");

for (const contract of [
  "createPostflopBuilderView", "startFromPreflop(preflopState)", "toLegacyAnalysisInput",
  '$("boardCards")', '$("turnCard")', '$("riverCard")', '`${street}PotSize`',
  '`${street}CallAmount`', '`${street}Actions`', "syncPostflopCompatibility", "analyze(trigger)",
]) assert.ok(app.includes(contract), `Missing app integration: ${contract}`);

for (const contract of ["cardAriaLabel", 'aria-live="polite"', "focus-visible", "prefers-reduced-motion", "overflow-x: auto"]) {
  assert.ok(view.includes(contract) || html.includes(contract) || css.includes(contract), `Missing accessibility/responsive contract: ${contract}`);
}
