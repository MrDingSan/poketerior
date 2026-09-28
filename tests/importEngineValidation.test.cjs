const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const files = [
  "import-engine/types.js",
  "import-engine/legacyAdapter.js",
  "preflopBuilderModel.js",
  "postflopBuilderModel.js",
  "importBuilderAdapter.js",
  "import-engine/validation/validator.js",
];
for (const file of files) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public", file), "utf8"), sandbox, { filename: file });
}
const types = sandbox.PokerCoachImportTypes;
const legacy = sandbox.PokerCoachLegacyImportAdapter;
const adapter = sandbox.PokerCoachImportBuilderAdapter;
const validator = sandbox.PokerCoachImportValidator;
assert.ok(validator, "PokerCoachImportValidator must be attached");
const plain = (value) => JSON.parse(JSON.stringify(value));

function legacyHand() {
  const seats = [["Opener", "UTG"], ["HJ", "HJ"], ["CO", "CO"], ["BTN", "BTN"], ["Hero", "SB"], ["BB", "BB"]];
  const act = (actor, position, action, amountBb = null) => ({ actor, position, action, amountBb });
  return {
    handId: "import-1",
    heroName: "Hero",
    heroHand: ["Ah", "Kh"],
    players: seats.map(([name, position]) => ({ name, position, stackBb: 100, isHero: name === "Hero" })),
    board: { flop: ["Qh", "7s", "4h"], turn: "Jc", river: "2d" },
    streets: {
      preflop: { potBb: 1.5, actions: [
        act("Opener", "UTG", "raise", 2.5), act("HJ", "HJ", "fold"), act("CO", "CO", "fold"), act("BTN", "BTN", "fold"),
        act("Hero", "SB", "raise", 9), act("BB", "BB", "fold"), act("Opener", "UTG", "call", 6.5),
      ] },
      flop: { potBb: 19, actions: [act("Hero", "SB", "check"), act("Opener", "UTG", "bet", 5), act("Hero", "SB", "call", 5)] },
      turn: { potBb: 29, actions: [act("Hero", "SB", "check"), act("Opener", "UTG", "bet", 8.2), act("Hero", "SB", "call", 8.2)] },
      river: { potBb: 45.4, actions: [act("Hero", "SB", "check"), act("Opener", "UTG", "bet", 9), act("Hero", "SB", "call", 9)] },
    },
  };
}

const HIGH_FIELDS = { "hero.cards": 0.97, "board.flop": 0.95, "actions.flop.1.amountBb": 0.96 };

function canonical(mutate, fields = HIGH_FIELDS) {
  const hand = legacyHand();
  if (mutate) mutate(hand);
  const parsed = legacy.fromLegacy(hand, { site: "Natural8", adapterId: "natural8" });
  // V2 producers always know the amount convention; legacy input does not, so declare it like a real recognizer would.
  for (const street of types.STREETS) {
    for (const action of parsed.actions[street]) {
      action.amountKind = { call: "increment", bet: "street-total", raise: "street-total", allin: "stack-total" }[action.type] || "none";
    }
  }
  return types.normalizeParsedHand({ ...parsed, confidence: { overall: 0.95, fields } });
}

const codes = (issues) => Array.from(issues, (issue) => issue.code);
const issue = (issues, code) => Array.from(issues).find((entry) => entry.code === code);

function testCleanHandIsValidAndHighConfidence() {
  const parsed = canonical();
  const before = JSON.stringify(parsed);
  const result = validator.validate(parsed, { strictReplay: true });
  assert.equal(JSON.stringify(parsed), before, "validation must not mutate its input");
  assert.equal(result.valid, true);
  assert.deepEqual(plain(result.blockingIssues), []);
  assert.deepEqual(plain(result.replayIssues), []);
  assert.equal(result.confidence.level, "high");
  assert.equal(result.confidence.overall, 0.95);
  assert.equal(result.hand.validation.valid, true);
  assert.equal(result.hand.confidence.level, "high");
  assert.equal(result.reconciledPots.preflop.matched, true);
  assert.equal(result.reconciledPots.flop.matched, true);
  assert.equal(result.reconciledPots.flop.replayed, 19);
  assert.notEqual(result.hand, parsed);
}

