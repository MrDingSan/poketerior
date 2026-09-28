# Screenshot Identity and Action Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent inconsistent screenshot extractions from turning every action into a Hero decision, repair identity/action data with a targeted vision pass when possible, and safely suppress decision points otherwise.

**Architecture:** Add a pure imported-action consistency module, use its findings to trigger focused bottom-seat and targeted action extraction in the server pipeline, and expose a structured unsafe-attribution state to the client. The UI continues showing editable hand data but builds no analysis buttons from unsafe action data. All repair inputs and decisions are recorded in the existing vision debug log.

**Tech Stack:** Node.js ES modules, browser JavaScript, Express pipeline, Gemini/OpenRouter vision failover, `node:assert`, Sharp.

## Global Constraints

- Do not reject an import solely because action attribution is unsafe.
- Never render Hero/Villain decision points from actions that still fail consistency checks after repair.
- Exclude `return`/refund rows from poker decision actions.
- Preserve raw broad output, targeted repair output, repair decisions, warnings, and final hand in debug logs.
- Implement every production change test-first and commit each independently passing task.

---

### Task 1: Pure identity and action consistency validation

**Files:**
- Create: `src/analysis/importActionConsistency.js`
- Create: `tests/importActionConsistency.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `validateImportedActionConsistency(hand) -> { safe: boolean, issues: Array<{ code, street, actor?, message }> }`
- Produces: `stripNonDecisionActions(hand) -> hand`

- [ ] **Step 1: Write the failing regression tests**

Create tests using the reported corrupted extraction: `xoixo68` is assigned flop `bet 8.7` then `call 8.7`, all postflop actions use the same actor, and river contains `return`. Assert issue codes `SELF_RESPONSE`, `COLLAPSED_POSTFLOP_ACTORS`, and removal of `return`. Add a valid control where one actor checks on turn and bets on river, which must remain safe.

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/importActionConsistency.test.mjs`

Expected: FAIL because `src/analysis/importActionConsistency.js` does not exist.

- [ ] **Step 3: Implement the minimal pure validator**

Normalize actor identities case-insensitively. Detect an aggressive action (`bet`, `raise`, `allin`) followed on the same street by a response (`call`, `fold`, `raise`, `allin`) from the same actor. Detect collapsed actors only when response semantics or multiple player records prove that distinct actors are required. Report actor-position conflicts against `hand.players`. Return a cloned hand from `stripNonDecisionActions` with `return`, `refund`, and uncalled-return aliases removed.

- [ ] **Step 4: Run focused and full tests**

Run: `node tests/importActionConsistency.test.mjs && npm run check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/analysis/importActionConsistency.js tests/importActionConsistency.test.mjs package.json
git commit -m "fix: detect unsafe imported action attribution"
```

### Task 2: Focused verification and targeted identity/action repair

**Files:**
- Modify: `src/analysis/importRepair.js`
- Modify: `src/analysis/pipeline.js`
- Create: `tests/importActionRepair.test.mjs`
- Modify: `tests/focusedHeroPrompt.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `validateImportedActionConsistency(hand)` and `stripNonDecisionActions(hand)` from Task 1.
- Produces: `shouldVerifyHeroHandWithFocusedVision(hand, { actionIssues, imageShape }) -> boolean`
- Produces: `buildFocusedActionRepairPrompt() -> string`
- Produces: `applyFocusedActionRepair(hand, repair) -> { hand, accepted, reason, issues }`

- [ ] **Step 1: Write failing verification-trigger tests**

Assert that an `Unknown` site with `SELF_RESPONSE` triggers focused bottom-seat verification, while a normal unsupported screenshot without anomalies does not. Assert the targeted prompt requires bottom-seat identity, every visible player name/position, chronological actions, and omission of return/refund rows.

- [ ] **Step 2: Run tests and verify RED**

Run: `node tests/focusedHeroPrompt.test.mjs && node tests/importActionRepair.test.mjs`

Expected: FAIL because anomaly-aware verification and action repair do not exist.

- [ ] **Step 3: Add targeted repair fixtures and acceptance tests**

Use a repair object representing the source screenshot: bottom player `dingsanpro`/SB, opponent `xoixeo68`/BTN, and flop/turn/river actions in correct chronological order. Assert merging adds the omitted bottom player, replaces corrupted action actors, excludes the return row, selects `dingsanpro` as Hero, and passes consistency validation. Assert a repair that still has self-response is rejected without replacing the broad actions.

- [ ] **Step 4: Implement anomaly-aware focused verification and merge**

Extend focused verification eligibility with consistency issues and image shape rather than trusting the site string alone. Add a targeted prompt and provider-failover call following the existing broad/focused patterns. Merge only identity, player, hero-card, and street-action fields after validating the repair. Retain reliable broad metadata and normalized board fields.

- [ ] **Step 5: Integrate repair into `importHandFromScreenshot`**

Strip non-decisions, validate broad actions, run bottom verification when required, run targeted action repair when unsafe, and validate again. Return `actionAttribution: { safe, issues, repairAttempted, repairAccepted, reason }`. Provider failure must produce safe fallback state rather than HTTP 500.

- [ ] **Step 6: Run focused and full tests**

Run: `node tests/focusedHeroPrompt.test.mjs && node tests/importActionRepair.test.mjs && npm run check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/analysis/importRepair.js src/analysis/pipeline.js tests/focusedHeroPrompt.test.mjs tests/importActionRepair.test.mjs package.json
git commit -m "fix: repair suspicious screenshot action identities"
```

### Task 3: Safe client fallback and decision suppression

**Files:**
- Modify: `public/app.js`
- Modify: `public/importDecisionModel.js`
- Modify: `public/styles.css`
- Create: `tests/unsafeImportAttributionUi.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: API `actionAttribution.safe` and `actionAttribution.issues` from Task 2.
- Produces: `decisionPointsForImportedHand(hand, selectedHero, { attributionSafe })`, returning `[]` when attribution is unsafe.

