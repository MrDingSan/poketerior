# Strategic LLM Grounding and Output Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground Harrington and PokerSkill prose in deterministic Hero hand facts and prevent repetitive, truncated, or structurally incomplete model output from reaching the UI.

**Architecture:** Add two focused server-side modules: one derives authoritative Hero hand/draw facts, and one validates provider prose. The existing pipeline will sanitize nested local-range data, inject hand facts into strategic prompts, and pass a validator into model failover so invalid output advances to the next configured model. The Gemini adapter will preserve compact completion metadata for validation and debug logs.

**Tech Stack:** Node.js ES modules, built-in `node:assert`, Gemini `generateContent`, existing HTTP server and browser client.

## Global Constraints

- Do not restore local equity, EV, confluence, combo counts, range conclusions, or baseline recommendations as strategic evidence.
- Only validated prose may reach the browser.
- Preserve the existing provider/model failover order and OpenRouter fallback.
- Add no runtime dependency.
- Use test-first red/green cycles for every production behavior.
- Preserve unrelated dirty-worktree changes.

---

### Task 1: Deterministic Hero Hand Facts

**Files:**
- Create: `src/analysis/handFacts.js`
- Create: `tests/handFacts.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `deriveHeroHandFacts({ heroHand: string, board: string }): HeroHandFacts`
- Produces: `{ madeHand, overcards, directStraightDraw, directFlushDraw, backdoorStraightDraw, backdoorFlushDraw, summary }`

- [ ] **Step 1: Write failing hand-fact tests**

Add cases proving:

```js
assert.deepEqual(
  deriveHeroHandFacts({ heroHand: "Ah Jh", board: "Tc 9c 4s" }),
  {
    madeHand: "ace-high",
    overcards: ["A", "J"],
    directStraightDraw: "none",
    directFlushDraw: "none",
    backdoorStraightDraw: true,
    backdoorFlushDraw: false,
    summary: "Ace-high with two overcards; no direct straight draw; no direct flush draw; backdoor straight possibilities only.",
  },
);
```

Also assert genuine examples: `Ah Jd` on `Tc 9c 2s` is a gutshot only when a single rank completes a five-card straight (it should remain `none` here), `8h 7d` on `6c 5s Kd` is open-ended, `Ah Qh` on `Th 4h 2c` is a flush draw, and a completed pair is labeled as a pair.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node tests/handFacts.test.mjs`

Expected: failure because `src/analysis/handFacts.js` does not exist.

- [ ] **Step 3: Implement the minimal evaluator**

Parse normalized cards, derive rank/suit counts, find the best made-hand category needed for prompt grounding, and enumerate unseen single-card ranks to classify direct straight draws. Treat flop backdoors separately: they require two future cards and must never be labeled direct draws.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node tests/handFacts.test.mjs`

Expected: `handFacts tests passed`.

- [ ] **Step 5: Add the focused test to `npm run check`**

Insert `node --check src/analysis/handFacts.js` and `node tests/handFacts.test.mjs` into the existing check chain.

---

### Task 2: Strategic Prompt Grounding and Sanitization

**Files:**
- Modify: `src/analysis/pipeline.js`
- Modify: `tests/strategicPromptSanitization.test.mjs`

**Interfaces:**
- Consumes: `deriveHeroHandFacts({ heroHand, board })`
- Produces: Harrington and PokerSkill prompts containing `Authoritative Hero hand facts JSON` and sanitized strategic math without `rangeHistory`.

- [ ] **Step 1: Add failing prompt assertions**

Extend `unstableMath` with a nested `rangeHistory` combo snapshot and assert:

```js
assert.equal(Object.hasOwn(sanitized, "rangeHistory"), false);
assert.match(harringtonPrompt, /Authoritative Hero hand facts JSON/);
assert.match(harringtonPrompt, /"directStraightDraw": "none"/);
assert.match(pokerSkillPrompt, /"directStraightDraw": "none"/);
assert.doesNotMatch(harringtonPrompt, /finalComboList|liveCount|rangeHistory/);
```

Use a flop spot with `Ah Jh` on `Tc 9c 4s` so the regression matches the incident.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node tests/strategicPromptSanitization.test.mjs`

Expected: failure because `rangeHistory` remains and authoritative hand facts are absent.

- [ ] **Step 3: Implement minimal prompt integration**

Import `deriveHeroHandFacts`, add `rangeHistory` to `STRATEGIC_MATH_OMIT_KEYS`, compute facts inside both prompt builders, and insert:

```text
Authoritative Hero hand facts JSON:
{...}

These facts are deterministic. Do not recalculate, contradict, or upgrade backdoor possibilities into direct draws.
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `node tests/handFacts.test.mjs && node tests/strategicPromptSanitization.test.mjs`

Expected: both tests pass.

---

### Task 3: Strategic Output Validation

**Files:**
- Create: `src/analysis/strategicOutputValidation.js`
- Create: `tests/strategicOutputValidation.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `validateStrategicOutput({ text, format, completion }): { valid: boolean, reasons: string[] }`
- `format` is `"harrington" | "generic"`.
- `completion` is `{ finishReason?: string | null }`.

- [ ] **Step 1: Write failing validator tests**

Use the exact incident fragment repeated at least 12 times and assert a repetition reason. Add separate tests for:

