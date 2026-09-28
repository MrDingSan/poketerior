import assert from "node:assert/strict";
import { callGemini } from "../src/llm/geminiClient.js";
import { callOpenRouter } from "../src/llm/openRouterClient.js";
import { callGeminiWithFailover } from "../src/analysis/pipeline.js";
import { validateStrategicOutput } from "../src/analysis/strategicOutputValidation.js";

const validHarrington = `## Situation\nHero may check or bet.\n## Key Evidence\nHero has ace-high and no direct draw.\n## Candidate Actions\nChecking and betting are legal.\n## Recommendation\nCheck.\n## Caveats\nVillain reads are unknown.`;
const repeated = `## Situation\nFlop.\n## Key Evidence\n${"If a Q comes, you have J-T-9-8-Q, no. ".repeat(12)}\n## Candidate Actions\nCheck.\n## Recommendation\nCheck.\n## Caveats\nUnknown.`;

{
  const calls = [];
  const result = await callGeminiWithFailover({
    models: ["first-model", "second-model"],
    apiKey: "test-key",
    prompt: "test",
    callModel: async ({ model }) => {
      calls.push(model);
      return model === "first-model"
        ? { text: repeated, completion: { finishReason: "MAX_TOKENS" } }
        : { text: validHarrington, completion: { finishReason: "STOP" } };
    },
    validate: (response) => validateStrategicOutput({ text: response.text, format: "harrington", completion: response.completion }),
  });

  assert.deepEqual(calls, ["first-model", "second-model"]);
  assert.equal(result.model, "second-model");
  assert.equal(result.modelFailures.length, 1);
  assert.match(result.modelFailures[0].error, /invalid strategic output/i);
}

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{
        content: { parts: [{ text: "Complete response." }] },
        finishReason: "STOP",
        safetyRatings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", probability: "NEGLIGIBLE" }],
      }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3, totalTokenCount: 15 },
    }),
  });
  try {
    const result = await callGemini({ apiKey: "test-key", prompt: "test" });
    assert.equal(result.completion.finishReason, "STOP");
    assert.equal(result.completion.usageMetadata.totalTokenCount, 15);
    assert.equal(result.completion.safetyRatings.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

{
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: "Complete response." }, finish_reason: "length" }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    }),
  });
  try {
    const result = await callOpenRouter({ apiKey: "test-key", prompt: "test" });
    assert.equal(result.completion.finishReason, "length");
    assert.equal(result.completion.usageMetadata.total_tokens, 14);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log("reasoningFailoverValidation tests passed");
