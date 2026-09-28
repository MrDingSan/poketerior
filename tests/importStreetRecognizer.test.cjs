const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/import-engine/ocr/recognizer.js"), "utf8"), sandbox, { filename: "recognizer.js" });
const streets = sandbox.PokerCoachStreetRecognizer;
assert.ok(streets, "PokerCoachStreetRecognizer must be attached");
const plain = (value) => JSON.parse(JSON.stringify(value));

// preprocess records the pipeline so tests can see exactly which variants were applied
const preprocessCalls = [];
function preprocess(canvas, variant) {
  preprocessCalls.push({ tag: canvas.tag, variant });
  return { tag: `${canvas.tag}>${variant}` };
}

function scriptedPool(responses) {
  const calls = [];
  let inflight = 0;
  let maxInflight = 0;
  return {
    calls,
    get maxInflight() { return maxInflight; },
    async recognize(image, options) {
      calls.push({ image: image.tag, options });
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((resolve) => setImmediate(resolve));
      inflight -= 1;
      const response = typeof responses === "function" ? responses(image.tag, calls.length) : responses[calls.length - 1];
      if (response instanceof Error) throw response;
      return response;
    },
  };
}

const lineData = (confidence, lines) => ({ data: { text: lines.map((line) => line[0]).join("\n"), confidence, lines: lines.map(([text, lineConfidence]) => ({ text, confidence: lineConfidence })) } });

async function testFirstAttemptUsesUpscale2AndSkipsRetryWhenConfident() {
  preprocessCalls.length = 0;
  const pool = scriptedPool([lineData(93, [["Check", 95], ["Bet 2.2 BB", 91]])]);
  const result = await streets.recognizeStreet({ street: "flop", crop: { tag: "flopCrop" }, pool, preprocess });
  assert.equal(result.street, "flop");
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].variant, "upscale2");
  assert.equal(preprocessCalls.length, 1);
  assert.equal(preprocessCalls[0].variant, "upscale2");
  assert.equal(pool.calls[0].image, "flopCrop>upscale2");
  assert.equal(result.confidence, 0.93);
  assert.equal(result.rawText, "Check\nBet 2.2 BB");
  assert.deepEqual(plain(result.rows.map((row) => row.text)), ["Check", "Bet 2.2 BB"]);
  assert.equal(result.rows[1].confidence, 0.91);
}

async function testLowConfidenceRetriesOnceAndKeepsBothAttempts() {
  preprocessCalls.length = 0;
  const pool = scriptedPool([lineData(40, [["Che ck", 40]]), lineData(88, [["Check", 88]])]);
  const result = await streets.recognizeStreet({ street: "turn", crop: { tag: "turnCrop" }, pool, preprocess });
  assert.equal(result.attempts.length, 2, "both attempt records are preserved");
  assert.equal(result.attempts[0].variant, "upscale2");
  assert.match(result.attempts[1].variant, /^(grayscaleContrast|threshold)$/);
  assert.deepEqual(plain(result.attempts.map((attempt) => attempt.confidence)), [0.4, 0.88]);
  assert.equal(result.confidence, 0.88, "the better attempt wins");
  assert.equal(result.rawText, "Check");
  assert.ok(pool.calls[1].image.startsWith("turnCrop>upscale2>"), "retry still upscales before contrast/threshold");
}

async function testBetterFirstAttemptSurvivesAWorseRetry() {
  const pool = scriptedPool([lineData(60, [["Bet 5.4 BB", 60]]), lineData(20, [["8et 54 88", 20]])]);
  const result = await streets.recognizeStreet({ street: "river", crop: { tag: "c" }, pool, preprocess });
  assert.equal(result.attempts.length, 2);
  assert.equal(result.confidence, 0.6);
  assert.equal(result.rawText, "Bet 5.4 BB");
}

async function testOnlyOneRetryRoundEvenWhenStillLow() {
  const pool = scriptedPool(() => lineData(10, [["???", 10]]));
  const result = await streets.recognizeStreet({ street: "flop", crop: { tag: "c" }, pool, preprocess, variants: ["upscale2", "grayscaleContrast", "threshold"] });
  assert.equal(result.attempts.length, 2);
  assert.equal(pool.calls.length, 2);
}

async function testCustomVariantsAndRetryThreshold() {
  const pool = scriptedPool([lineData(80, [["Call 2 BB", 80]]), lineData(95, [["Call 2 BB", 95]])]);
  const result = await streets.recognizeStreet({ street: "preflop", crop: { tag: "c" }, pool, preprocess, variants: ["upscale3", "threshold"], retryBelow: 0.9 });
  assert.deepEqual(plain(result.attempts.map((attempt) => attempt.variant)), ["upscale3", "threshold"]);
  assert.equal(result.confidence, 0.95);
}

