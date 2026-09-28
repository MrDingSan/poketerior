const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/import-engine/structured-tall-v1.json"), "utf8"));
const sandbox = { setTimeout, clearTimeout };
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const file of [
  "importProgressModel.js",
  "import-engine/types.js",
  "import-engine/legacyAdapter.js",
  "import-engine/adapters/registry.js",
  "import-engine/vision/regions.js",
  "import-engine/adapters/natural8.js",
  "import-engine/parsing/actions.js",
  "preflopBuilderModel.js",
  "postflopBuilderModel.js",
  "importBuilderAdapter.js",
  "importDecisionModel.js",
  "import-engine/validation/validator.js",
  "import-engine/fallback/client.js",
  "import-engine/dispatch.js",
  "import-engine/engine.js",
]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../public", file), "utf8"), sandbox, { filename: file });

const plain = (value) => JSON.parse(JSON.stringify(value));
const decisions = sandbox.PokerCoachImportDecisionModel;
const regionsApi = sandbox.PokerCoachImportRegions;
const natural8 = sandbox.PokerCoachNatural8Adapter;
const registry = sandbox.PokerCoachImportAdapters.createRegistry([natural8]);
const SOURCE = { width: manifest.width, height: manifest.height };

// Row source regions come from the real adapter geometry: the street column split evenly into its rows.
const layout = natural8.regions(SOURCE).normalized;
function rowRegion(street, index, count) {
  const column = layout.streets[street];
  const height = column.height / Math.max(count, 8);
  return { x: column.x, y: column.y + index * height, width: column.width, height };
}

function streetOutput(street, mutate) {
  const source = manifest.expected.rows[street];
  const rows = source.map(([text, actorName, position], index) => ({ text, actorName, position, confidence: 0.95, sourceRegion: rowRegion(street, index, source.length) }));
  if (mutate) mutate(rows);
  return { street, rows, confidence: 0.95, rawText: rows.map((row) => row.text).join("\n"), potBb: manifest.expected.pots[street] };
}

function recognizers(mutations = {}) {
  const { hero, board } = manifest.expected;
  const make = (street) => async () => streetOutput(street, mutations[street]);
  return {
    heroCards: async () => ({ cards: hero.cards, confidence: 0.97, heroName: hero.name, heroPosition: hero.position, sourceRegion: layout.heroCards }),
    board: async () => ({ flop: board.flop, turn: board.turn, river: board.river, confidence: 0.96, sourceRegion: layout.board }),
    streets: { preflop: make("preflop"), flop: make("flop"), turn: make("turn"), river: make("river") },
  };
}

function buildEngine(recognizerSet) {
  const posted = [];
  const client = sandbox.PokerCoachImportFallback.createClient({
    source: SOURCE,
    regions: { pixelRect: regionsApi.pixelRect, crop: (source, rect, options) => ({ rect, options }) },
    encodeCrop: () => ({ base64: "QUJD", mimeType: "image/png" }),
    postJson: async (url, body) => {
      posted.push({ url, body });
      return { ok: true, purpose: body.purpose, value: 21.6, confidence: 0.92, provider: "gemini", model: "test" };
    },
  });
  const engine = sandbox.PokerCoachImportEngineV2.create({
    registry,
    recognizers: recognizerSet,
    fallback: client,
    discoverDecisions: (converted) => decisions.selectableDecisionKeys(converted),
  });
  return { engine, posted };
}

async function testManifestDescribesLayoutGeometryNotBrandTruth() {
  assert.equal(manifest.siteEvidence, "layout-only");
  assert.match(manifest.siteEvidenceNote, /not Natural8 ground truth/i);
  assert.equal(manifest.profile, natural8.profile);
  assert.deepEqual(Array.from(manifest.headings), ["Blinds (Ante)", "Pre-Flop", "Flop", "Turn", "River"]);
  const image = path.join(__dirname, "..", manifest.image);
  if (fs.existsSync(image)) {
    const meta = await require("sharp")(image).metadata();
    assert.deepEqual([meta.width, meta.height], [manifest.width, manifest.height], "manifest dimensions match the referenced screenshot");
  }
  const columns = natural8.regions(SOURCE).pixels;
  assert.equal(columns.streets.preflop.x, 256, "the profile places Pre-Flop at 20% of the width");
  assert.equal(columns.history.y, 990);
}

async function testAcceptedNatural8StyleImportUsesNoFullImageCall() {
  const { engine, posted } = buildEngine(recognizers());
  const result = await engine.import(SOURCE, { anchors: manifest.anchors });

  assert.equal(result.route, "v2");
  assert.equal(result.fullImageProviderCalls, 0);
  assert.equal(posted.length, 0, "a clean import makes no network request at all");
  assert.deepEqual(Array.from(result.hand.board.flop), ["4d", "6h", "7h"]);
  assert.equal(result.hand.board.turn, "Ad");
  assert.equal(result.hand.board.river, "5h");
  assert.deepEqual(Array.from(result.hand.hero.cards), ["Ah", "4h"]);
  assert.equal(result.hand.hero.position, "BTN");
  assert.equal(result.valid, true, JSON.stringify(plain(result.validation)));
  assert.equal(result.converted.unresolved.length, 0);
  assert.ok(decisions.selectableDecisionKeys(result.converted).length > 0);
  assert.equal(result.progress.decisions.status, "complete");
  for (const stage of ["site", "heroCards", "board", "preflop", "flop", "turn", "river", "validation", "reconstruction"]) {
    assert.equal(result.progress[stage].status, "complete", stage);
  }

  // recognition noise from the real layout is filtered rather than turned into actions
  assert.deepEqual(Array.from(result.hand.actions.preflop, (action) => action.type), ["fold", "fold", "fold", "raise", "fold", "call"], "the 10s timer bubble is dropped");
  assert.deepEqual(Array.from(result.hand.actions.river, (action) => action.type), ["check", "bet", "fold"], "the Wins row is bookkeeping");
  assert.equal(result.hand.actions.flop[1].amountBb, 2.2);
  assert.equal(result.hand.actions.flop[1].amountKind, "street-total");
  assert.equal(result.hand.actions.preflop[5].amountKind, "increment");

  // displayed pots differ from the replayed pots by rake (0.1 bb); reconciliation tolerates it
  assert.equal(result.validation.reconciledPots.flop.matched, true);
  assert.equal(result.validation.reconciledPots.turn.matched, true);
  assert.equal(result.validation.reconciledPots.turn.difference < 0, true);
  assert.equal(result.validation.reconciledPots.river.matched, true);
}

