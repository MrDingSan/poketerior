import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config/env.js";
import {
  callNebiusWithFailover,
  callReasoningProvider,
} from "../src/analysis/pipeline.js";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pokercoach-nebius-config-"));
try {
  fs.writeFileSync(
    path.join(tempDir, ".env"),
    [
      "NEBIUS_API_KEY=test-nebius-key",
      "NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1",
      "NEBIUS_MODEL=nvidia/nemotron-3-super-120b-a12b",
      "NEBIUS_FALLBACK_MODELS=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
    ].join("\n"),
  );
  const config = loadConfig(tempDir);
  assert.equal(config.nebiusApiKey, "test-nebius-key");
  assert.equal(config.nebiusBaseUrl, "https://api.tokenfactory.nebius.com/v1");
  assert.equal(config.nebiusModel, "nvidia/nemotron-3-super-120b-a12b");
  assert.deepEqual(config.nebiusFallbackModels, [
    "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
  ]);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

{
  const config = loadConfig(tempDir);
  assert.equal(config.geminiImportModel, "gemini-3.1-flash-lite");
  assert.deepEqual(config.geminiImportFallbackModels, ["gemini-2.5-flash", "gemini-3.5-flash"]);
}

{
  const calls = [];
  const result = await callNebiusWithFailover({
    models: ["nvidia/first", "nvidia/second"],
    apiKey: "test-key",
    baseUrl: "https://example.test/v1",
    prompt: "Analyze.",
    callModel: async ({ model }) => {
      calls.push(model);
      return { text: model === "nvidia/first" ? "invalid" : "Check." };
    },
    validate: (candidate) => ({
      valid: candidate.text === "Check.",
      reasons: candidate.text === "Check." ? [] : ["missing recommendation"],
    }),
  });
  assert.deepEqual(calls, ["nvidia/first", "nvidia/second"]);
  assert.equal(result.provider, "nebius");
  assert.equal(result.model, "nvidia/second");
  assert.match(result.modelFailures[0].error, /Invalid strategic output/);
}

const baseConfig = {
  nebiusApiKey: "test-key",
  nebiusBaseUrl: "https://example.test/v1",
  nebiusModel: "nvidia/primary",
  nebiusFallbackModels: [],
  geminiApiKey: "gemini-key",
  geminiModel: "gemini-primary",
  geminiFallbackModels: [],
  openRouterApiKey: "openrouter-key",
  openRouterModel: "openrouter-primary",
  openRouterFallbackModels: [],
};

{
  const providerCalls = [];
  const result = await callReasoningProvider(
    { config: baseConfig, prompt: "Analyze." },
    {
      callNebiusProvider: async () => {
        providerCalls.push("nebius");
        return { text: "Check.", provider: "nebius", model: "nvidia/primary", modelFailures: [] };
      },
      callGeminiProvider: async () => {
        providerCalls.push("gemini");
        return { text: "Fold.", model: "gemini-primary", modelFailures: [] };
      },
      callOpenRouterProvider: async () => {
        providerCalls.push("openrouter");
        return { text: "Call.", provider: "openrouter", model: "openrouter-primary", modelFailures: [] };
      },
    },
  );
  assert.deepEqual(providerCalls, ["nebius"]);
  assert.equal(result.provider, "nebius");
}

{
  const providerCalls = [];
  const result = await callReasoningProvider(
    { config: baseConfig, prompt: "Analyze." },
    {
      callNebiusProvider: async () => {
        providerCalls.push("nebius");
        throw new Error("Token Factory unavailable");
      },
      callGeminiProvider: async () => {
        providerCalls.push("gemini");
        return { text: "Check.", model: "gemini-primary", modelFailures: [] };
      },
      callOpenRouterProvider: async () => {
        providerCalls.push("openrouter");
        throw new Error("should not run");
      },
    },
  );
  assert.deepEqual(providerCalls, ["nebius", "gemini"]);
  assert.equal(result.provider, "gemini");
  assert.equal(result.modelFailures[0].provider, "nebius");
}

{
  const providerCalls = [];
  const result = await callReasoningProvider(
    { config: { ...baseConfig, nebiusApiKey: "" }, prompt: "Analyze." },
    {
      callNebiusProvider: async () => {
        providerCalls.push("nebius");
        throw new Error("should not run");
      },
      callGeminiProvider: async () => {
        providerCalls.push("gemini");
        return { text: "Check.", model: "gemini-primary", modelFailures: [] };
      },
      callOpenRouterProvider: async () => {
        providerCalls.push("openrouter");
        throw new Error("should not run");
      },
    },
  );
  assert.deepEqual(providerCalls, ["gemini"]);
  assert.equal(result.provider, "gemini");
}

{
  // An overloaded model must hand off to the next one instead of abandoning the provider.
  const tried = [];
  const result = await callNebiusWithFailover({
    models: ["busy-model", "spare-model"],
    apiKey: "test",
    prompt: "p",
    callModel: async ({ model }) => {
      tried.push(model);
      if (model === "busy-model") throw new Error("This model is currently experiencing high demand. Spikes in demand are usually temporary.");
      return { text: "{}", completion: { finishReason: "stop" } };
    },
  });
  assert.deepEqual(tried, ["busy-model", "spare-model"]);
  assert.equal(result.model, "spare-model");
}

console.log("nebiusReasoningProvider tests passed");
