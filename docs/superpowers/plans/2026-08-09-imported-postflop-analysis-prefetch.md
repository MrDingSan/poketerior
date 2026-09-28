# Imported Postflop Analysis Prefetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically run and cache the complete analysis bundle for the two imported post-flop decisions the user is most likely to open.

**Architecture:** Add a pure browser-compatible prefetch model that ranks eligible imported decisions and owns a sequential, deduplicated queue. Wire that model into the existing DOM-based analyzer with an import generation token: background work prepares the hidden manual analyzer, runs the existing full `analyze()` bundle, saves its existing snapshot, and never switches away from import mode. A click restores completed work or reveals the already-running analyzer instead of starting duplicate requests.

**Tech Stack:** Browser JavaScript, Node.js `assert`/`vm` regression tests, existing in-memory imported-analysis cache, existing analysis APIs.

## Global Constraints

- Prefetch at most two decisions per valid screenshot import.
- Prefetch only flop, turn, and river decisions.
- Run one full analysis bundle at a time.
- Preserve normal foreground behavior for manual analysis and non-prefetched points.
- Never reuse results after the import, selected Hero, cards, or action state changes.
- Do not add dependencies or persistent storage.

---

## File Structure

- Create `public/importAnalysisPrefetchModel.js`: pure candidate ranking and sequential queue state machine.
- Create `tests/importAnalysisPrefetchModel.test.cjs`: behavioral tests for eligibility, priority, limit, promotion, deduplication, and failure continuation.
- Create `tests/importAnalysisPrefetchWiring.test.cjs`: source-level integration checks for browser loading, automatic start, full-bundle reuse, click behavior, and invalidation.
- Modify `public/index.html`: load the prefetch model before `app.js` and update import guidance copy.
- Modify `public/app.js`: build candidates, manage import generations, run background jobs, expose button status, and reuse running/completed work.
- Modify `package.json`: include both new tests in `npm run check`.

### Task 1: Pure candidate ranking

**Files:**
- Create: `public/importAnalysisPrefetchModel.js`
- Create: `tests/importAnalysisPrefetchModel.test.cjs`

**Interfaces:**
- Consumes: normalized imported hand objects and `isHeroAction(hand, action, heroName)` supplied by `importDecisionModel.js`.
- Produces: `rankImportedPostflopCandidates(hand, heroName, isHeroAction, limit = 2)` returning `{ street, index, action, priority, betToPotRatio, order }[]`.

- [ ] **Step 1: Write the failing eligibility and ordering tests**

Create a hand containing preflop aggression, a flop first-to-act Hero check, a flop opponent call, a turn opponent bet followed by Hero call, and a river opponent all-in. Assert that preflop and the opponent call are absent, the all-in ranks first, the turn bet ranks second, and the result length is two:

```js
const ranked = model.rankImportedPostflopCandidates(hand, "Hero", isHeroAction);
assert.deepEqual(ranked.map(({ street, index }) => `${street}:${index}`), ["river:0", "turn:0"]);
assert.equal(ranked.length, 2);
```

Add separate fixtures asserting:

```js
assert.deepEqual(
  model.rankImportedPostflopCandidates(raiseAndBetHand, "Hero", isHeroAction)
    .map(({ action }) => action.action),
  ["raise", "bet"],
);
assert.deepEqual(
  model.rankImportedPostflopCandidates(twoBetHand, "Hero", isHeroAction)
    .map(({ betToPotRatio }) => betToPotRatio),
  [1.5, 0.5],
);
assert.deepEqual(
  model.rankImportedPostflopCandidates(tiedHeroActions, "Hero", isHeroAction, 2)
    .map(({ street, index }) => `${street}:${index}`),
  ["flop:0", "turn:0"],
);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/importAnalysisPrefetchModel.test.cjs`

Expected: FAIL because `public/importAnalysisPrefetchModel.js` or `rankImportedPostflopCandidates` does not exist.

- [ ] **Step 3: Implement the minimal ranking model**