- [ ] **Step 1: Write a failing UI/model regression test**

Load the corrupted `xoixo68` hand with `actionAttribution.safe = false`. Assert the decision model returns zero points and source inspection confirms the UI warning copy is present: `Action attribution could not be verified. Decision analysis is disabled for this import.`

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/unsafeImportAttributionUi.test.cjs`

Expected: FAIL because unsafe attribution is ignored.

- [ ] **Step 3: Implement the safe fallback**

Preserve imported cards, board, players, and editable controls. Store `actionAttribution` on the imported hand. Render the warning above the decision section and return no derived action points while unsafe. Do not relabel or analyze inconsistent rows as Hero actions.

- [ ] **Step 4: Run focused and full tests**

Run: `node tests/unsafeImportAttributionUi.test.cjs && npm run check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/app.js public/importDecisionModel.js public/styles.css tests/unsafeImportAttributionUi.test.cjs package.json
git commit -m "fix: suppress decisions for unsafe screenshot attribution"
```

### Task 4: Debug logging, end-to-end regression, and runtime verification

**Files:**
- Modify: `src/analysis/visionDebug.js`
- Modify: `tests/visionDebugLogging.test.mjs`
- Modify: `tests/coinPokerHeroAttribution.test.mjs`

**Interfaces:**
- Consumes: targeted repair debug data and `actionAttribution` from Task 2.
- Produces debug fields: `focusedActionRepairRawVisionOutput`, `focusedActionRepairParsedOutput`, `focusedActionRepairProvider`, `focusedActionRepairModel`, `actionConsistencyIssues`, `focusedActionRepairDecision`, and `actionAttributionSafe`.

- [ ] **Step 1: Write failing debug-record tests**

Assert `buildVisionImportRecord` preserves full targeted raw output, parsed repair output, provider/model, issues, repair decision, and final safe flag without truncation.

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/visionDebugLogging.test.mjs`

Expected: FAIL because the new fields are absent.

- [ ] **Step 3: Implement debug serialization**

Copy the targeted repair fields from pipeline debug/result into every stored import record, including failed repair attempts. Do not remove existing broad or focused-hero fields.

- [ ] **Step 4: Add the reported-hand integration regression**

Extend the attribution regression fixture with the corrupted broad result and corrected targeted result. Assert the final Hero is bottom-seat `dingsanpro`, opponent actions remain opponent actions, and no `return` action survives. Also assert invalid targeted repair yields an editable unsafe import rather than throwing.

- [ ] **Step 5: Run all verification**

Run: `npm run check`

Expected: every syntax and regression test passes.

Restart the local service and verify:

```bash
screen -S pokercoach4175 -X quit || true
screen -dmS pokercoach4175 zsh -lc 'cd /Users/kevinling0218/Documents/PokerCoach && npm start'
curl -fsS http://localhost:4175/ >/dev/null
```

Expected: the HTTP check succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/analysis/visionDebug.js tests/visionDebugLogging.test.mjs tests/coinPokerHeroAttribution.test.mjs
git commit -m "test: cover screenshot identity repair diagnostics"
```