function testCardIssues() {
  const duplicate = validator.validate(canonical((hand) => { hand.board.flop = ["Ah", "7s", "4h"]; }));
  assert.equal(duplicate.valid, false);
  assert.ok(codes(duplicate.blockingIssues).includes("duplicate-card"));
  assert.equal(issue(duplicate.blockingIssues, "duplicate-card").severity, "error");
  assert.equal(issue(duplicate.blockingIssues, "duplicate-card").correctable, true);

  const gap = validator.validate(canonical((hand) => { hand.board.turn = null; }));
  assert.ok(codes(gap.blockingIssues).includes("board-street-gap"));
  assert.equal(issue(gap.blockingIssues, "board-street-gap").field, "board.river");

  const shortFlop = validator.validate(canonical((hand) => { hand.board = { flop: ["Qh", "7s"], turn: null, river: null }; }));
  assert.ok(codes(shortFlop.blockingIssues).includes("board-flop-incomplete"));

  const noHero = validator.validate(canonical((hand) => { hand.heroHand = ["Ah"]; }));
  assert.ok(codes(noHero.blockingIssues).includes("hero-cards-incomplete"));
  assert.equal(issue(noHero.blockingIssues, "hero-cards-incomplete").field, "hero.cards");

  const orphanActions = validator.validate(canonical((hand) => { hand.board = { flop: [], turn: null, river: null }; }));
  assert.ok(codes(orphanActions.blockingIssues).includes("actions-without-board"));
}

function testActorIssues() {
  const unknown = validator.validate(canonical((hand) => { hand.streets.flop.actions[1].actor = "Ghost"; }));
  assert.equal(unknown.valid, false);
  assert.equal(issue(unknown.blockingIssues, "unknown-actor").field, "actions.flop.1");

  const missing = validator.validate(canonical((hand) => { hand.streets.flop.actions[1].actor = null; }));
  assert.ok(codes(missing.blockingIssues).includes("missing-actor"), "an unattributed action is never defaulted to Hero");

  const afterFold = validator.validate(canonical((hand) => {
    hand.streets.flop.actions = [{ actor: "BB", position: "BB", action: "check", amountBb: null }, ...hand.streets.flop.actions];
  }));
  assert.equal(issue(afterFold.blockingIssues, "action-after-fold").field, "actions.flop.0");

  const selfResponse = validator.validate(canonical((hand) => {
    hand.streets.flop.actions = [
      { actor: "Hero", position: "SB", action: "check", amountBb: null },
      { actor: "Hero", position: "SB", action: "call", amountBb: 5 },
    ];
  }));
  assert.equal(issue(selfResponse.blockingIssues, "self-response").field, "actions.flop.1");
}

function testReplayIssuesComeFromTheBuilderEngines() {
  const illegalCheck = validator.validate(canonical((hand) => {
    hand.streets.flop.actions = [
      { actor: "Hero", position: "SB", action: "check", amountBb: null },
      { actor: "Opener", position: "UTG", action: "bet", amountBb: 5 },
      { actor: "Hero", position: "SB", action: "check", amountBb: null },
    ];
  }));
  assert.equal(illegalCheck.valid, false);
  const check = issue(illegalCheck.replayIssues, "illegal-check");
  assert.ok(check, "the engine's 'Cannot check while facing a wager' becomes a structured issue");
  assert.equal(check.field, "actions.flop.2");
  assert.equal(check.severity, "error");

  const undersized = validator.validate(canonical((hand) => {
    hand.streets.flop.actions[2].amountBb = 3;
  }));
  const call = issue(undersized.replayIssues, "undersized-call");
  assert.ok(call);
  assert.equal(call.field, "actions.flop.2.amountBb");
  assert.equal(call.correctable, true);
  assert.equal(undersized.valid, false);

  const withinRounding = validator.validate(canonical((hand) => { hand.streets.flop.actions[2].amountBb = 4.96; }));
  assert.ok(!codes(withinRounding.replayIssues).includes("undersized-call"), "0.04bb OCR rounding is tolerated");
}

