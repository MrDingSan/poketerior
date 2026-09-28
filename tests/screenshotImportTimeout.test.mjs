import assert from "node:assert/strict";
import { importHandFromScreenshot } from "../src/analysis/pipeline.js";

const originalFetch = globalThis.fetch;
let observedSignal = null;
let observedBody = null;

function validVisionResponse() {
  return new Response(JSON.stringify({
    candidates: [{
      content: {
        parts: [{
          text: JSON.stringify({
            site: "CoinPoker",
            handId: "timeout-test",
            game: "NLHE",
            stakes: "1/2",
            heroName: "Hero",
            heroHand: ["As", "Kd"],
            board: { flop: ["2c", "7h", "9s"], turn: null, river: null },
            players: [
              { name: "Hero", position: "BB", stackBb: 100, isHero: true },
              { name: "Villain", position: "BTN", stackBb: 100, isHero: false },
            ],
            streets: {
              preflop: { potBb: 6.5, actions: [
                { actor: "Villain", position: "BTN", action: "raise", amountBb: 3 },
                { actor: "Hero", position: "BB", action: "call", amountBb: 2 },
              ] },
              flop: { potBb: 6.5, actions: [] },
              turn: { potBb: null, actions: [] },
              river: { potBb: null, actions: [] },
            },
            confidenceNotes: [],
          }),
        }],
      },
      finishReason: "STOP",
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

globalThis.fetch = async (_url, options = {}) => {
  observedSignal = options.signal || null;
  observedBody = JSON.parse(options.body || "{}");
  return validVisionResponse();
};

try {
  await importHandFromScreenshot({
    imageBase64: "dGVzdA==",
    mimeType: "image/png",
    config: {
      geminiApiKey: "test-key",
      geminiImportModel: "test-model",
      geminiImportFallbackModels: [],
      openRouterApiKey: "",
      openRouterImportModel: "",
      openRouterImportFallbackModels: [],
    },
  });

  assert.ok(observedSignal instanceof AbortSignal, "screenshot import provider request must have a timeout signal");
  assert.equal(observedBody.generationConfig.maxOutputTokens, 1200, "main screenshot extraction must cap its JSON output");

  globalThis.fetch = (_url, options = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(validVisionResponse()), 7_000);
    options.signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(options.signal.reason);
    }, { once: true });
  });
  await importHandFromScreenshot({
    imageBase64: "dGVzdA==",
    mimeType: "image/png",
    config: {
      geminiApiKey: "test-key",
      geminiImportModel: "test-model",
      geminiImportFallbackModels: [],
      openRouterApiKey: "",
      openRouterImportModel: "",
      openRouterImportFallbackModels: [],
    },
  });
  console.log("screenshot import must allow a normal seven-second vision extraction");
  console.log("screenshot import timeout regression passed");
} finally {
  globalThis.fetch = originalFetch;
}
