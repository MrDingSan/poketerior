const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function load(...files) {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, "../public/import-engine", file), "utf8");
    vm.runInContext(source, sandbox, { filename: file });
  }
  return sandbox;
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const sandbox = load("types.js", "legacyAdapter.js");
const types = sandbox.PokerCoachImportTypes;
const legacyAdapter = sandbox.PokerCoachLegacyImportAdapter;
assert.ok(types, "PokerCoachImportTypes must be attached");
assert.ok(legacyAdapter, "PokerCoachLegacyImportAdapter must be attached");

function testNormalizesCanonicalHand() {
  const input = {
    source: { kind: "screenshot", site: "Natural8", adapterId: "natural8", adapterVersion: "1" },
    hero: { playerId: "hero", name: "Hero", position: "BB", cards: ["Ah", "4d"] },
    players: [{ id: "hero", name: "Hero", position: "BB", isHero: true }],
    board: { flop: ["6h", "7s", "8c"], turn: null, river: null },
    actions: { preflop: [{ actorId: "hero", type: "call", amountBb: 2, amountKind: "increment" }] },
  };
  const before = JSON.stringify(input);
  const parsed = types.normalizeParsedHand(input);

  assert.equal(parsed.actions.preflop[0].id, "preflop:0");
  assert.equal(parsed.actions.preflop[0].amountKind, "increment");
  assert.deepEqual(plain(parsed.actions.flop), []);
  assert.deepEqual(plain(parsed.actions.turn), []);
  assert.deepEqual(plain(parsed.actions.river), []);
  assert.equal(parsed.confidence.level, "low");
  assert.notEqual(parsed.players, input.players);
  assert.notEqual(parsed.board.flop, input.board.flop);
  assert.equal(JSON.stringify(input), before, "normalization must not mutate its input");
  assert.equal(parsed.source.adapterId, "natural8");
  assert.equal(parsed.hero.position, "BB");
}

function testNormalizesCardsAndRejectsBadInput() {
  const parsed = types.normalizeParsedHand({
    hero: { cards: ["10h", "aS"] },
    board: { flop: ["10d", "2c", "Kd"], turn: "9h", river: null },
  });
  assert.deepEqual(Array.from(parsed.hero.cards), ["Th", "As"]);
  assert.deepEqual(Array.from(parsed.board.flop), ["Td", "2c", "Kd"]);
  assert.equal(parsed.board.turn, "9h");

  assert.throws(() => types.normalizeParsedHand({ hero: { cards: ["1x"] } }), /card/i);
  assert.throws(
    () => types.normalizeParsedHand({ actions: { flop: [{ type: "shrug" }] } }),
    /Unsupported import action shrug/,
  );
  assert.throws(() => types.normalizeParsedHand({ actions: { flop: [{}] } }), /Unsupported import action empty/);
  assert.throws(
    () => types.normalizeParsedHand({ actions: { flop: [{ type: "bet", amountBb: -1 }] } }),
    /amount/i,
  );
}

function testPreservesActionEvidenceAndExplicitIds() {
  const region = { x: 0.1, y: 0.2, width: 0.3, height: 0.05 };
  const parsed = types.normalizeParsedHand({
    actions: {
      turn: [
        { id: "custom", type: "RAISE", actorName: "Villain", position: "btn", amountBb: "6.5", amountKind: "street-total", rawText: "Raise 6.5BB", sourceRegion: region },
        { type: "fold", actor: "Hero", amountKind: "nonsense" },
      ],
    },
  });
  const [raise, fold] = parsed.actions.turn;
  assert.equal(raise.id, "custom");
  assert.equal(raise.type, "raise");
  assert.equal(raise.position, "BTN");
  assert.equal(raise.amountBb, 6.5);
  assert.equal(raise.rawText, "Raise 6.5BB");
  assert.deepEqual(plain(raise.sourceRegion), region);
  assert.equal(fold.id, "turn:1");
  assert.equal(fold.actorName, "Hero");
  assert.equal(fold.amountKind, "unknown");
  assert.equal(fold.amountBb, null);
}

function testConfidenceLevelsUseGlobalThresholds() {
  const level = (overall) => types.normalizeParsedHand({ confidence: { overall } }).confidence.level;
  assert.equal(level(0.9), "high");
  assert.equal(level(0.899), "medium");
  assert.equal(level(0.65), "medium");
  assert.equal(level(0.649), "low");
  assert.equal(types.confidenceLevel(1), "high");
}

function testFieldRefAndConstants() {
  assert.equal(types.fieldRef(["actions", "flop", 2, "amountBb"]), "actions.flop.2.amountBb");
  assert.equal(types.fieldRef(["hero", "cards"]), "hero.cards");
  assert.equal(types.fieldRef(["board", null, "flop"]), "board.flop");
  assert.deepEqual(Array.from(types.STREETS), ["preflop", "flop", "turn", "river"]);
  for (const action of ["fold", "check", "call", "bet", "raise", "allin"]) assert.ok(types.ACTIONS.includes(action));
  for (const kind of ["increment", "street-total", "stack-total", "none", "unknown"]) assert.ok(types.AMOUNT_KINDS.includes(kind));
  assert.equal(Object.isFrozen(types), true);
  assert.equal(Object.isFrozen(types.STREETS), true);
  assert.equal(Object.isFrozen(types.ACTIONS), true);
}

