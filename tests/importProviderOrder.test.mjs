import assert from "node:assert/strict";
import { importHandFromScreenshot, importProviderOrder } from "../src/analysis/pipeline.js";

const originalFetch = globalThis.fetch;
const HAND = {
  site: "Natural8", handId: "order-test", game: "NLHE", stakes: "1/2", heroName: "Hero", heroHand: ["As", "Kd"],
  board: { flop: ["2c", "7h", "9s"], turn: null, river: null },
  players: [{ name: "Hero", position: "BB", stackBb: 100, isHero: true }, { name: "Villain", position: "BTN", stackBb: 100, isHero: false }],
  streets: {
    preflop: { potBb: 6.5, actions: [{ actor: "Villain", position: "BTN", action: "raise", amountBb: 3 }, { actor: "Hero", position: "BB", action: "call", amountBb: 2 }] },
    flop: { potBb: 6.5, actions: [] }, turn: { potBb: null, actions: [] }, river: { potBb: null, actions: [] },
  },
  confidenceNotes: [],
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const geminiOk = () => json({ candidates: [{ content: { parts: [{ text: JSON.stringify(HAND) }] }, finishReason: "STOP" }] });
const openRouterOk = () => json({ choices: [{ message: { content: JSON.stringify(HAND) }, finish_reason: "stop" }] });

const baseConfig = {
  geminiApiKey: "g-key", geminiImportModel: "gem-1", geminiImportFallbackModels: [],
  openRouterApiKey: "or-key", openRouterImportModel: "qwen/qwen3-vl-32b-instruct", openRouterImportFallbackModels: [],
};

function mockFetch(handlers) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const host = new URL(String(url)).host;
    const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ host, body, signal: options.signal });
    return handlers[host](body, options);
  };
  return calls;
}

function testProviderOrderParsing() {
  assert.deepEqual(importProviderOrder({}), ["gemini", "openrouter"], "default keeps today's behaviour");
  assert.deepEqual(importProviderOrder({ importProviderOrder: ["openrouter", "gemini"] }), ["openrouter", "gemini"]);
  assert.deepEqual(importProviderOrder({ importProviderOrder: " OpenRouter , gemini " }), ["openrouter", "gemini"], "strings are trimmed and case-insensitive");
  assert.deepEqual(importProviderOrder({ importProviderOrder: ["openrouter"] }), ["openrouter"], "a single provider is allowed");
  assert.deepEqual(importProviderOrder({ importProviderOrder: ["gemini", "gemini", "openrouter"] }), ["gemini", "openrouter"], "duplicates collapse");
  assert.deepEqual(importProviderOrder({ importProviderOrder: ["bogus", "nebius"] }), ["gemini", "openrouter"], "unknown names fall back to the default");
  assert.deepEqual(importProviderOrder({ importProviderOrder: ["bogus", "openrouter"] }), ["openrouter"], "unknown names are ignored");
  assert.deepEqual(importProviderOrder({ importProviderOrder: [] }), ["gemini", "openrouter"]);
}

async function testDefaultOrderTriesGeminiFirstAndSkipsOpenRouterOnSuccess() {
  const calls = mockFetch({ "generativelanguage.googleapis.com": geminiOk, "openrouter.ai": openRouterOk });
  const result = await importHandFromScreenshot({ imageBase64: "dGVzdA==", mimeType: "image/png", config: baseConfig });
  assert.equal(calls[0].host, "generativelanguage.googleapis.com");
  assert.ok(!calls.some((call) => call.host === "openrouter.ai"), "OpenRouter is only a fallback by default");
  assert.equal(result.provider, "gemini");
}

