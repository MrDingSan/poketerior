# Minimal Nebius Nemotron Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make NVIDIA Nemotron on Nebius Token Factory the primary provider for PokerCoach's text-based strategic recommendations while preserving all existing providers and features as fallbacks.

**Architecture:** Add one focused OpenAI-compatible Token Factory client, then place a Nebius failover loop ahead of the existing Gemini and OpenRouter reasoning paths. Keep screenshot import unchanged, preserve strategic-output validation, expose truthful provider metadata in health/API/UI surfaces, and add an explicit opt-in live smoke test.

**Tech Stack:** Node.js ES modules, native `fetch`, existing dependency-free HTTP server, browser JavaScript, Node `assert`, Nebius Token Factory chat-completions API.

**Spec:** `docs/superpowers/specs/2026-09-09-nebius-nemotron-minimal-migration-design.md`

## Global Constraints

- Default base URL: `https://api.tokenfactory.nebius.com/v1`.
- Default primary model: `nvidia/nemotron-3-super-120b-a12b`.
- Default fallback model: `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`.
- Nebius applies only to text-based strategic reasoning; screenshot import remains unchanged.
- Provider order is Nebius models, existing Gemini models, then existing OpenRouter models.
- Every candidate must pass the existing validator when the calling analysis supplies one.
- Never expose or log API keys or authorization headers.
- Automated tests must not make live API calls or consume credits.
- Hosting, TexasSolver packaging, and unrelated poker features are out of scope.

## File Map

- Create `src/llm/nebiusClient.js`: Token Factory request/response normalization only.
- Create `tests/nebiusClient.test.mjs`: mocked transport contract and sanitized errors.
- Modify `src/config/env.js`: load Nebius variables and defaults.
- Modify `src/analysis/pipeline.js`: Nebius model ordering and provider priority.
- Create `tests/nebiusReasoningProvider.test.mjs`: model failover, validation, provider order, and configuration tests.
- Create `public/providerAttribution.js`: pure browser/CommonJS-compatible attribution helper.
- Create `tests/providerAttribution.test.cjs`: truthful attribution behavior.
- Modify `public/index.html`: load the attribution helper before `app.js`.
- Modify `public/app.js`: provider-neutral labels and Nemotron attribution.
- Modify `src/server/server.js`: non-secret Nebius health fields.
- Modify `tests/resultsLayout.test.cjs`: assert provider-neutral UI copy and helper wiring.
- Create `scripts/nebius_smoke.mjs`: explicit live Token Factory diagnostic.
- Modify `package.json`: syntax checks, new tests, and smoke-test command.
- Modify `.env.example`: safe Nebius variable examples.
- Modify `README.md`: setup, architecture, testing, and hackathon-period change disclosure.
- Modify `LLM_ARCHITECTURE.md`: current multi-provider runtime flow.

---

### Task 1: Token Factory Client

**Files:**
- Create: `src/llm/nebiusClient.js`
- Create: `tests/nebiusClient.test.mjs`

**Interfaces:**
- Produces: `callNebius({ apiKey, baseUrl, model, systemInstruction, prompt, temperature, fetchImpl? }) -> Promise<{text, raw, completion}>`
- `completion` contains `{ finishReason, safetyRatings: [], usageMetadata }`.

- [ ] **Step 1: Write the failing client contract tests**

Create `tests/nebiusClient.test.mjs` with three cases:

```js
import assert from "node:assert/strict";
import { callNebius } from "../src/llm/nebiusClient.js";

const requests = [];
const fetchImpl = async (url, options) => {
  requests.push({ url, options });
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: "Fold: the price is insufficient." }, finish_reason: "stop" }],
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
    apiKey: "must-not-appear",
    model: "nvidia/test-model",
    prompt: "x",
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: "Unauthorized" } }),
    }),
  }),
  (error) => !error.message.includes("must-not-appear") && /401.*Unauthorized/.test(error.message),
);

console.log("nebiusClient tests passed");
```