async function testExistingDecisionFlowSeesTheImportUnchanged() {
  const { engine } = buildEngine(recognizers());
  const result = await engine.import(SOURCE, { anchors: manifest.anchors });
  const keys = decisions.selectableDecisionKeys(result.converted);
  assert.ok(keys.includes("flop:1"), "Hero's flop bet is a decision node");
  const snapshot = decisions.decisionSnapshotForAction(result.converted, "flop:1");
  assert.ok(snapshot, "the state-before-action snapshot is reconstructed by the existing decision model");
  // state-before-action: at the flop bet the pot is the flop starting pot, before the bet is added
  assert.equal(result.converted.streetPotsBb.flop, 6.5);
  assert.equal(result.legacy.streets.flop.actions[1].action, "bet");
  assert.equal(result.legacy.heroName, "Hero");
}

async function testUnresolvedRiverAmountUsesExactlyOneTargetedCropAndNoWholeImageCall() {
  const { engine, posted } = buildEngine(recognizers({ river: (rows) => { rows[1].text = "Bet O.B BB"; } }));
  const result = await engine.import(SOURCE, { anchors: manifest.anchors });

  assert.equal(result.route, "v2");
  assert.equal(result.fullImageProviderCalls, 0);
  assert.equal(posted.length, 1, "exactly one targeted request");
  assert.equal(posted[0].url, "/api/import/v2/resolve", "never the whole-image endpoint");
  assert.notEqual(posted[0].url, "/api/import/screenshot");
  assert.equal(posted[0].body.purpose, "action-amount");
  assert.deepEqual(Object.keys(posted[0].body).sort(), ["context", "cropBase64", "importId", "mimeType", "purpose"]);
  assert.equal(posted[0].body.context.street, "river");
  assert.equal(result.hand.actions.river[1].amountBb, 21.6);
  assert.equal(result.valid, true);
  assert.equal(result.fallbackCalls.length, 1);
  assert.equal(result.progress.validation.status, "complete");
  assert.equal(result.converted.unresolved.length, 0);
}

async function testUnresolvedAmountWithoutAnAnswerStaysCorrectableAndPartial() {
  const recognizerSet = recognizers({ river: (rows) => { rows[1].text = "Bet O.B BB"; } });
  const engine = sandbox.PokerCoachImportEngineV2.create({ registry, recognizers: recognizerSet, fallback: null, discoverDecisions: (converted) => decisions.selectableDecisionKeys(converted) });
  const result = await engine.import(SOURCE, { anchors: manifest.anchors });
  assert.equal(result.valid, false);
  assert.equal(result.hand.actions.river[1].amountBb, null);
  assert.equal(result.hand.actions.flop.length, 3, "unrelated valid fields are kept");
  assert.ok(Array.from(result.progress.validation.fieldRefs).includes("actions.river.1.amountBb"));
  const river = decisions.selectableDecisionKeys(result.converted).filter((key) => key.startsWith("river:"));
  assert.ok(!river.includes("river:2"), "the decision after the unreadable amount waits for the correction");
  assert.ok(decisions.selectableDecisionKeys(result.converted).includes("flop:1"), "earlier decisions stay usable");
}

async function testAnOtherwiseSimilarLayoutIsRoutedToTheLegacyImporter() {
  const { engine } = buildEngine(recognizers());
  const result = await engine.import(SOURCE, { anchors: { tallAspect: true, historyBoundary: true, fiveColumns: true } });
  assert.equal(result.route, "legacy", "without street-heading evidence the adapter refuses to claim the site");
  assert.equal(sandbox.PokerCoachImportDispatch.chooseRoute({ capabilities: { importEngineV2Enabled: true, importEngineV2Sites: ["Natural8"] }, runtime: {}, detection: { supported: false, detection: result.detection } }).route, "legacy");
}

let completed = false;
process.on("exit", () => { if (!completed) { console.error("import engine v2 end-to-end tests did not complete"); process.exitCode = 1; } });
(async () => {
  await testManifestDescribesLayoutGeometryNotBrandTruth();
  await testAcceptedNatural8StyleImportUsesNoFullImageCall();
  await testExistingDecisionFlowSeesTheImportUnchanged();
  await testUnresolvedRiverAmountUsesExactlyOneTargetedCropAndNoWholeImageCall();
  await testUnresolvedAmountWithoutAnAnswerStaysCorrectableAndPartial();
  await testAnOtherwiseSimilarLayoutIsRoutedToTheLegacyImporter();
  completed = true;
  console.log("import engine v2 end-to-end tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
