const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
for (const file of ["types.js", "parsing/actions.js"]) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/import-engine", file), "utf8"), sandbox, { filename: file });
}
const parser = sandbox.PokerCoachImportActionParser;
const types = sandbox.PokerCoachImportTypes;
const plain = (value) => JSON.parse(JSON.stringify(value));
assert.ok(parser, "PokerCoachImportActionParser must be attached");

function testParseAmountHandlesSpacingCommasAndCase() {
  assert.deepEqual(plain(parser.parseAmount("Call 2.2BB")), { value: 2.2, confidence: 1 });
  assert.deepEqual(plain(parser.parseAmount("2.2 BB")), { value: 2.2, confidence: 1 });
  assert.deepEqual(plain(parser.parseAmount("RAISE 2,5 BB")), { value: 2.5, confidence: 0.94 });
  assert.deepEqual(plain(parser.parseAmount("2,2BB")), { value: 2.2, confidence: 0.94 });
  assert.deepEqual(plain(parser.parseAmount("Bet 21 bb")), { value: 21, confidence: 1 });
  assert.deepEqual(plain(parser.parseAmount("Check")), { value: null, confidence: 0 });
  assert.deepEqual(plain(parser.parseAmount("")), { value: null, confidence: 0 });
}

function testDigitSubstitutionOnlyInsideAmountTokens() {
  const corrected = parser.parseAmount("Bet 1O.5 BB");
  assert.equal(corrected.value, 10.5);
  assert.ok(corrected.confidence >= 0.65 && corrected.confidence < 0.9, "corrected digits are medium confidence");
  assert.equal(parser.parseAmount("Bet 2.O BB").value, 2);
  // letters in words are never turned into digits, and a token with no real digit is not an amount
  assert.equal(parser.parseAmount("Bet O.B BB").value, null);
  assert.equal(parser.parseAmount("CALL").value, null);
  assert.equal(parser.parseAmount("ALL IN").value, null);
  assert.equal(parser.parseAmount("Bet 2.2.2 BB").value, null, "two decimal points are ambiguous, not guessed");
}

function testRowsMapToCanonicalActions() {
  const call = parser.parseActionRow({ text: "Call 2.2BB", actorName: "JIREN9", position: "bb" }, {});
  assert.equal(call.action.type, "call");
  assert.equal(call.action.amountBb, 2.2);
  assert.equal(call.action.amountKind, "increment");
  assert.equal(call.action.actorName, "JIREN9");
  assert.equal(call.action.position, "BB");
  assert.equal(call.action.rawText, "Call 2.2BB");
  assert.equal(call.confidence, 1);
  assert.deepEqual(plain(call.warnings), []);

  const bet = parser.parseActionRow({ text: "Bet 5.4 BB" }, {});
  assert.equal(bet.action.type, "bet");
  assert.equal(bet.action.amountKind, "street-total");
  const raise = parser.parseActionRow({ text: "Raise 3 BB" }, {});
  assert.equal(raise.action.type, "raise");
  assert.equal(raise.action.amountKind, "street-total");
  const allin = parser.parseActionRow({ text: "AII IN 19.8 BB", actorName: "Hero" }, {});
  assert.equal(allin.action.type, "allin");
  assert.equal(allin.action.amountBb, 19.8);
  assert.equal(allin.action.amountKind, "stack-total");
  assert.ok(allin.confidence < 1 && allin.confidence >= 0.9, "a corrected keyword lowers confidence slightly");
  for (const text of ["All-in", "ALL IN", "allin"]) assert.equal(parser.parseActionRow({ text }, {}).action.type, "allin", text);
}

function testFoldAndCheckNeverCarryAmounts() {
  const check = parser.parseActionRow({ text: "Check" }, {});
  assert.equal(check.action.type, "check");
  assert.equal(check.action.amountBb, null);
  assert.equal(check.action.amountKind, "none");
  for (const text of ["Fold", "FOLD", "fold"]) {
    const fold = parser.parseActionRow({ text }, {});
    assert.equal(fold.action.type, "fold", text);
    assert.equal(fold.action.amountKind, "none");
  }
  assert.equal(parser.parseActionRow({ text: "CALL" }, {}).action.type, "call");
  assert.equal(parser.parseActionRow({ text: "CALL" }, {}).action.amountBb, null, "call without a printed amount stays null");
}

function testBookkeepingRowsAreNotActions() {
  for (const text of ["Wins 21.6 BB", "RETURN 3 BB", "refund 2 BB", "muck", "Uncalled bet 4 BB returned"]) {
    const result = parser.parseActionRow({ text }, {});
    assert.equal(result.action, null, text);
    assert.equal(result.ignored, "bookkeeping", text);
  }
  for (const text of ["10s", "", "   "]) {
    const result = parser.parseActionRow({ text }, {});
    assert.equal(result.action, null);
    assert.equal(result.ignored, "noise");
  }
}

function testAmbiguityIsWarnedNeverInvented() {
  const unreadable = parser.parseActionRow({ text: "Bet O.B BB" }, { street: "flop", index: 1 });
  assert.equal(unreadable.action.type, "bet");
  assert.equal(unreadable.action.amountBb, null, "no amount is invented");
  assert.ok(unreadable.warnings.length > 0);
  assert.equal(unreadable.warnings[0].field, "actions.flop.1.amountBb");
  assert.equal(unreadable.warnings[0].correctable, true);
  assert.ok(unreadable.confidence < 0.65, "an aggressive action without a readable amount is low confidence");

  const unknown = parser.parseActionRow({ text: "Blorp 4" }, {});
  assert.equal(unknown.action, null);
  assert.equal(unknown.ignored, "unrecognized");
  assert.ok(unknown.warnings.length > 0);
}