Use a browser/global wrapper consistent with the other public models. Implement these exact helpers:

```js
const POSTFLOP_STREETS = ["flop", "turn", "river"];

function candidatePriority({ action, targetIsHero, firstActionOnStreet }) {
  if (!targetIsHero && action === "allin") return 0;
  if (!targetIsHero && action === "raise") return 1;
  if (!targetIsHero && action === "bet") return 2;
  if (targetIsHero && firstActionOnStreet) return 4;
  return 5;
}

function rankImportedPostflopCandidates(hand, heroName, isHeroAction, limit = 2) {
  // Flatten only post-flop streets, retain stable order, include Hero actions and
  // opponent bet/raise/allin actions, calculate amountBb / street.potBb when valid,
  // sort by priority then descending ratio then stable order, and slice to limit.
}
```

An opponent action is eligible only when it is `bet`, `raise`, or `allin`. A Hero action is eligible regardless of its recorded action because it represents the pre-action Hero decision. Treat missing or non-positive `potBb` as ratio `-1`, so known bet sizes sort ahead of unknown sizes within the bet class.

Export:

```js
global.PokerCoachImportAnalysisPrefetchModel = {
  rankImportedPostflopCandidates,
};
```

- [ ] **Step 4: Run the model test and verify GREEN**

Run: `node tests/importAnalysisPrefetchModel.test.cjs`

Expected: PASS with `import analysis prefetch ranking checks passed`.

- [ ] **Step 5: Commit the ranking model**

```bash
git add public/importAnalysisPrefetchModel.js tests/importAnalysisPrefetchModel.test.cjs
git commit -m "feat: rank imported analysis prefetch candidates"
```

### Task 2: Sequential deduplicated queue

**Files:**
- Modify: `public/importAnalysisPrefetchModel.js`
- Modify: `tests/importAnalysisPrefetchModel.test.cjs`

**Interfaces:**
- Consumes: queue entries `{ key, street, index }` and async `worker(entry)`.
- Produces: `createImportAnalysisPrefetchQueue({ worker, onStatusChange })` with `replace`, `promote`, `status`, `promiseFor`, and `cancel`.

- [ ] **Step 1: Write failing queue lifecycle tests**

Use deferred promises to prove only one worker starts at a time, duplicate keys are removed, and promotion changes the next queued entry:

```js
const queue = model.createImportAnalysisPrefetchQueue({ worker, onStatusChange });
queue.replace([
  { key: "allin", street: "river", index: 0 },
  { key: "bet", street: "turn", index: 0 },
  { key: "bet", street: "turn", index: 0 },
]);
assert.deepEqual(started, ["allin"]);
assert.equal(queue.status("allin"), "running");
assert.equal(queue.status("bet"), "queued");
assert.equal(queue.promiseFor("allin") instanceof Promise, true);
```

Add a three-entry fixture, call `queue.promote("third")`, resolve the first deferred job, and assert `third` starts second. Reject the promoted job and assert the remaining job still starts. Call `cancel()` while a job is running and assert its later resolution does not change a replacement generation's statuses.

- [ ] **Step 2: Run the queue tests and verify RED**

Run: `node tests/importAnalysisPrefetchModel.test.cjs`

Expected: FAIL because `createImportAnalysisPrefetchQueue` is undefined.

- [ ] **Step 3: Implement the minimal queue**

Implement the exact public shape:

```js
function createImportAnalysisPrefetchQueue({ worker, onStatusChange = () => {} }) {
  let generation = 0;
  let entries = [];
  let active = null;

  function replace(nextEntries) { /* cancel generation, dedupe by key, mark queued, pump */ }
  function promote(key) { /* move only queued entry to the front */ }
  function status(key) { /* return queued/running/completed/failed or null */ }
  function promiseFor(key) { /* return the entry's in-flight/completed promise or null */ }
  function cancel() { /* advance generation and clear queued state */ }
  async function pump() { /* run one worker; continue after resolve or reject */ }

  return { replace, promote, status, promiseFor, cancel };
}
```

