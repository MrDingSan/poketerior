import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/env.js";
import { callNebius } from "../src/llm/nebiusClient.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig(rootDir);
if (!config.nebiusApiKey) {
  throw new Error("NEBIUS_API_KEY is not configured.");
}

const response = await callNebius({
  apiKey: config.nebiusApiKey,
  baseUrl: config.nebiusBaseUrl,
  model: config.nebiusModel,
  temperature: 0,
  systemInstruction: "You are a concise poker analysis connectivity check.",
  prompt: "Reply with exactly: Nebius Nemotron connection verified",
});

console.log(
  JSON.stringify(
    {
      provider: "nebius",
      model: config.nebiusModel,
      text: response.text,
      usage: response.completion.usageMetadata,
    },
    null,
    2,
  ),
);
