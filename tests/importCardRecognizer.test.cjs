const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/import-engine/cards/templateRecognizer.js"), "utf8"), sandbox, { filename: "templateRecognizer.js" });
const cardApi = sandbox.PokerCoachCardRecognizer;
assert.ok(cardApi, "PokerCoachCardRecognizer must be attached");

const templateSet = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/import-engine/cards/templates/natural8/classic-tall-v1.json"), "utf8"));
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/import-engine/card-glyphs.json"), "utf8"));
const recognizer = cardApi.createTemplateRecognizer(templateSet);

function makeSample(spec, overrides = {}) {
  const { width, height, background, ink } = fixtures.sample;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) data.set([background, background, background, 255], index);
  const color = overrides.ink || ink[spec.color];
  const scale = spec.scale;
  function paint(matrix, originX, originY) {
    matrix.forEach((row, y) => [...row].forEach((cell, x) => {
      if (cell !== "#") return;
      for (let dy = 0; dy < scale; dy += 1) for (let dx = 0; dx < scale; dx += 1) {
        const px = originX + x * scale + dx;
        const py = originY + y * scale + dy;
        if (px < width && py < height) data.set([...color, 255], (py * width + px) * 4);
      }
    }));
  }
  paint(spec.rank, spec.offset[0] * 2, spec.offset[1] * 2);
  paint(spec.suit, 6 + spec.offset[0] * 2, 78 + spec.offset[1]);
  return { width, height, data };
}

function testEveryRankAndSuitRanksFirst() {
  assert.equal(Object.keys(fixtures.cards).length, 52);
  for (const [card, spec] of Object.entries(fixtures.cards)) {
    const result = recognizer.recognizeCard(makeSample(spec));
    assert.equal(result.card, card, `${card} recognized as ${result.card}`);
    assert.equal(result.candidates[0].card, card);
    assert.ok(result.confidence >= 0.65, `${card} confidence ${result.confidence} must reach at least medium`);
  }
}

function testResultShapeAndCandidateList() {
  const result = recognizer.recognizeCard(makeSample(fixtures.cards.Kd));
  assert.equal(result.candidates.length, 52);
  assert.equal(new Set(result.candidates.map((candidate) => candidate.card)).size, 52);
  for (let index = 1; index < result.candidates.length; index += 1) {
    assert.ok(result.candidates[index - 1].score >= result.candidates[index].score, "candidates sorted descending");
  }
  assert.equal(result.evidence.colorFamily, "red");
  assert.ok(result.evidence.rankScore > 0.9);
  assert.ok(result.evidence.suitScore > 0.9);
  assert.ok(result.confidence > 0 && result.confidence <= 1);
  assert.ok("region" in result.evidence);
  assert.equal(recognizer.recognizeCard(makeSample(fixtures.cards.Ks)).evidence.colorFamily, "black");
}

function testSuitColorFamilyConstrainsCandidates() {
  const spadeSample = makeSample(fixtures.cards["7s"]);
  const result = recognizer.recognizeCard(spadeSample);
  const firstRed = result.candidates.findIndex((candidate) => /[dh]$/.test(candidate.card));
  const lastBlackOfRank = result.candidates.findIndex((candidate) => candidate.card === "7c");
  assert.ok(lastBlackOfRank < firstRed || firstRed > 1, "black glyphs never rank red suits above black ones");
  // A black-ink heart glyph must not be read as a confident red card.
  const oddball = makeSample({ ...fixtures.cards.Ah, color: "red" }, { ink: [20, 20, 20] });
  const odd = recognizer.recognizeCard(oddball);
  assert.equal(odd.evidence.colorFamily, "black");
  assert.ok(odd.confidence < 0.9, "colour/shape disagreement lowers confidence");
}

function testAmbiguousRedAceLowersConfidenceViaMargin() {
  const result = recognizer.recognizeCard(makeSample(fixtures.ambiguousRedAce));
  assert.equal(result.candidates[0].card, "Ah");
  assert.equal(result.candidates[1].card, "Ad");
  assert.ok(result.confidence >= 0.65 && result.confidence < 0.9, `ambiguous confidence ${result.confidence}`);
  const clean = recognizer.recognizeCard(makeSample(fixtures.cards.Ah));
  assert.ok(clean.confidence > result.confidence, "a clean glyph is more confident than an ambiguous one");
}

function testInsufficientForegroundIsRejectedNotGuessed() {
  const blank = { width: 40, height: 60, data: new Uint8ClampedArray(40 * 60 * 4).fill(250) };
  const result = recognizer.recognizeCard(blank);
  assert.equal(result.card, null);
  assert.equal(result.confidence, 0);
  assert.equal(result.evidence.reason, "insufficient-foreground");
  assert.deepEqual(Array.from(result.candidates), []);

  const speck = { width: 40, height: 60, data: new Uint8ClampedArray(40 * 60 * 4).fill(250) };
  speck.data.set([0, 0, 0, 255], (10 * 40 + 10) * 4);
  assert.equal(recognizer.recognizeCard(speck).card, null);
}

function testGlyphScaleAndOffsetDoNotChangeTheAnswer() {
  const base = fixtures.cards["9h"];
  for (const [scale, offset] of [[3, [1, 1]], [4, [3, 2]], [3, [3, 3]]]) {
    assert.equal(recognizer.recognizeCard(makeSample({ ...base, scale, offset })).card, "9h");
  }
}

function testRecognizeCardsPreservesOrder() {
  const results = recognizer.recognizeCards([makeSample(fixtures.cards.Ah), makeSample(fixtures.cards["4d"]), makeSample(fixtures.cards.Tc)]);
  assert.deepEqual(Array.from(results, (result) => result.card), ["Ah", "4d", "Tc"]);
  assert.deepEqual(Array.from(recognizer.recognizeCards([])), []);
}

function testTemplateSetIsVersionedAndComplete() {
  assert.equal(templateSet.adapterVersion, "classic-tall-v1");
  assert.deepEqual(Object.keys(templateSet.rank.glyphs).sort(), ["2", "3", "4", "5", "6", "7", "8", "9", "A", "J", "K", "Q", "T"]);
  assert.deepEqual(Object.keys(templateSet.suit.glyphs).sort(), ["c", "d", "h", "s"]);
  for (const glyph of Object.values(templateSet.rank.glyphs)) {
    assert.equal(glyph.length, templateSet.rank.height);
    for (const row of glyph) assert.equal(row.length, templateSet.rank.width);
  }
  assert.match(templateSet.provenance, /not validated/i);
  assert.equal(recognizer.adapterVersion, "classic-tall-v1");
  assert.throws(() => cardApi.createTemplateRecognizer({}), /template/i);
}

testEveryRankAndSuitRanksFirst();
testResultShapeAndCandidateList();
testSuitColorFamilyConstrainsCandidates();
testAmbiguousRedAceLowersConfidenceViaMargin();
testInsufficientForegroundIsRejectedNotGuessed();
testGlyphScaleAndOffsetDoNotChangeTheAnswer();
testRecognizeCardsPreservesOrder();
testTemplateSetIsVersionedAndComplete();
console.log("import card recognizer tests passed");