The queue cannot abort network calls, so every worker completion must compare its captured generation before publishing `completed` or `failed`. Notify `onStatusChange({ key, status, entry })` for each real transition.

- [ ] **Step 4: Run the queue tests and verify GREEN**

Run: `node tests/importAnalysisPrefetchModel.test.cjs`

Expected: PASS, including failure-continuation and stale-generation assertions.

- [ ] **Step 5: Commit the queue**

```bash
git add public/importAnalysisPrefetchModel.js tests/importAnalysisPrefetchModel.test.cjs
git commit -m "feat: add imported analysis prefetch queue"
```

### Task 3: Browser wiring and import generation invalidation

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Create: `tests/importAnalysisPrefetchWiring.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `PokerCoachImportAnalysisPrefetchModel`, `PokerCoachImportDecisionModel`, `importedDecisionCacheState`, and existing `analyze`/snapshot functions.
- Produces: `startImportedAnalysisPrefetch()`, `cancelImportedAnalysisPrefetch()`, `runImportedPrefetchEntry(entry, generation)`, and per-button status rendering.

- [ ] **Step 1: Write failing browser wiring checks**

Assert that `public/index.html` loads `importAnalysisPrefetchModel.js` after the cache model and before `app.js`. Assert `public/app.js` contains:

```js
const IMPORT_ANALYSIS_PREFETCH_MODEL = typeof window !== "undefined"
  ? window.PokerCoachImportAnalysisPrefetchModel
  : null;
```

Check that successful `importScreenshotFile()` calls `startImportedAnalysisPrefetch()`, edits and Hero changes call `restartImportedAnalysisPrefetch()`, a new file import calls `cancelImportedAnalysisPrefetch()`, and `package.json` runs both new tests.

- [ ] **Step 2: Run the wiring test and verify RED**

Run: `node tests/importAnalysisPrefetchWiring.test.cjs`

Expected: FAIL because the model script and lifecycle wiring are absent.

- [ ] **Step 3: Load the model and create lifecycle state**

Add the script tag and these app-level fields:

```js
let importedPrefetchGeneration = 0;
let activeImportedPrefetchKey = null;
let activeImportedPrefetchMode = "background";
const importedAnalysisPrefetchQueue = IMPORT_ANALYSIS_PREFETCH_MODEL?.createImportAnalysisPrefetchQueue({
  worker: (entry) => runImportedPrefetchEntry(entry),
  onStatusChange: ({ key, status }) => renderImportedPrefetchStatus(key, status),
}) || null;
```

Implement `cancelImportedAnalysisPrefetch()` to increment the app generation, clear the active key, and cancel the model queue. Call it before clearing cache for a new screenshot, before applying changed imported cards, and before changing Hero ownership.

- [ ] **Step 4: Build stable entries and start the queue**

Implement `buildImportedPrefetchEntries()` by calling the pure ranker with `IMPORT_DECISION_MODEL.isHeroImportedAction`, constructing each decision context, deriving the rows and board without mutating visible controls, and creating the same logical state fields used by `importedDecisionCacheState()`.

Extract a pure `importedDecisionCacheStateFromValues({ street, index, heroName, heroPosition, villainPosition, heroHand, board, rows })` helper. Keep `importedDecisionCacheState()` as a DOM-reading adapter to it, so foreground and prefetch keys cannot drift.

Implement:

```js
function startImportedAnalysisPrefetch() {
  if (!importedAnalysisPrefetchQueue || !currentImportedCardValidity().valid) return;
  const generation = ++importedPrefetchGeneration;
  const entries = buildImportedPrefetchEntries().map((entry) => ({ ...entry, generation }));
  importedAnalysisPrefetchQueue.replace(entries);
}

