import assert from "node:assert/strict";
import { completeMissingJsonClosers, importHandFromScreenshot } from "../src/analysis/pipeline.js";

function testRepairsOnlyMissingTrailingClosers() {
  assert.equal(completeMissingJsonClosers('{"a":1,"b":["x","y"]'), '{"a":1,"b":["x","y"]}', "a missing final brace is added");
  assert.equal(completeMissingJsonClosers('{"a":{"b":[1,2]'), '{"a":{"b":[1,2]}}', "two closers are added in the right order");
  assert.equal(completeMissingJsonClosers('{"a":[1,2'), '{"a":[1,2]}');
  assert.equal(completeMissingJsonClosers('{"a":1}'), '{"a":1}', "valid JSON is untouched");
  assert.equal(completeMissingJsonClosers('  {"a":1}\n'), '{"a":1}');
  assert.equal(completeMissingJsonClosers('{"note":"has } and ] inside","b":1'), '{"note":"has } and ] inside","b":1}', "brackets inside strings are ignored");
  assert.equal(completeMissingJsonClosers('{"note":"say \\"hi\\" {","b":1'), '{"note":"say \\"hi\\" {","b":1}', "escaped quotes are handled");
}

function testRefusesToGuessAtRealDamage() {
  assert.equal(completeMissingJsonClosers('{"a":"unterminated'), '{"a":"unterminated', "text ending inside a string is truncated, not repaired");
  assert.equal(completeMissingJsonClosers('{"a":1,"b":'), '{"a":1,"b":', "a dangling key is not repaired");
  assert.equal(completeMissingJsonClosers('{"a":{"b":{"c":[1'), '{"a":{"b":{"c":[1', "more than two missing closers is too much to guess");
  assert.equal(completeMissingJsonClosers('{"a":[1,2}'), '{"a":[1,2}', "mismatched closers are left alone");
  assert.equal(completeMissingJsonClosers("not json"), "not json");
  assert.equal(completeMissingJsonClosers(""), "");
}

const HAND = { site: "Natural8", handId: "x", game: "NLHE", stakes: "1/2", heroName: "Hero", heroHand: ["As", "Kd"], board: { flop: ["2c", "7h", "9s"], turn: null, river: null },
  players: [{ name: "Hero", position: "BB", stackBb: 100, isHero: true }, { name: "Villain", position: "BTN", stackBb: 100, isHero: false }],
  streets: { preflop: { potBb: 6.5, actions: [{ actor: "Villain", position: "BTN", action: "raise", amountBb: 3 }, { actor: "Hero", position: "BB", action: "call", amountBb: 2 }] }, flop: { potBb: 6.5, actions: [] }, turn: { potBb: null, actions: [] }, river: { potBb: null, actions: [] } }, confidenceNotes: [] };
const withoutFinalBrace = JSON.stringify(HAND).slice(0, -1);
const originalFetch = globalThis.fetch;
const config = { geminiApiKey: "", openRouterApiKey: "k", openRouterImportModel: "qwen/qwen3-vl-32b-instruct", openRouterImportFallbackModels: [], importProviderOrder: ["openrouter"] };
const reply = (finish, content) => async () => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }] }), { status: 200, headers: { "Content-Type": "application/json" } });

async function testImportAcceptsAnAnswerThatOnlyForgotTheFinalBrace() {
  globalThis.fetch = reply("stop", withoutFinalBrace);
  const result = await importHandFromScreenshot({ imageBase64: "dGVzdA==", mimeType: "image/png", config });
  assert.equal(result.provider, "openrouter");
  assert.deepEqual(result.hand.heroHand, ["As", "Kd"]);
}

async function testATruncatedAnswerIsStillRejected() {
  globalThis.fetch = reply("length", withoutFinalBrace);
  await assert.rejects(importHandFromScreenshot({ imageBase64: "dGVzdA==", mimeType: "image/png", config }), /invalid import JSON/, "finish_reason=length means the output was cut off; never repair it");
  globalThis.fetch = reply("stop", JSON.stringify(HAND).slice(0, 200));
  await assert.rejects(importHandFromScreenshot({ imageBase64: "dGVzdA==", mimeType: "image/png", config }), /invalid import JSON/, "a genuinely cut-off body still fails");
}

let completed = false;
process.on("exit", () => { if (!completed) { console.error("json closer repair tests did not complete"); process.exitCode = 1; } });
try {
  testRepairsOnlyMissingTrailingClosers();
  testRefusesToGuessAtRealDamage();
  await testImportAcceptsAnAnswerThatOnlyForgotTheFinalBrace();
  await testATruncatedAnswerIsStillRejected();
  completed = true;
  console.log("json closer repair tests passed");
} finally { globalThis.fetch = originalFetch; }