- [ ] **Step 2: Run the test and verify the missing module failure**

Run: `node tests/nebiusClient.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `src/llm/nebiusClient.js`.

- [ ] **Step 3: Implement the minimal client**

Create `src/llm/nebiusClient.js`:

```js
const DEFAULT_NEBIUS_BASE_URL = "https://api.tokenfactory.nebius.com/v1";

export async function callNebius({
  apiKey,
  baseUrl = DEFAULT_NEBIUS_BASE_URL,
  model = "nvidia/nemotron-3-super-120b-a12b",
  systemInstruction,
  prompt,
  temperature = 0.35,
  fetchImpl = fetch,
}) {
  if (!apiKey) {
    throw new Error("Missing NEBIUS_API_KEY. Add it to the local .env file.");
  }

  const messages = [
    ...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []),
    { role: "user", content: prompt },
  ];
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error?.message || data?.message || "Unknown Token Factory error";
    throw new Error(`Nebius Token Factory request failed with ${response.status}: ${detail}`);
  }

  const content = data?.choices?.[0]?.message?.content;
  const text = Array.isArray(content)
    ? content.map((part) => part?.text || "").join("").trim()
    : String(content || "").trim();
  if (!text) throw new Error("Nebius Token Factory returned an empty response.");

  return {
    text,
    raw: data,
    completion: {
      finishReason: data?.choices?.[0]?.finish_reason || null,
      safetyRatings: [],
      usageMetadata: data?.usage || null,
    },
  };
}
```

- [ ] **Step 4: Run client tests and syntax check**

Run: `node tests/nebiusClient.test.mjs && node --check src/llm/nebiusClient.js`

Expected: `nebiusClient tests passed` and exit 0.

- [ ] **Step 5: Commit the isolated client**

```bash
git add src/llm/nebiusClient.js tests/nebiusClient.test.mjs
git commit -m "feat: add Nebius Token Factory client"
```

---

### Task 2: Configuration and Reasoning Provider Priority

**Files:**
- Modify: `src/config/env.js`
- Modify: `src/analysis/pipeline.js`
- Create: `tests/nebiusReasoningProvider.test.mjs`

**Interfaces:**
- Consumes: `callNebius(...)` from Task 1.
- Produces: exported `callNebiusWithFailover({...})` and `callReasoningProvider({...}, dependencies?)`.
- `callReasoningProvider` returns the existing normalized response plus `provider`, `model`, `attemptedModels`, and `modelFailures`.

- [ ] **Step 1: Add failing configuration and orchestration tests**

Create `tests/nebiusReasoningProvider.test.mjs`. Use a temporary directory with a synthetic `.env` to assert `loadConfig()` returns:

```js
{
  nebiusApiKey: "test-nebius-key",
  nebiusBaseUrl: "https://api.tokenfactory.nebius.com/v1",
  nebiusModel: "nvidia/nemotron-3-super-120b-a12b",
  nebiusFallbackModels: ["nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"]
}
```

In the same file, import `callNebiusWithFailover` and `callReasoningProvider`. Add these exact behavioral cases using injected async functions and an ordered `calls` array:

```js
// Invalid first Nebius model advances to the second model.
assert.deepEqual(calls, ["nvidia/first", "nvidia/second"]);
assert.equal(result.provider, "nebius");
assert.equal(result.model, "nvidia/second");
assert.match(result.modelFailures[0].error, /Invalid strategic output/);

// Provider priority: a successful Nebius call means Gemini/OpenRouter are never called.
assert.deepEqual(providerCalls, ["nebius"]);

// Nebius failure falls through to Gemini and carries the sanitized Nebius failure.
assert.deepEqual(providerCalls, ["nebius", "gemini"]);
assert.equal(result.provider, "gemini");
assert.equal(result.modelFailures[0].provider, "nebius");