function restartImportedAnalysisPrefetch() {
  cancelImportedAnalysisPrefetch();
  importedAnalysisCache?.clear();
  startImportedAnalysisPrefetch();
}
```

Start only after `renderImportedHand()` completes for a valid, safely attributed import. Invalid state leaves the queue empty.

- [ ] **Step 5: Run the wiring and existing cache tests**

Run:

```bash
node tests/importAnalysisPrefetchWiring.test.cjs
node tests/importAnalysisCacheModel.test.cjs
node tests/importAnalysisCacheWiring.test.cjs
```

Expected: all PASS.

- [ ] **Step 6: Commit lifecycle wiring**

```bash
git add public/index.html public/app.js package.json tests/importAnalysisPrefetchWiring.test.cjs
git commit -m "feat: start imported analysis prefetch after validation"
```

### Task 4: Reuse the complete existing analysis bundle safely

**Files:**
- Modify: `public/app.js`
- Modify: `tests/importAnalysisPrefetchWiring.test.cjs`

**Interfaces:**
- Consumes: prepared queue entries containing the decision context, cache state, cards, positions, board, and action rows.
- Produces: one cached `captureImportedAnalysisSnapshot()` per successfully prefetched point without switching out of import mode.

- [ ] **Step 1: Write failing full-bundle and reuse checks**

Add source assertions showing `runImportedPrefetchEntry()` invokes the existing `analyze` function with `{ background: true }`, and that `analyze` still constructs all five async panels plus the post-flop solver before saving the snapshot. Check `loadImportedDecision()` branches on all three relevant states:

```js
if (prefetchStatus === "completed") { /* restore cache */ }
if (prefetchStatus === "running") { /* reveal current work, no analyze call */ }
if (prefetchStatus === "queued") importedAnalysisPrefetchQueue.promote(cacheKey);
```

Assert the running branch uses `promiseFor(cacheKey)` and does not call a second `analyze()`.

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/importAnalysisPrefetchWiring.test.cjs`

Expected: FAIL because background execution and in-flight reuse are not implemented.

- [ ] **Step 3: Extract decision preparation from foreground loading**

Create `prepareImportedDecision(street, index, heroName)` returning:

```js
{
  street,
  index: Number(index),
  heroName,
  importedDecisionContext,
  heroPosition,
  villainPosition,
  heroHand,
  board,
  rowsByStreet,
  cacheState,
  cacheKey,
}
```

Create `applyPreparedImportedDecision(prepared)` to write those values into controls and action rows. Use both helpers from foreground loading and the prefetch worker.

- [ ] **Step 4: Add a background option to the existing analyzer**

Change the signature to:

```js
async function analyze(triggerButton = null, cacheState = null, importedDecisionContext = null, options = {})
```

Support `{ background: true, generation, cacheKey }`. Background analysis must:

- keep `currentMode` as `import` and never call `setMode("manual")`;
- use the same local calculation path and the same `Promise.all(asyncPanels)` list;
- save the snapshot only when `generation === importedPrefetchGeneration`;
- mark `activeImportedPrefetchKey` while running and clear it in `finally` only if it still owns that key;
- treat a foreground click on that same running key as adoption, not cancellation; and
- let an unrelated foreground analysis increment `analysisRequestId`, invalidating stale DOM writes without caching the partial background result.

Implement the worker:

```js
async function runImportedPrefetchEntry(entry) {
  if (entry.generation !== importedPrefetchGeneration) return;
  applyPreparedImportedDecision(entry.prepared);
  resetResultPanels();
  activeImportedPrefetchKey = entry.key;
  await analyze(null, entry.prepared.cacheState, entry.prepared.importedDecisionContext, {
    background: true,
    generation: entry.generation,
    cacheKey: entry.key,
  });
  if (!importedAnalysisCache.get(entry.prepared.cacheState)) {
    throw new Error("Imported analysis prefetch did not produce a complete snapshot.");
  }
}
```

- [ ] **Step 5: Reuse running work on click**