function testActorsAreNeverDefaultedToHero() {
  for (const row of [{ text: "Fold" }, { text: "Fold", actorName: "" }, { text: "Fold", actorName: "   " }]) {
    const result = parser.parseActionRow(row, {});
    assert.equal(result.action.actorName, null);
    assert.equal(result.action.actorId, null);
  }
  assert.equal(parser.parseActionRow({ text: "Fold", actorId: "p3" }, {}).action.actorId, "p3");
}

function testBlindAndAnteRows() {
  const sb = parser.parseActionRow({ text: "SB 0.5 BB", actorName: "tunfeld32th" }, {});
  assert.equal(sb.action.type, "blind");
  assert.equal(sb.action.amountBb, 0.5);
  const bb = parser.parseActionRow({ text: "BB 1 BB" }, {});
  assert.equal(bb.action.type, "blind");
  assert.equal(bb.action.amountBb, 1);
  const ante = parser.parseActionRow({ text: "Ante 0.1 BB" }, {});
  assert.equal(ante.action.type, "ante");
  // the "BB" unit on a call must not be mistaken for a blind row
  assert.equal(parser.parseActionRow({ text: "Call 2 BB" }, {}).action.type, "call");
}

function testParseStreetAssignsSequentialIdsAndSkipsNoise() {
  const result = parser.parseStreet([
    { text: "Fold", actorName: "JackpotBee", position: "UTG" },
    { text: "10s" },
    { text: "Raise 3 BB", actorName: "Razor_cyback", position: "CO" },
    { text: "Bet O.B BB", actorName: "JIREN9", position: "BB" },
    { text: "Wins 21.6 BB", actorName: "dingsan" },
  ], { street: "preflop" });
  assert.deepEqual(Array.from(result.actions, (action) => action.id), ["preflop:0", "preflop:1", "preflop:2"]);
  assert.deepEqual(Array.from(result.actions, (action) => action.type), ["fold", "raise", "bet"]);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].field, "actions.preflop.2.amountBb");
  assert.ok(result.confidence < 0.65, "street confidence is the weakest action confidence");
  assert.equal(result.street, "preflop");
  assert.deepEqual(plain(result.confidences), [1, 1, 0.4], "each kept action carries its own confidence, aligned with actions");

  const clean = parser.parseStreet([{ text: "Check" }, { text: "Bet 2.2 BB" }], { street: "flop" });
  assert.equal(clean.confidence, 1);
  assert.deepEqual(plain(clean.warnings), []);
  assert.equal(parser.parseStreet([], { street: "river" }).confidence, 1);
}

function testParsedStreetActionsAreAcceptedByCanonicalNormalizer() {
  const street = parser.parseStreet([{ text: "Call 2 BB", actorName: "Hero", position: "BB" }, { text: "All-in 19.8 BB", actorName: "V" }], { street: "turn" });
  const hand = types.normalizeParsedHand({ actions: { turn: street.actions } });
  assert.equal(hand.actions.turn.length, 2);
  assert.equal(hand.actions.turn[1].type, "allin");
}

function testKeywordGluedToItsAmountIsSplitBecauseRealOcrEmitsIt() {
  // Tesseract returned "Bet5.4 BB" and "Raise3BB" for real Natural8-style bubbles (no space after the keyword).
  assert.equal(parser.normalizeOcrText("Bet5.4 BB"), "BET 5.4 BB");
  assert.equal(parser.normalizeOcrText("Raise3BB"), "RAISE 3 BB");
  assert.deepEqual(plain(parser.parseAmount("Bet5.4 BB")), { value: 5.4, confidence: 1 });
  const bet = parser.parseActionRow({ text: "Bet5.4 BB" }, {});
  assert.equal(bet.action.type, "bet");
  assert.equal(bet.action.amountBb, 5.4);
  assert.equal(parser.parseActionRow({ text: "Raise3BB" }, {}).action.amountBb, 3);
  assert.equal(parser.parseActionRow({ text: "CALL2.2" }, {}).action.amountBb, 2.2);
  // a word that merely ends in a keyword-like suffix is untouched
  assert.equal(parser.normalizeOcrText("JIREN9"), "JIREN9");
}

function testNormalizeOcrTextRepairsKeywordsOnly() {
  assert.equal(parser.normalizeOcrText("  AII  IN 19,8 bb "), "ALL IN 19.8 BB");
  assert.equal(parser.normalizeOcrText("Call\n2.2BB"), "CALL 2.2 BB");
  assert.equal(parser.normalizeOcrText("Bet 2,5BB"), "BET 2.5 BB");
  assert.equal(parser.normalizeOcrText("Check"), "CHECK");
}

testParseAmountHandlesSpacingCommasAndCase();
testDigitSubstitutionOnlyInsideAmountTokens();
testRowsMapToCanonicalActions();
testFoldAndCheckNeverCarryAmounts();
testBookkeepingRowsAreNotActions();
testAmbiguityIsWarnedNeverInvented();
testActorsAreNeverDefaultedToHero();
testBlindAndAnteRows();
testParseStreetAssignsSequentialIdsAndSkipsNoise();
testParsedStreetActionsAreAcceptedByCanonicalNormalizer();
testKeywordGluedToItsAmountIsSplitBecauseRealOcrEmitsIt();
testNormalizeOcrTextRepairsKeywordsOnly();
console.log("import action parser tests passed");