// Missing Nebius key skips Nebius without calling it and preserves Gemini behavior.
assert.deepEqual(providerCalls, ["gemini"]);
```

The injected provider functions must return existing response shapes such as `{ text: "Check.", model: "...", modelFailures: [] }`; none may call the network.

- [ ] **Step 2: Run the new test and verify missing exports/configuration failures**

Run: `node tests/nebiusReasoningProvider.test.mjs`

Expected: FAIL because the Nebius configuration fields and pipeline exports do not exist.

- [ ] **Step 3: Add Nebius configuration**

In the object returned by `loadConfig()` in `src/config/env.js`, add:

```js
nebiusApiKey: get("NEBIUS_API_KEY"),
nebiusBaseUrl: get("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1"),
nebiusModel: get("NEBIUS_MODEL", "nvidia/nemotron-3-super-120b-a12b"),
nebiusFallbackModels: getList(
  "NEBIUS_FALLBACK_MODELS",
  "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
),
```

- [ ] **Step 4: Add the Nebius model loop**

Import `callNebius` in `src/analysis/pipeline.js`. Add `orderedNebiusModels(config)` using the existing `uniqueModels` helper. Implement `callNebiusWithFailover` with the same validation semantics as `callGeminiWithFailover`, but pass `baseUrl`, return `provider: "nebius"`, prefix attempted models as `nebius:${model}`, and throw a summary that never contains the API key.

Use this signature so tests can inject the model transport:

```js
export async function callNebiusWithFailover({
  models,
  apiKey,
  baseUrl,
  systemInstruction,
  prompt,
  temperature,
  validate = null,
  callModel = callNebius,
})
```

- [ ] **Step 5: Put Nebius ahead of existing providers**

Export `callReasoningProvider` and give it a second optional argument:

```js
export async function callReasoningProvider(
  { config, systemInstruction, prompt, temperature, validate = null },
  {
    callNebiusProvider = callNebiusWithFailover,
    callGeminiProvider = callGeminiWithFailover,
    callOpenRouterProvider = callOpenRouterWithFailover,
  } = {},
)
```

When `config.nebiusApiKey` is truthy, call `callNebiusProvider` first with the ordered Nebius models. Return immediately on valid success. On failure, append `{ provider: "nebius", error: error.message }`; then execute the existing Gemini and OpenRouter logic unchanged through the injected function names. Merge earlier provider failures into the successful response's `modelFailures`.

- [ ] **Step 6: Run focused and existing provider tests**

Run:

```bash
node tests/nebiusReasoningProvider.test.mjs
node tests/nebiusClient.test.mjs
node tests/reasoningFailoverValidation.test.mjs
node tests/strategicOutputValidation.test.mjs
```

Expected: all four scripts print their `tests passed` message and exit 0.

- [ ] **Step 7: Commit provider orchestration**

```bash
git add src/config/env.js src/analysis/pipeline.js tests/nebiusReasoningProvider.test.mjs
git commit -m "feat: prioritize Nemotron for strategic reasoning"
```

---

### Task 3: Truthful Health and UI Attribution

**Files:**
- Create: `public/providerAttribution.js`
- Create: `tests/providerAttribution.test.cjs`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `src/server/server.js`
- Modify: `tests/resultsLayout.test.cjs`

**Interfaces:**
- Produces browser global and CommonJS export `PokerCoachProviderAttribution`.
- Produces `attributionForResult(result) -> { label, detail } | null`.

- [ ] **Step 1: Write failing attribution tests**

Create `tests/providerAttribution.test.cjs`:

```js
const assert = require("node:assert/strict");
const { attributionForResult } = require("../public/providerAttribution.js");

assert.deepEqual(
  attributionForResult({ provider: "nebius", model: "nvidia/nemotron-3-super-120b-a12b" }),
  {
    label: "Powered by NVIDIA Nemotron via Nebius Token Factory",
    detail: "nvidia/nemotron-3-super-120b-a12b",
  },
);
assert.equal(attributionForResult({ provider: "gemini", model: "gemini-2.5-flash" }), null);
assert.equal(attributionForResult({ provider: "openrouter" }), null);
assert.equal(attributionForResult(null), null);

