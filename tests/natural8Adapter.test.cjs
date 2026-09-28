const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const file of ["types.js", "adapters/registry.js", "vision/regions.js", "adapters/natural8.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/import-engine", file), "utf8"), sandbox, { filename: file });
}
const natural8 = sandbox.PokerCoachNatural8Adapter;
const regionsApi = sandbox.PokerCoachImportRegions;
const adapters = sandbox.PokerCoachImportAdapters;
const plain = (value) => JSON.parse(JSON.stringify(value));
assert.ok(natural8, "PokerCoachNatural8Adapter must be attached");

const allAnchors = { tallAspect: true, historyBoundary: true, fiveColumns: true, streetHeadings: true, tableCards: true };

function testAdapterIdentity() {
  assert.equal(natural8.id, "natural8");
  assert.equal(natural8.site, "Natural8");
  assert.equal(typeof natural8.version, "string");
  assert.equal(natural8.profile, "classic-tall-v1");
}

function testDetectionScoresExplicitEvidence() {
  const full = natural8.detect({ width: 1280, height: 2022, anchors: allAnchors });
  assert.equal(Math.round(full.score * 100), 100);
  assert.equal(full.profile, "classic-tall-v1");
  assert.equal(full.site, "Natural8");
  assert.deepEqual(Array.from(full.evidence).sort(), Object.keys(allAnchors).sort());

  const noHeadings = natural8.detect({ width: 1280, height: 2022, anchors: { ...allAnchors, streetHeadings: false } });
  assert.equal(Math.round(noHeadings.score * 100), 70);
  assert.equal(noHeadings.site, null, "site is only reported when street headings match");
  assert.ok(!noHeadings.evidence.includes("streetHeadings"));

  const headingsOnly = natural8.detect({ width: 1280, height: 2022, anchors: { streetHeadings: true } });
  assert.equal(headingsOnly.site, null, "a low-scoring profile match never names the site");
  assert.ok(headingsOnly.score < adapters.SUPPORTED_SCORE_THRESHOLD);
}

function testTallAspectIsDerivedFromDimensionsWhenNotProvided() {
  const derived = natural8.detect({ width: 1280, height: 2022, anchors: {} });
  assert.ok(derived.evidence.includes("tallAspect"));
  const landscape = natural8.detect({ width: 1920, height: 1080, anchors: {} });
  assert.equal(landscape.score, 0);
  const explicit = natural8.detect({ width: 1920, height: 1080, anchors: { tallAspect: true } });
  assert.ok(explicit.evidence.includes("tallAspect"));
}

function testRegistryIntegrationUsesThreshold() {
  const registry = adapters.createRegistry([natural8]);
  assert.equal(registry.detect({ width: 1280, height: 2022, anchors: allAnchors }).supported, true);
  assert.equal(registry.detect({ width: 1280, height: 2022, anchors: { tallAspect: true } }).supported, false);
}

function testRegionProfileMatchesMeasuredLayout() {
  const layout = natural8.regions({ width: 1280, height: 2022 });
  const normalized = plain(layout.normalized);
  for (const name of ["metadata", "heroCards", "board", "history", "blinds"]) assert.ok(normalized[name], `${name} region`);
  assert.equal(normalized.boardCards.length, 5);
  assert.equal(normalized.heroCardSlots.length, 2);
  assert.deepEqual(Object.keys(normalized.streets), ["preflop", "flop", "turn", "river"]);
  // Layout facts measured from the 1280x2022 structured tall fixture: history panel starts at ~49% height,
  // the board sits in the table's vertical centre and hero cards are below it.
  assert.ok(normalized.history.y > 0.45 && normalized.history.y < 0.55);
  assert.ok(normalized.board.y < normalized.heroCards.y);
  assert.ok(normalized.heroCards.y + normalized.heroCards.height < normalized.history.y);
  assert.ok(normalized.metadata.y === 0 && normalized.metadata.height < 0.06);
}

function inBounds(rect, width, height) {
  return rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 && rect.x + rect.width <= width && rect.y + rect.height <= height;
}

function testEveryRegionStaysInsideTheImageAtMultipleScales() {
  for (const [width, height] of [[1280, 2022], [640, 1011], [1179, 1863]]) {
    const layout = natural8.regions({ width, height });
    const flat = [layout.pixels.metadata, layout.pixels.heroCards, layout.pixels.board, layout.pixels.history, layout.pixels.blinds,
      ...Object.values(layout.pixels.streets), ...layout.pixels.boardCards, ...layout.pixels.heroCardSlots];
    for (const rect of flat) assert.ok(inBounds(rect, width, height), `${JSON.stringify(plain(rect))} in ${width}x${height}`);
  }
}

function testStreetColumnsAreOrderedAndNonOverlapping() {
  const { pixels } = natural8.regions({ width: 1280, height: 2022 });
  const order = [pixels.blinds, pixels.streets.preflop, pixels.streets.flop, pixels.streets.turn, pixels.streets.river];
  for (let index = 1; index < order.length; index += 1) {
    assert.ok(order[index].x >= order[index - 1].x + order[index - 1].width, `column ${index} starts after column ${index - 1}`);
  }
  assert.ok(pixels.streets.river.x + pixels.streets.river.width <= 1280);
  assert.ok(pixels.streets.preflop.y >= pixels.history.y);
  const boardCards = plain(pixels.boardCards);
  for (let index = 1; index < boardCards.length; index += 1) {
    assert.ok(boardCards[index].x >= boardCards[index - 1].x + boardCards[index - 1].width - 2, "board cards do not overlap materially");
  }
}

function testScaledLayoutMatchesFullResolutionProportionally() {
  const large = natural8.regions({ width: 1280, height: 2022 }).pixels;
  const small = natural8.regions({ width: 640, height: 1011 }).pixels;
  assert.ok(Math.abs(large.board.x / 2 - small.board.x) <= 1);
  assert.ok(Math.abs(large.streets.flop.width / 2 - small.streets.flop.width) <= 1);
  assert.ok(regionsApi.pixelRect, "regions api shared with adapter");
}

testAdapterIdentity();
testDetectionScoresExplicitEvidence();
testTallAspectIsDerivedFromDimensionsWhenNotProvided();
testRegistryIntegrationUsesThreshold();
testRegionProfileMatchesMeasuredLayout();
testEveryRegionStaysInsideTheImageAtMultipleScales();
testStreetColumnsAreOrderedAndNonOverlapping();
testScaledLayoutMatchesFullResolutionProportionally();
console.log("natural8 adapter tests passed");