```js
validateStrategicOutput({ text: validHarrington, format: "harrington", completion: { finishReason: "STOP" } }).valid === true
validateStrategicOutput({ text: repeatedIncident, format: "harrington", completion: { finishReason: "MAX_TOKENS" } }).valid === false
validateStrategicOutput({ text: missingRecommendation, format: "harrington", completion: { finishReason: "STOP" } }).valid === false
validateStrategicOutput({ text: normalPokerProse, format: "generic", completion: { finishReason: "STOP" } }).valid === true
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node tests/strategicOutputValidation.test.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Implement conservative validation**

Normalize whitespace and detect repeated 4-to-16-word fragments occurring at least eight times. Reject known non-success finish reasons except absent/`STOP`. For Harrington, require case-insensitive headings or labels for Situation, Key Evidence, Candidate Actions, Recommendation, and Caveats. Reject output ending without sentence/markdown punctuation when the finish reason is absent or non-success.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `node tests/strategicOutputValidation.test.mjs`

Expected: `strategicOutputValidation tests passed`.

- [ ] **Step 5: Add validator checks to `npm run check`**

Insert `node --check src/analysis/strategicOutputValidation.js` and `node tests/strategicOutputValidation.test.mjs` into the existing check chain.

---

### Task 4: Gemini Metadata and Validated Failover

**Files:**
- Modify: `src/llm/geminiClient.js`
- Modify: `src/analysis/pipeline.js`
- Create: `tests/reasoningFailoverValidation.test.mjs`
- Modify: `package.json`

**Interfaces:**
- `callGemini()` additionally returns `completion: { finishReason, safetyRatings, usageMetadata }`.
- Export a testable `callGeminiWithFailover({ ..., callModel?, validate? })` where `callModel` defaults to `callGemini` and `validate` defaults to accepting output.
- Validation failures append `{ model, error }` to `modelFailures` and continue to the next model.

- [ ] **Step 1: Write failing failover tests**

Inject a `callModel` function returning the repeated incident for model one and valid Harrington prose for model two. Inject `validate` using `validateStrategicOutput`. Assert model two is selected and model one appears in `modelFailures` with a repetition or completion reason.

Add a Gemini client test using a temporary replacement for `globalThis.fetch` that returns candidate metadata, then assert `finishReason` and `usageMetadata` are preserved.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `node tests/reasoningFailoverValidation.test.mjs`

Expected: failure because failover is not exported/injectable and completion metadata is absent.

- [ ] **Step 3: Preserve compact Gemini completion metadata**

Map `data.candidates[0].finishReason`, `data.candidates[0].safetyRatings`, and `data.usageMetadata` into the `completion` return property.

- [ ] **Step 4: Integrate validation into model failover**

After each provider response, call the supplied validator. If invalid, push a model failure using `Invalid strategic output: ${reasons.join("; ")}` and continue. Do not change transport-error failover behavior.

- [ ] **Step 5: Apply strict Harrington validation and generic PokerSkill validation**

`runHarringtonAnalysis` passes a validator with `format: "harrington"`; `runPokerSkillAnalysis` passes `format: "generic"`. Include accepted `completion` in each endpoint's debug object so analysis logs retain finish/token details.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `node tests/reasoningFailoverValidation.test.mjs && node tests/strategicOutputValidation.test.mjs && node tests/strategicPromptSanitization.test.mjs`

Expected: all focused tests pass.

- [ ] **Step 7: Add the failover regression test to `npm run check`**

Insert `node tests/reasoningFailoverValidation.test.mjs` into the existing check chain.

---

### Task 5: Full Verification and Local Redeployment

**Files:**
- Verify all files above.
- Do not modify unrelated files.

**Interfaces:**
- Produces: healthy detached server at `http://localhost:4175` serving the verified code.

- [ ] **Step 1: Run the complete verification suite**

Run: `npm run check`

Expected: exit code 0 with all existing and new regression tests passing.

- [ ] **Step 2: Inspect the scoped diff**

Run:

```bash
git diff --check
git diff -- src/analysis/handFacts.js src/analysis/strategicOutputValidation.js src/analysis/pipeline.js src/llm/geminiClient.js tests/handFacts.test.mjs tests/strategicOutputValidation.test.mjs tests/reasoningFailoverValidation.test.mjs tests/strategicPromptSanitization.test.mjs package.json
```

Expected: no whitespace errors and no restoration of removed unstable strategic fields.

- [ ] **Step 3: Restart the detached server safely**

Resolve the exact current listener PID on TCP 4175, stop only the `pokercoach4175` screen session and that exact PID, then start:

```bash
screen -dmS pokercoach4175 /bin/zsh -lc 'cd /Users/kevinling0218/Documents/PokerCoach && exec /Users/kevinling0218/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node src/server/server.js'
```

- [ ] **Step 4: Verify deployment**

Run `curl -fsS http://localhost:4175/api/health`, verify a new listener PID exists, and verify `screen -ls` reports the detached `pokercoach4175` session.

- [ ] **Step 5: Report the outcome**

State the root fix, focused regression coverage, complete check result, new server PID, and health result. Do not claim the model's future poker recommendation is predetermined; claim only that deterministic facts and output safeguards are active.