console.log("providerAttribution tests passed");
```

Extend `tests/resultsLayout.test.cjs` to assert that `public/index.html` loads `providerAttribution.js` before `app.js`, and that `public/app.js` no longer hard-codes `Gemini reasoning` or `Gemini reasoning is unavailable` in the main recommendation panel.

- [ ] **Step 2: Run tests and verify they fail**

Run: `node tests/providerAttribution.test.cjs && node tests/resultsLayout.test.cjs`

Expected: FAIL because the helper and script tag do not exist.

- [ ] **Step 3: Implement the pure attribution helper**

Create `public/providerAttribution.js` using the project's existing UMD-style browser helpers:

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PokerCoachProviderAttribution = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function attributionForResult(result) {
    if (result?.provider !== "nebius") return null;
    return {
      label: "Powered by NVIDIA Nemotron via Nebius Token Factory",
      detail: result.model || "NVIDIA Nemotron",
    };
  }
  return { attributionForResult };
});
```

- [ ] **Step 4: Wire accurate attribution into the UI**

Load `providerAttribution.js` immediately before `app.js` in `public/index.html`. Bind the global near the other UI model globals in `public/app.js`:

```js
const PROVIDER_ATTRIBUTION = typeof window !== "undefined"
  ? window.PokerCoachProviderAttribution
  : null;
```

Update `modelTrailHtml(result)` to retain its existing model trail and append an escaped `.provider-attribution` paragraph only when `attributionForResult(result)` returns a value. Replace the main panel's `Gemini reasoning` label with `AI reasoning`, and replace its failure copy with `AI reasoning is unavailable`. Replace the Harrington error sentence claiming the section “uses Gemini” with provider-neutral wording.

- [ ] **Step 5: Add non-secret health fields**

In `/api/health`, add:

```js
hasNebiusKey: Boolean(config.nebiusApiKey),
nebiusBaseUrl: config.nebiusBaseUrl,
nebiusModel: config.nebiusModel,
nebiusFallbackModels: config.nebiusFallbackModels,
```

Do not return `nebiusApiKey` or any partial/redacted form of it. Change the generic `model` field to the currently preferred reasoning model without changing the existing import-model fields.

- [ ] **Step 6: Run focused UI and server checks**

Run:

```bash
node tests/providerAttribution.test.cjs
node tests/resultsLayout.test.cjs
node --check public/providerAttribution.js
node --check public/app.js
node --check src/server/server.js
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit the attribution slice**

```bash
git add public/providerAttribution.js public/index.html public/app.js src/server/server.js tests/providerAttribution.test.cjs tests/resultsLayout.test.cjs
git commit -m "feat: show Nebius Nemotron attribution"
```

---

### Task 4: Explicit Live Smoke Test and Documentation

**Files:**
- Create: `scripts/nebius_smoke.mjs`
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `LLM_ARCHITECTURE.md`

**Interfaces:**
- Consumes: `loadConfig(rootDir)` and `callNebius(...)`.
- Produces: `npm run smoke:nebius`, an explicit credit-consuming diagnostic that prints provider, model, token usage, and a short response but never the key.

- [ ] **Step 1: Write the smoke script with explicit safeguards**

Create `scripts/nebius_smoke.mjs`:

```js
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/config/env.js";
import { callNebius } from "../src/llm/nebiusClient.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig(rootDir);
if (!config.nebiusApiKey) throw new Error("NEBIUS_API_KEY is not configured.");

const response = await callNebius({
  apiKey: config.nebiusApiKey,
  baseUrl: config.nebiusBaseUrl,
  model: config.nebiusModel,
  temperature: 0,
  systemInstruction: "You are a concise poker analysis connectivity check.",
  prompt: "Reply with exactly: Nebius Nemotron connection verified",
});