function testOversizedCallIsRejectedToo() {
  const result = validator.validate(canonical((hand) => { hand.streets.flop.actions[2].amountBb = 6; }));
  const call = issue(result.replayIssues, "oversized-call");
  assert.ok(call, "a call larger than the wager it answers cannot be right");
  assert.equal(call.field, "actions.flop.2.amountBb");
  assert.equal(call.severity, "error");
  assert.equal(result.valid, false);
  const roundingOnly = validator.validate(canonical((hand) => { hand.streets.flop.actions[2].amountBb = 5.04; }));
  assert.ok(!codes(roundingOnly.replayIssues).includes("oversized-call"), "0.04bb OCR rounding is tolerated");
}

function testMissingAggressiveAmountIsReportedOnTheAmountField() {
  const result = validator.validate(canonical((hand) => { hand.streets.flop.actions[1].amountBb = null; }));
  const missing = issue(result.replayIssues, "missing-amount");
  assert.ok(missing, "the adapter's 'needs an amount' becomes a structured issue");
  assert.equal(missing.field, "actions.flop.1.amountBb");
  assert.equal(missing.correctable, true);
  assert.equal(result.valid, false);
}

function testUnknownAmountConventionsAreNotGuessed() {
  const parsed = canonical((hand) => { hand.streets.flop.actions[2].amountBb = 3; });
  for (const action of parsed.actions.flop) action.amountKind = "unknown";
  assert.ok(!codes(validator.validate(parsed).replayIssues).includes("undersized-call"));
}

function testPotToleranceBoundaries() {
  assert.equal(validator.potTolerance(5), 0.2, "0.2bb floor for small pots");
  assert.equal(validator.potTolerance(1.5), 0.2);
  assert.equal(validator.potTolerance(100), 2, "2% of the displayed pot for large pots");
  assert.equal(validator.potTolerance(20), 0.4);

  const atFloor = validator.validate(canonical((hand) => { hand.streets.preflop.potBb = 1.7; }));
  assert.equal(atFloor.reconciledPots.preflop.matched, true, "exactly 0.2bb is within tolerance");
  const justOver = validator.validate(canonical((hand) => { hand.streets.preflop.potBb = 1.71; }));
  assert.equal(justOver.reconciledPots.preflop.matched, false);

  const percent = validator.validate(canonical((hand) => { hand.streets.flop.potBb = 19.38; }));
  assert.equal(percent.reconciledPots.flop.matched, true, "0.38 <= 2% of 19.38");
  const outside = validator.validate(canonical((hand) => { hand.streets.flop.potBb = 19.5; }));
  assert.equal(outside.reconciledPots.flop.matched, false);
}

function testPotMismatchIsRecoverableNotBlocking() {
  const result = validator.validate(canonical((hand) => { hand.streets.flop.potBb = 25; }));
  const mismatch = issue(result.replayIssues, "pot-mismatch");
  assert.ok(mismatch);
  assert.equal(mismatch.severity, "warning");
  assert.equal(mismatch.correctable, true);
  assert.equal(mismatch.field, "streetPots.flop");
  assert.equal(result.valid, true, "pot labels can reflect rake/returns, so a mismatch alone does not invalidate the hand");
  assert.equal(result.confidence.level, "medium");
  assert.ok(result.confidence.overall <= 0.89);
  assert.equal(result.reconciledPots.flop.recognized, 25);
  assert.equal(result.reconciledPots.flop.replayed, 19);
  assert.ok(result.hand.warnings.some((warning) => warning.code === "pot-mismatch"), "issues are recorded on the returned hand");
}

function testConfidenceAggregationUsesTheWeakestRequiredField() {
  const weak = validator.validate(canonical(null, { "hero.cards": 0.97, "actions.flop.1.amountBb": 0.7 }));
  assert.equal(weak.confidence.overall, 0.7);
  assert.equal(weak.confidence.level, "medium");
  const blocking = validator.validate(canonical((hand) => { hand.board.flop = ["Ah", "7s", "4h"]; }));
  assert.ok(blocking.confidence.overall <= 0.64);
  assert.equal(blocking.confidence.level, "low");
  const unscored = validator.validate(types.normalizeParsedHand({ ...canonical(), confidence: { overall: 0 } }));
  assert.equal(unscored.confidence.level, "low", "no field confidence means no basis for trust");
}