In `loadImportedDecision()`, prepare and apply the decision, then derive queue status from the stable key. Restore completed cache first. For `running`, call `setMode("manual")`, set the visible street, and await `promiseFor(key)` only to update the import status; do not invoke `analyze`. For `queued`, promote it, then run it normally only if it is still not running/completed after the current queue item finishes. A non-queued or failed point follows the existing foreground path.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
node tests/importAnalysisPrefetchModel.test.cjs
node tests/importAnalysisPrefetchWiring.test.cjs
node tests/importAnalysisCacheModel.test.cjs
node tests/importAnalysisCacheWiring.test.cjs
```

Expected: all PASS.

- [ ] **Step 7: Commit full-bundle reuse**

```bash
git add public/app.js tests/importAnalysisPrefetchWiring.test.cjs
git commit -m "feat: cache and reuse prefetched imported analysis"
```

### Task 5: Decision status UX and regression verification

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `tests/importAnalysisPrefetchWiring.test.cjs`

**Interfaces:**
- Consumes: queue lifecycle status keyed by imported decision cache key.
- Produces: non-blocking `Preparing`, `Ready`, and `Retry` button labels while preserving the original action label.

- [ ] **Step 1: Write failing status-copy checks**

Assert rendered import buttons include `data-prefetch-key`, retain their original label in `data-default-label`, and map statuses as follows:

```js
const PREFETCH_BUTTON_LABELS = {
  queued: "Preparing…",
  running: "Preparing…",
  completed: "Ready",
  failed: "Retry",
};
```

Assert import guidance says likely post-flop decisions are prepared automatically and that a failed background job does not overwrite `importStatus` with a blocking error.

- [ ] **Step 2: Run the wiring test and verify RED**

Run: `node tests/importAnalysisPrefetchWiring.test.cjs`

Expected: FAIL on missing status attributes or copy.

- [ ] **Step 3: Implement button status rendering**

When rendering decisions, compute the stable key if the point can be prepared and add it to the button. Implement `renderImportedPrefetchStatus(key, status)` to find only that button and update its text, `aria-busy`, and `title`. Do not disable queued or running buttons because clicking them must promote or adopt work.

Update the import dropzone paragraph to:

```html
<p>After extraction, likely post-flop decisions are prepared automatically while you review the hand.</p>
```

- [ ] **Step 4: Run the full regression suite**

Run: `npm run check`

Expected: exit 0 with every syntax and regression check passing.

- [ ] **Step 5: Perform a manual browser smoke test**

Run: `npm run dev`.

Import a valid screenshot containing at least three post-flop points and verify:

1. Exactly two buttons enter `Preparing…`.
2. The highest-priority all-in/raise/large-bet point runs first.
3. The app remains in screenshot-import mode while prefetch runs.
4. One point becomes `Ready`, and clicking it renders all analysis panels immediately.
5. Clicking the running point reveals its live progress without duplicate network requests.
6. Editing a card clears old readiness and starts a fresh queue.
7. A simulated failed analysis displays `Retry` and the second queued job still runs.

- [ ] **Step 6: Commit UX and verification changes**

```bash
git add public/index.html public/app.js tests/importAnalysisPrefetchWiring.test.cjs
git commit -m "feat: show imported analysis prefetch status"
```

### Task 6: Final verification and branch handoff

**Files:**
- Verify only; no planned production changes.

**Interfaces:**
- Consumes: all implementation commits.
- Produces: evidence that the approved specification is satisfied.

- [ ] **Step 1: Re-run focused behavioral tests**

Run:

```bash
node tests/importAnalysisPrefetchModel.test.cjs
node tests/importAnalysisPrefetchWiring.test.cjs
```

Expected: both PASS.

- [ ] **Step 2: Re-run the complete suite**

Run: `npm run check`

Expected: exit 0 with no syntax errors or regression failures.

- [ ] **Step 3: Inspect the final diff**

Run:

```bash
git status --short
git diff --check HEAD~4..HEAD
git log --oneline -6
```

Expected: only intended files changed, no whitespace errors, and the implementation commits are present.

- [ ] **Step 4: Hand off for review**

Summarize the ranking rules, sequential execution, cache reuse, invalidation behavior, automated test results, and manual smoke-test outcome. Do not claim completion unless every verification command succeeds.
