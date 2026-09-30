import assert from "node:assert/strict";
import { callNebius } from "../src/llm/nebiusClient.js";

const requests = [];
const fetchImpl = async (url, options) => {
  requests.push({ url, options });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: { content: "Fold: the price is insufficient." },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 7, total_tokens: 17 },
    }),
  };
};

const result = await callNebius({
  apiKey: "test-secret",
  baseUrl: "https://example.test/v1/",
  model: "nvidia/test-model",
  systemInstruction: "Coach accurately.",
  prompt: "Analyze this spot.",
  temperature: 0.22,
  maxTokens: 700,
  fetchImpl,
});

assert.equal(requests[0].url, "https://example.test/v1/chat/completions");
assert.equal(requests[0].options.headers.Authorization, "Bearer test-secret");
assert.deepEqual(JSON.parse(requests[0].options.body), {
  model: "nvidia/test-model",
  messages: [
    { role: "system", content: "Coach accurately." },
    { role: "user", content: "Analyze this spot." },
  ],
  temperature: 0.22,
  max_tokens: 700,
});
assert.equal(result.text, "Fold: the price is insufficient.");
assert.equal(result.completion.finishReason, "stop");
assert.equal(result.completion.usageMetadata.total_tokens, 17);

await assert.rejects(
  () => callNebius({ apiKey: "", prompt: "x", fetchImpl }),
  /Missing NEBIUS_API_KEY/,
);

await assert.rejects(
  () => callNebius({
    apiKey: "test-secret",
    prompt: "slow request",
    timeoutMs: 5,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason));
    }),
  }),
  /timed out after 5ms/i,
);

const externalController = new AbortController();
const externallyCancelled = callNebius({
  apiKey: "test-secret",
  prompt: "obsolete request",
  signal: externalController.signal,
  fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(options.signal.reason));
  }),
});
externalController.abort(new Error("Analysis superseded."));
await assert.rejects(() => externallyCancelled, /Analysis superseded/i);

await assert.rejects(
  () =>
    callNebius({
      apiKey: "must-not-appear",
      model: "nvidia/test-model",
      prompt: "x",
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: "Unauthorized" } }),
      }),
    }),
  (error) =>
    !error.message.includes("must-not-appear") && /401.*Unauthorized/.test(error.message),
);

console.log("nebiusClient tests passed");

// Headers arrive but the body stalls: the timeout must still fire instead of hanging the request forever.
{
  const stalledBody = async (_url, { signal }) => ({
    ok: true,
    status: 200,
    json: () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("body aborted")))),
  });
  const started = Date.now();
  await assert.rejects(
    callNebius({ apiKey: "test", prompt: "hi", timeoutMs: 50, fetchImpl: stalledBody }),
    /timed out after 50ms/,
  );
  assert.ok(Date.now() - started < 2000, "stalled body should time out promptly");
  console.log("Nebius stalled-body timeout check passed");
}