async function testConfiguredOrderCanPutOpenRouterFirst() {
  const calls = mockFetch({ "generativelanguage.googleapis.com": geminiOk, "openrouter.ai": openRouterOk });
  const result = await importHandFromScreenshot({ imageBase64: "dGVzdA==", mimeType: "image/png", config: { ...baseConfig, importProviderOrder: ["openrouter", "gemini"] } });
  assert.equal(calls[0].host, "openrouter.ai", "Qwen via OpenRouter runs first");
  // The focused hero-card re-read always runs afterwards; only the main extraction follows the provider order.
  const verifierCall = (call) => /strict poker card verifier/i.test(JSON.stringify(call.body));
  assert.ok(!calls.some((call) => call.host === "generativelanguage.googleapis.com" && !verifierCall(call)), "Gemini is skipped once OpenRouter succeeds");
  assert.equal(result.provider, "openrouter");
  assert.equal(result.model, "qwen/qwen3-vl-32b-instruct");
  assert.equal(calls[0].body.model, "qwen/qwen3-vl-32b-instruct");
  assert.deepEqual(calls[0].body.reasoning, { enabled: false }, "reasoning is disabled so a thinking model cannot burn the output cap");
  assert.ok(calls[0].body.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image_url")), "the screenshot is sent as an image");
}

async function testTheSecondProviderIsTheFallback() {
  const calls = mockFetch({
    "openrouter.ai": () => json({ error: { message: "upstream error" } }, 502),
    "generativelanguage.googleapis.com": geminiOk,
  });
  const result = await importHandFromScreenshot({ imageBase64: "dGVzdA==", mimeType: "image/png", config: { ...baseConfig, importProviderOrder: ["openrouter", "gemini"] } });
  assert.deepEqual(calls.slice(0, 2).map((call) => call.host), ["openrouter.ai", "generativelanguage.googleapis.com"]);
  assert.equal(result.provider, "gemini");

  mockFetch({ "generativelanguage.googleapis.com": () => json({ error: { message: "high demand" } }, 503), "openrouter.ai": openRouterOk });
  const viaOpenRouter = await importHandFromScreenshot({ imageBase64: "dGVzdA==", mimeType: "image/png", config: baseConfig });
  assert.equal(viaOpenRouter.provider, "openrouter", "default order still falls back to OpenRouter");
}

async function testAllProvidersFailingReportsEveryFailure() {
  mockFetch({ "generativelanguage.googleapis.com": () => json({ error: { message: "gemini down" } }, 503), "openrouter.ai": () => json({ error: { message: "router down" } }, 502) });
  await assert.rejects(
    importHandFromScreenshot({ imageBase64: "dGVzdA==", mimeType: "image/png", config: { ...baseConfig, importProviderOrder: ["openrouter", "gemini"] } }),
    (error) => /All screenshot import providers failed/.test(error.message) && /router down/.test(error.message) && /gemini down/.test(error.message),
  );
}

async function testMissingKeysAreSkippedNotFatal() {
  const calls = mockFetch({ "generativelanguage.googleapis.com": geminiOk, "openrouter.ai": openRouterOk });
  const result = await importHandFromScreenshot({ imageBase64: "dGVzdA==", mimeType: "image/png", config: { ...baseConfig, openRouterApiKey: "", importProviderOrder: ["openrouter", "gemini"] } });
  assert.equal(result.provider, "gemini", "OpenRouter first but no key: Gemini still serves the import");
  assert.ok(!calls.some((call) => call.host === "openrouter.ai"));
}

async function testTimeoutIsConfigurable() {
  let observed = null;
  mockFetch({ "openrouter.ai": (body, options) => { observed = options.signal; return openRouterOk(); } });
  await importHandFromScreenshot({ imageBase64: "dGVzdA==", mimeType: "image/png", config: { ...baseConfig, importProviderOrder: ["openrouter"] } });
  assert.ok(observed instanceof AbortSignal);

  // a hanging provider is cut off at the configured timeout, not the old fixed 12s
  globalThis.fetch = (_url, options = {}) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  const started = Date.now();
  await assert.rejects(
    importHandFromScreenshot({ imageBase64: "dGVzdA==", mimeType: "image/png", config: { ...baseConfig, geminiApiKey: "", screenshotImportTimeoutMs: 120, importProviderOrder: ["openrouter"] } }),
    /timed out after 120ms/,
  );
  assert.ok(Date.now() - started < 3000, "the override, not a long default, controls how long a hung provider is awaited");
}

let completed = false;
process.on("exit", () => { if (!completed) { console.error("import provider order tests did not complete"); process.exitCode = 1; } });
try {
  testProviderOrderParsing();
  await testDefaultOrderTriesGeminiFirstAndSkipsOpenRouterOnSuccess();
  await testConfiguredOrderCanPutOpenRouterFirst();
  await testTheSecondProviderIsTheFallback();
  await testAllProvidersFailingReportsEveryFailure();
  await testMissingKeysAreSkippedNotFatal();
  await testTimeoutIsConfigurable();
  completed = true;
  console.log("import provider order tests passed");
} finally {
  globalThis.fetch = originalFetch;
}