const legacyHand = {
  handId: "import-1",
  site: "Natural8",
  heroName: "Hero",
  heroHand: ["Ah", "Kh"],
  players: [
    { name: "Opener", position: "UTG", stackBb: 100, isHero: false },
    { name: "Hero", position: "SB", stackBb: 100, isHero: true },
    { name: "BB", position: "BB", stackBb: 98.5, isHero: false },
  ],
  board: { flop: ["Qh", "7s", "4h"], turn: "Jc", river: null },
  streets: {
    preflop: { potBb: 1.5, actions: [
      { actor: "Opener", position: "UTG", action: "raise", amountBb: 2.5 },
      { actor: "Hero", position: "SB", action: "call", amountBb: 2.5 },
      { actor: "BB", position: "BB", action: "fold", amountBb: null },
    ] },
    flop: { potBb: 6, actions: [
      { actor: "Hero", position: "SB", action: "check", amountBb: null },
      { actor: "Opener", position: "UTG", action: "bet", amountBb: 4 },
    ] },
    turn: { potBb: null, actions: [] },
    river: { potBb: null, actions: [] },
  },
  validationWarnings: ["River amount was low confidence."],
  confidenceNotes: ["hero cards clear"],
  actionAttribution: { safe: true, issues: [] },
};

function testLegacyRoundTripPreservesEveryConsumedField() {
  const snapshot = JSON.stringify(legacyHand);
  const parsed = legacyAdapter.fromLegacy(legacyHand, { site: "Natural8", adapterId: "legacy-vision", importId: "imp_1" });
  assert.equal(JSON.stringify(legacyHand), snapshot, "fromLegacy must not mutate its input");
  assert.equal(parsed.source.kind, "screenshot");
  assert.equal(parsed.source.importId, "imp_1");
  assert.equal(parsed.hero.name, "Hero");
  assert.equal(parsed.hero.position, "SB");
  assert.deepEqual(Array.from(parsed.hero.cards), ["Ah", "Kh"]);
  assert.equal(parsed.actions.preflop[1].id, "preflop:1");
  assert.equal(parsed.actions.preflop[1].actorId, parsed.players[1].id);
  assert.equal(parsed.streetPots.flop, 6);
  assert.equal(parsed.warnings[0].message, "River amount was low confidence.");

  const legacy = legacyAdapter.toLegacy(parsed);
  assert.deepEqual(JSON.parse(JSON.stringify(legacy)), legacyHand);
}

function testToLegacyProjectsFieldsConsumedByImportBuilderAdapter() {
  const parsed = types.normalizeParsedHand({
    source: { kind: "screenshot", site: "Natural8", adapterId: "natural8", adapterVersion: "1" },
    hero: { playerId: "p1", name: "Hero", position: "BB", cards: ["Ah", "4d"] },
    players: [
      { id: "p0", name: "Villain", position: "BTN", startingStackBb: 100 },
      { id: "p1", name: "Hero", position: "BB", startingStackBb: 97, isHero: true },
    ],
    board: { flop: ["6h", "7s", "8c"] },
    actions: {
      preflop: [{ actorId: "p0", type: "raise", amountBb: 2.2, amountKind: "street-total", position: "BTN" }],
      flop: [{ actorId: "p1", type: "check" }],
    },
    streetPots: { flop: 4.4 },
    warnings: [{ code: "pot-mismatch", severity: "warning", field: "streetPots.flop", message: "Pot differs.", correctable: true }],
  });
  const legacy = legacyAdapter.toLegacy(parsed);
  assert.equal(legacy.heroName, "Hero");
  assert.deepEqual(plain(legacy.heroHand), ["Ah", "4d"]);
  assert.deepEqual(plain(legacy.players).map((player) => [player.name, player.position, player.stackBb, player.isHero]), [
    ["Villain", "BTN", 100, false],
    ["Hero", "BB", 97, true],
  ]);
  assert.deepEqual(plain(legacy.board), { flop: ["6h", "7s", "8c"], turn: null, river: null });
  assert.deepEqual(plain(legacy.streets.preflop.actions[0]), { actor: "Villain", position: "BTN", action: "raise", amountBb: 2.2 });
  assert.equal(legacy.streets.flop.actions[0].actor, "Hero");
  assert.equal(legacy.streets.flop.potBb, 4.4);
  assert.deepEqual(plain(legacy.streets.turn.actions), []);
  assert.deepEqual(plain(legacy.validationWarnings), ["Pot differs."]);
}

function testUnknownStacksAreOmittedSoTheBuilderAdapterUsesItsDefaultStack() {
  const parsed = types.normalizeParsedHand({
    players: [{ id: "a", name: "A", position: "BTN" }, { id: "b", name: "B", position: "BB", startingStackBb: 42 }],
  });
  const legacy = plain(legacyAdapter.toLegacy(parsed));
  assert.equal("stackBb" in legacy.players[0], false, "null would be read as a 0bb stack by the builder adapter");
  assert.equal(legacy.players[1].stackBb, 42);
}

function testDropsUnreadableLegacyCardsWithoutThrowing() {
  const parsed = legacyAdapter.fromLegacy({ ...legacyHand, heroHand: ["Ah", "??"] });
  assert.deepEqual(Array.from(parsed.hero.cards), ["Ah"]);
  assert.ok(parsed.warnings.some((warning) => warning.field === "hero.cards"));
}

testNormalizesCanonicalHand();
testNormalizesCardsAndRejectsBadInput();
testPreservesActionEvidenceAndExplicitIds();
testConfidenceLevelsUseGlobalThresholds();
testFieldRefAndConstants();
testLegacyRoundTripPreservesEveryConsumedField();
testToLegacyProjectsFieldsConsumedByImportBuilderAdapter();
testUnknownStacksAreOmittedSoTheBuilderAdapterUsesItsDefaultStack();
testDropsUnreadableLegacyCardsWithoutThrowing();
console.log("import engine canonical contract tests passed");