function testStrictReplayDoesNotHideAMissingMiddleActor() {
  const hand = legacyHand();
  hand.streets.preflop.actions = [
    { actor: "Opener", position: "UTG", action: "raise", amountBb: 2.5 },
    // HJ and CO rows are missing
    { actor: "BTN", position: "BTN", action: "fold", amountBb: null },
    { actor: "Hero", position: "SB", action: "raise", amountBb: 9 },
    { actor: "BB", position: "BB", action: "fold", amountBb: null },
    { actor: "Opener", position: "UTG", action: "call", amountBb: 6.5 },
  ];
  const strict = adapter.fromImportedHand(hand, { heroName: "Hero", strict: true });
  assert.equal(strict.unresolved[0].key, "preflop:1");
  assert.match(strict.unresolved[0].message, /next to act/i);
  assert.equal(strict.preflopState.actions.some((action) => action.automatic), false);

  const lenient = adapter.fromImportedHand(hand, { heroName: "Hero" });
  assert.equal(lenient.unresolved.length, 0, "non-strict behaviour is unchanged");
  assert.equal(lenient.preflopState.actions.filter((action) => action.automatic).length >= 2, true);

  const result = validator.validate(canonical((mutable) => { mutable.streets.preflop.actions = hand.streets.preflop.actions; }), { strictReplay: true });
  const missing = issue(result.replayIssues, "missing-prior-action");
  assert.ok(missing);
  assert.equal(missing.field, "actions.preflop.1");
  assert.equal(result.valid, false);
  assert.equal(missing.correctable, true);
}

function testUnknownStacksAreNotReadAsZeroBigBlinds() {
  // The app's normalizeImportedHand turns a missing stack into null; Number(null) is 0, which would zero every seat.
  for (const unknown of [null, undefined]) {
    const hand = legacyHand();
    for (const player of hand.players) player.stackBb = unknown;
    const converted = adapter.fromImportedHand(hand, { heroName: "Hero" });
    assert.deepEqual(plain(converted.unresolved), [], `stackBb ${unknown} must fall back to the default stack`);
    assert.equal(converted.streetPotsBb.flop, 19);
  }
  const mixed = legacyHand();
  mixed.players[0].stackBb = null;
  assert.deepEqual(plain(adapter.fromImportedHand(mixed, { heroName: "Hero" }).unresolved), []);
  const short = legacyHand();
  short.players.find((player) => player.position === "UTG").stackBb = 0;
  assert.ok(adapter.fromImportedHand(short, { heroName: "Hero" }).unresolved.length > 0, "an explicit 0bb stack is still honoured");
}

function testReplayPotsAreExposedByTheAdapter() {
  const converted = adapter.fromImportedHand(legacyHand(), { heroName: "Hero", strict: true });
  assert.equal(converted.streetPotsBb.preflop, 1.5);
  assert.equal(converted.streetPotsBb.flop, 19);
  assert.equal(converted.streetPotsBb.turn, 29);
  assert.equal(converted.streetPotsBb.river, 45.4);
}

testCleanHandIsValidAndHighConfidence();
testCardIssues();
testActorIssues();
testReplayIssuesComeFromTheBuilderEngines();
testOversizedCallIsRejectedToo();
testMissingAggressiveAmountIsReportedOnTheAmountField();
testUnknownAmountConventionsAreNotGuessed();
testPotToleranceBoundaries();
testPotMismatchIsRecoverableNotBlocking();
testConfidenceAggregationUsesTheWeakestRequiredField();
testStrictReplayDoesNotHideAMissingMiddleActor();
testUnknownStacksAreNotReadAsZeroBigBlinds();
testReplayPotsAreExposedByTheAdapter();
console.log("import engine validation tests passed");
