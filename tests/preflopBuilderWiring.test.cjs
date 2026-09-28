const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("public/index.html", "utf8");
const css = fs.readFileSync("public/styles.css", "utf8");
const view = fs.readFileSync("public/preflopBuilderView.js", "utf8");

assert.match(view, /Your Decision/, "the preflop action rail should use the PokeTerior decision hierarchy");
assert.match(view, /PokerTerior/, "the analytical table watermark should use the current product name");

function testManualBuilderHasSemanticSurface() {
  for (const id of ["preflopBuilder", "preflopTable", "nextActionPanel", "preflopTimeline", "heroCardDialog"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /<dialog[^>]+id="heroCardDialog"/);
  assert.match(html, /preflopBuilderModel\.js/);
  assert.match(html, /preflopBuilderView\.js/);
  assert.ok(html.indexOf("preflopBuilderModel.js") < html.indexOf("preflopBuilderView.js"));
  assert.ok(html.indexOf("preflopBuilderView.js") < html.indexOf("app.js"));
}

function testResponsiveVisualContractsExist() {
  for (const selector of [
    ".builder-layout",
    ".poker-table",
    ".poker-seat.is-hero",
    ".table-commitment",
    ".table-pot",
    ".table-workspace { min-width: 0; }",
    ".table-workspace { grid-template-columns: minmax(0, 1fr); }",
    ".next-action-panel",
    ".card-picker-grid",
    ".preflop-timeline",
    ".timeline-action.is-pending",
    ":focus-visible",
    "@media (max-width: 1024px)",
    "@media (max-width: 720px)",
    "@media (prefers-reduced-motion: reduce)",
  ]) {
    assert.ok(css.includes(selector), `Missing CSS contract: ${selector}`);
  }
}

function testThirdCardReplacesOldestSelection() {
  const sandbox = { globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync("public/preflopBuilderView.js", "utf8"), sandbox);
  const view = sandbox.globalThis.PokerCoachPreflopBuilderView;

  assert.deepEqual(
    Array.from(view.updateCardSelection(["Ah", "Kh"], "Qd")),
    ["Kh", "Qd"],
  );
  assert.deepEqual(
    Array.from(view.updateCardSelection(["Ah", "Kh"], "Ah")),
    ["Kh"],
  );
}

function testHeroCardsRenderHighestRankFirst() {
  const sandbox = { globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync("public/preflopBuilderView.js", "utf8"), sandbox);
  const view = sandbox.globalThis.PokerCoachPreflopBuilderView;

  assert.deepEqual(Array.from(view.orderCards(["Jd", "Kh"])), ["Kh", "Jd"]);
  assert.deepEqual(Array.from(view.orderCards(["As", "Kd"])), ["As", "Kd"]);
}

function testSelectingHistoricalActionKeepsEntireDecisionPathVisible() {
  const sandbox = { globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync("public/preflopBuilderView.js", "utf8"), sandbox);
  const view = sandbox.globalThis.PokerCoachPreflopBuilderView;
  const actions = [{ type: "fold" }, { type: "raise" }, { type: "call" }];

  assert.deepEqual(
    JSON.parse(JSON.stringify(view.timelineActions({ actions }, 1))),
    actions,
  );
  assert.equal(view.actionChanged(
    { type: "raise", targetUnits: 18 },
    { type: "raise", targetUnits: 18 },
  ), false);
  assert.equal(view.actionChanged(
    { type: "raise", targetUnits: 18 },
    { type: "call", targetUnits: 5 },
  ), true);
}

testManualBuilderHasSemanticSurface();
testResponsiveVisualContractsExist();
testThirdCardReplacesOldestSelection();
testHeroCardsRenderHighestRankFirst();
testSelectingHistoricalActionKeepsEntireDecisionPathVisible();