async function testRowsAreRecognizedConcurrentlyAndOnlyLowRowsRetry() {
  preprocessCalls.length = 0;
  const pool = scriptedPool((tag) => {
    if (tag.startsWith("rowB") && !tag.includes("grayscaleContrast")) return lineData(30, [["Ca11 2 B8", 30]]);
    if (tag.startsWith("rowB")) return lineData(90, [["Call 2 BB", 90]]);
    return lineData(96, [[tag.startsWith("rowA") ? "Fold" : "Raise 3 BB", 96]]);
  });
  const region = { x: 0.2, y: 0.6, width: 0.2, height: 0.05 };
  const result = await streets.recognizeStreet({
    street: "preflop",
    crop: { tag: "streetCrop" },
    rows: [
      { crop: { tag: "rowA" }, actorName: "JackpotBee", position: "UTG", rowType: "action" },
      { crop: { tag: "rowB" }, actorName: "JIREN9", position: "BB", rowType: "action", sourceRegion: region },
      { crop: { tag: "rowC" }, rowType: "action" },
    ],
    pool,
    preprocess,
  });
  assert.ok(pool.maxInflight >= 2, "row jobs are submitted together so the pool can run them in parallel");
  assert.equal(pool.calls.length, 4, "three rows plus one retry for the low-confidence row only");
  assert.equal(pool.calls.filter((call) => call.image.startsWith("rowB")).length, 2);
  assert.equal(pool.calls.filter((call) => call.image.startsWith("rowA")).length, 1);
  assert.deepEqual(plain(result.rows.map((row) => row.text)), ["Fold", "Call 2 BB", "Raise 3 BB"]);
  assert.equal(result.rows[1].actorName, "JIREN9");
  assert.equal(result.rows[1].position, "BB");
  assert.deepEqual(plain(result.rows[1].sourceRegion), region);
  assert.equal(result.rows[1].confidence, 0.9);
  assert.equal(result.confidence, 0.9, "street confidence is the weakest row");
  assert.equal(result.rawText, "Fold\nCall 2 BB\nRaise 3 BB");
  assert.ok(result.attempts.some((attempt) => attempt.scope === "row:1" && attempt.variant !== "upscale2"));
  assert.ok(!pool.calls.some((call) => call.image.startsWith("streetCrop")), "the whole street crop is not recognized when rows succeed");
}

async function testRowTypeSelectsCharacterWhitelist() {
  const pool = scriptedPool(() => lineData(95, [["2.2 BB", 95]]));
  await streets.recognizeStreet({ street: "flop", crop: { tag: "c" }, rows: [{ crop: { tag: "amt" }, rowType: "amount" }], pool, preprocess });
  assert.match(pool.calls[0].options.parameters.tessedit_char_whitelist, /0123456789/);
  const free = scriptedPool(() => lineData(95, [["JIREN9", 95]]));
  await streets.recognizeStreet({ street: "flop", crop: { tag: "c" }, pool: free, preprocess });
  assert.equal(free.calls[0].options.parameters?.tessedit_char_whitelist, undefined, "free-text street OCR keeps player-name characters");
}

async function testOutputShapesFromBlocksAndPlainText() {
  const blocks = { data: { text: "ignored", confidence: 92, blocks: [{ paragraphs: [{ lines: [{ text: " Fold ", confidence: 90 }, { text: "", confidence: 0 }] }, { lines: [{ text: "Check", confidence: 94 }] }] }] } };
  const fromBlocks = await streets.recognizeStreet({ street: "flop", crop: { tag: "c" }, pool: scriptedPool([blocks]), preprocess });
  assert.deepEqual(plain(fromBlocks.rows.map((row) => row.text)), ["Fold", "Check"]);
  const plainText = await streets.recognizeStreet({ street: "flop", crop: { tag: "c" }, pool: scriptedPool([{ data: { text: "Fold\n\n Check \n", confidence: 88 } }]), preprocess });
  assert.deepEqual(plain(plainText.rows.map((row) => row.text)), ["Fold", "Check"]);
  assert.equal(plainText.rows[0].confidence, 0.88, "plain-text lines inherit the recognition confidence");
  const empty = await streets.recognizeStreet({ street: "flop", crop: { tag: "c" }, pool: scriptedPool([{ data: { text: "", confidence: 0 } }, { data: { text: "", confidence: 0 } }]), preprocess });
  assert.equal(empty.confidence, 0);
  assert.deepEqual(plain(empty.rows), []);
}

async function testPoolFailuresNameTheStreet() {
  await assert.rejects(
    streets.recognizeStreet({ street: "river", crop: { tag: "c" }, pool: scriptedPool([new Error("worker crashed")]), preprocess }),
    /river.*worker crashed/i,
  );
}

let completed = false;
process.on("exit", () => {
  if (!completed) {
    console.error("import street recognizer tests did not complete: an awaited job never settled");
    process.exitCode = 1;
  }
});

(async () => {
  await testFirstAttemptUsesUpscale2AndSkipsRetryWhenConfident();
  await testLowConfidenceRetriesOnceAndKeepsBothAttempts();
  await testBetterFirstAttemptSurvivesAWorseRetry();
  await testOnlyOneRetryRoundEvenWhenStillLow();
  await testCustomVariantsAndRetryThreshold();
  await testRowsAreRecognizedConcurrentlyAndOnlyLowRowsRetry();
  await testRowTypeSelectsCharacterWhitelist();
  await testOutputShapesFromBlocksAndPlainText();
  await testPoolFailuresNameTheStreet();
  completed = true;
  console.log("import street recognizer tests passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