console.log(JSON.stringify({
  provider: "nebius",
  model: config.nebiusModel,
  text: response.text,
  usage: response.completion.usageMetadata,
}, null, 2));
```

Do not add this script to `npm test` or `npm run check`; it must remain opt-in because it consumes Token Factory credits.

- [ ] **Step 2: Add package commands and checks**

Add `"smoke:nebius": "node scripts/nebius_smoke.mjs"`. Extend `check` with syntax checks for `public/providerAttribution.js`, `src/llm/nebiusClient.js`, and `scripts/nebius_smoke.mjs`, followed by the three new offline tests. Preserve every existing check and test command.

- [ ] **Step 3: Document safe environment configuration**

Add to `.env.example`:

```text
NEBIUS_API_KEY=put-your-nebius-token-factory-key-here
NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1
NEBIUS_MODEL=nvidia/nemotron-3-super-120b-a12b
NEBIUS_FALLBACK_MODELS=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B
```

Ensure the real `.env` remains ignored and unstaged.

- [ ] **Step 4: Update public documentation**

Update `README.md` with:

- A runtime diagram showing browser → PokerCoach server → Token Factory → NVIDIA Nemotron.
- Local configuration instructions for the four Nebius variables.
- Provider order and an explicit statement that screenshot import still uses the existing Gemini/OpenRouter vision path.
- `npm run check` and `npm run smoke:nebius` instructions, marking the latter as a live credit-consuming request.
- A `## 2026 Nebius x NVIDIA Hackathon Update` section stating that the project predated the submission period and listing the new Token Factory client, Nemotron-primary reasoning, validation/failover, accurate attribution, tests, and documentation.
- Official links to the hackathon requirements and Token Factory API documentation.

Replace the outdated Gemini-only flow in `LLM_ARCHITECTURE.md` with the implemented provider order while retaining the screenshot-import distinction.

- [ ] **Step 5: Run the complete offline verification suite**

Run: `npm run check`

Expected: all syntax checks and offline test scripts exit 0 without contacting Token Factory.

- [ ] **Step 6: Inspect the staged diff for secret leakage before the live test**

Run:

```bash
git diff --check
git status --short
git diff -- . ':!.env'
```

Expected: `.env` is absent from status and diff; no actual token beginning with `v1.` appears in tracked changes.

- [ ] **Step 7: Run the explicit live Token Factory smoke test**

Run: `npm run smoke:nebius`

Expected: JSON reports `provider: "nebius"`, the configured NVIDIA model, non-empty text, and usage metadata. The API key is not printed.

- [ ] **Step 8: Start the server and verify non-secret health output**

Run: `npm run dev`

In a second terminal, run:

```bash
curl -s http://localhost:4175/api/health
```

Expected: `hasNebiusKey` is `true`, `nebiusModel` is an NVIDIA model, and the response contains no API key. Stop the development server after the check.

- [ ] **Step 9: Perform the manual strategic-analysis acceptance check**

Open `http://localhost:4175`, enter one normal poker spot, and run analysis. Verify the returned result shows `Powered by NVIDIA Nemotron via Nebius Token Factory` and the model trail begins with `nebius:`. Screenshot import behavior should remain unchanged.

- [ ] **Step 10: Commit documentation and verification tooling**

```bash
git add .env.example README.md LLM_ARCHITECTURE.md package.json scripts/nebius_smoke.mjs
git commit -m "docs: document Nebius hackathon migration"
```

---

## Final Verification

- [ ] Run `npm run check` and confirm exit 0.
- [ ] Run `npm run smoke:nebius` and confirm a real Nemotron response.
- [ ] Run `git status --short` and confirm only pre-existing unrelated user files remain untracked.
- [ ] Review the final branch diff against `bcd80c5` and confirm it contains no screenshot-provider, solver, hosting, or unrelated poker changes.
- [ ] Confirm the real `.env` and API key are absent from every commit.
