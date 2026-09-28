# Unified Manual and Screenshot Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Screenshot Import's detached decision list with an independently stateful, editable builder that uses the Manual Builder layout and analysis surfaces.

**Architecture:** Keep `manualSession` and `importSession` as separate application sessions behind one rendering contract. Convert normalized vision output into replayable preflop/postflop model state, select decisions as state-before-action snapshots, and bind every asynchronous analysis result to its originating session revision and decision key.

**Tech Stack:** Browser JavaScript (IIFE/global modules), semantic HTML, CSS, Node's built-in `assert`/`vm` test harness, existing screenshot and analysis APIs.

**Spec:** `docs/superpowers/specs/2026-09-14-unified-manual-and-screenshot-builder-design.md`

## Global Constraints

- Manual Builder and Screenshot Import analyze different hands and never copy, overwrite, or synchronize hand state.
- Both modes use the same UI layout and analysis types, but each owns its analysis content and lifecycle.
- Existing backend request routes and vision extraction behavior remain compatible.
- Quick Entry remains unavailable.
- Do not discard unrelated working-tree changes.
- Preserve the last successful imported hand when a replacement extraction fails.

---

### Task 1: Independent Hand Sessions and Request Ownership

**Files:**
- Create: `public/handSessionModel.js`
- Create: `tests/handSessionModel.test.cjs`
- Modify: `public/index.html`
- Modify: `package.json`

**Interfaces:**
- Produces: `createSession(source)`, `replaceHand(session, handState, metadata)`, `selectDecision(session, decision)`, `beginRequest(session, kind)`, `acceptResult(session, token, result)`, and `analysisCacheKey(session)` on `window.PokerCoachHandSessionModel`.
- A request token has `{ source, revision, decisionKey, kind, requestId }`; `acceptResult` returns an unchanged session when any ownership field is stale.

- [ ] **Step 1: Write the failing session-isolation tests**

Create tests proving that manual and screenshot sessions hold different hand objects, revisions increase only in the changed session, decision selection changes the cache key, and a token created before a hand edit is rejected.

```js
const manual = model.createSession("manual");
const imported = model.replaceHand(model.createSession("screenshot"), { id: "I-1" }, {});
const token = model.beginRequest(imported, "analysis").token;
const revised = model.replaceHand(imported, { id: "I-2" }, {});
assert.equal(model.acceptResult(revised, token, { recommendation: "Call" }).accepted, false);
assert.equal(manual.revision, 0);
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node tests/handSessionModel.test.cjs`
Expected: FAIL because `public/handSessionModel.js` does not exist.

- [ ] **Step 3: Implement the pure session model**

Use immutable plain objects. Generate request IDs with a module-local counter, serialize cache identity as `source:revision:decisionKey`, and store analysis under `analysisState.byDecision[decisionKey]`. Do not store DOM nodes or promises in sessions.

- [ ] **Step 4: Wire the module into the browser and test script**

Load `handSessionModel.js` before `app.js` in `public/index.html`; add the focused test to `npm run check`.

- [ ] **Step 5: Verify and commit**

Run: `node --check public/handSessionModel.js && node tests/handSessionModel.test.cjs`
Expected: PASS.

```bash
git add public/handSessionModel.js tests/handSessionModel.test.cjs public/index.html package.json
git commit -m "feat: isolate manual and screenshot hand sessions"
```

### Task 2: Normalize Screenshot Hands into Replayable Builder State

**Files:**
- Create: `public/importBuilderAdapter.js`
- Create: `tests/importBuilderAdapter.test.cjs`
- Modify: `public/preflopBuilderModel.js`
- Modify: `public/postflopBuilderModel.js`
- Modify: `public/index.html`
- Modify: `package.json`

**Interfaces:**
- Consumes: normalized import shape returned by `normalizeImportedHand()` and the public preflop/postflop model APIs.
- Produces: `fromImportedHand(hand, options)` returning `{ preflopState, postflopState, sourceHand, warnings, unresolved, actionIndex }`.
- `actionIndex` maps stable keys such as `flop:2` to `{ street, index, actor, recordedAction }`.

- [ ] **Step 1: Add representative adapter fixtures and failing tests**

Cover a six-max hand with blinds, an open, folds, a three-bet, a call, flop/turn/river bets and calls, Hero cards, board cards, and per-action warnings. Assert exact pot and stack units after replay and preservation of the original normalized source object.

```js
const converted = adapter.fromImportedHand(hand, { heroName: "Hero" });
assert.equal(converted.preflopState.potUnits, 38);
assert.deepEqual(Array.from(converted.postflopState.board.flop), ["Qh", "7s", "4h"]);
assert.equal(converted.actionIndex["turn:0"].actor, "MP");
assert.notEqual(converted.sourceHand, converted.postflopState);
```

- [ ] **Step 2: Run the adapter test and verify failure**

Run: `node tests/importBuilderAdapter.test.cjs`
Expected: FAIL because the adapter global is missing.

- [ ] **Step 3: Implement deterministic action conversion**

Map imported `raise` to the model's first-aggression representation, convert preflop bb to half-bb units and postflop bb to tenth-bb units, preserve dealt board order, and attach unresolved errors to stable field/action keys. Never fill a missing amount with a guessed legal size.

- [ ] **Step 4: Extend model replay only for valid imported sequences**

Add narrowly scoped model entry points if required:

```js
preflop.replayImportedState({ settings, heroPosition, heroCards, players, actions });
postflop.replayImportedHand({ preflopState, board, actionsByStreet });
```

These functions must call existing legality and accounting operations and return the first structured replay error instead of creating display-only state.

- [ ] **Step 5: Register, verify, and commit**

Run: `node --check public/importBuilderAdapter.js && node tests/importBuilderAdapter.test.cjs && node tests/preflopBuilderModel.test.cjs && node tests/postflopBuilderModel.test.cjs && node tests/postflopBuilderFlow.test.cjs`
Expected: PASS.

```bash
git add public/importBuilderAdapter.js public/preflopBuilderModel.js public/postflopBuilderModel.js tests/importBuilderAdapter.test.cjs public/index.html package.json
git commit -m "feat: convert screenshot imports into builder state"
```

### Task 3: State-Before-Action Decision Snapshots

**Files:**
- Modify: `public/importDecisionModel.js`
- Create: `tests/importDecisionSnapshot.test.cjs`
- Modify: `tests/importDecisionModel.test.cjs`
- Modify: `tests/multiwayImportedDecision.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: adapter result and stable action key.
- Produces: `decisionSnapshotForAction(convertedHand, actionKey)` returning `{ decisionKey, owner, street, stateBefore, recordedAction, legalActions, warnings }`.

- [ ] **Step 1: Write failing Hero and opponent decision tests**

Assert that selecting a Hero call omits that call from `stateBefore`; selecting an opponent bet makes that opponent the decision owner; prior-street history remains present; folds/blinds are replayed but are not offered as selectable analysis points.

- [ ] **Step 2: Run focused decision tests and verify failure**

Run: `node tests/importDecisionSnapshot.test.cjs`
Expected: FAIL because `decisionSnapshotForAction` is undefined.

- [ ] **Step 3: Implement stable decision selection**

Replay through the action immediately preceding the target, derive legal actions from the appropriate model, include the target as `recordedAction`, and return an attribution warning rather than silently assigning an ambiguous action to Hero.

- [ ] **Step 4: Keep current attribution behavior compatible**

Run existing import decision and multiway tests; change existing functions only where the new explicit `owner` supersedes implicit Hero ownership.

- [ ] **Step 5: Verify and commit**

Run: `node tests/importDecisionSnapshot.test.cjs && node tests/importDecisionModel.test.cjs && node tests/multiwayImportedDecision.test.cjs`
Expected: PASS.

```bash
git add public/importDecisionModel.js tests/importDecisionSnapshot.test.cjs tests/importDecisionModel.test.cjs tests/multiwayImportedDecision.test.cjs package.json
git commit -m "feat: derive imported state before any action"
```

### Task 4: Extract a Reusable Hand Workspace Without Manual Regressions

**Files:**
- Create: `public/handWorkspaceView.js`
- Create: `tests/handWorkspaceView.test.cjs`
- Modify: `public/preflopBuilderView.js`
- Modify: `public/postflopBuilderView.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `tests/preflopBuilderWiring.test.cjs`
- Modify: `tests/postflopBuilderWiring.test.cjs`

**Interfaces:**
- Produces: `createHandWorkspaceView({ root, source, preflop, postflop, selectedDecision, warnings, callbacks })` with `setSession(viewModel)`, `getVisibleStreet()`, `destroy()`.
- `callbacks` contains `onSelectDecision`, `onEditAction`, `onEditCards`, `onAnalyze`, and `onContinueStreet`.

- [ ] **Step 1: Write failing structural and callback tests**

Assert that both mode containers carry `data-hand-workspace`, timeline buttons expose `data-decision-key`, and selecting a timeline action calls `onSelectDecision` without mutating either model directly.

- [ ] **Step 2: Run wiring tests and verify failure**

Run: `node tests/handWorkspaceView.test.cjs && node tests/preflopBuilderWiring.test.cjs && node tests/postflopBuilderWiring.test.cjs`
Expected: FAIL on missing shared workspace module/markup.

- [ ] **Step 3: Extract presentation in small seams**

Move reusable card markup, street navigator markup, timeline selection state, and analysis-point accessibility labels into `handWorkspaceView.js`. Keep betting-specific state transitions in the existing builder views/models. Both mode roots must call the shared renderer; do not clone the full Manual Builder markup.

- [ ] **Step 4: Preserve manual behavior and styling**

Keep existing IDs behind each manual view where `app.js` still depends on them. Add source-scoped classes only for import badges, warnings, and upload affordances. Verify keyboard buttons and dialog labels survive extraction.

- [ ] **Step 5: Verify and commit**

Run: `node --check public/handWorkspaceView.js && node --check public/preflopBuilderView.js && node --check public/postflopBuilderView.js && node tests/handWorkspaceView.test.cjs && node tests/preflopBuilderWiring.test.cjs && node tests/postflopBuilderWiring.test.cjs`
Expected: PASS.

```bash
git add public/handWorkspaceView.js public/preflopBuilderView.js public/postflopBuilderView.js public/index.html public/styles.css tests/handWorkspaceView.test.cjs tests/preflopBuilderWiring.test.cjs tests/postflopBuilderWiring.test.cjs
git commit -m "refactor: share builder workspace presentation"
```

### Task 5: Render Screenshot Import as a Complete Builder

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/app.js`
- Create: `tests/importBuilderWiring.test.cjs`
- Modify: `tests/importAnalysisPrefetchWiring.test.cjs`

**Interfaces:**
- Consumes: `fromImportedHand`, `createHandWorkspaceView`, and `importSession`.
- Produces: an import-mode workspace with upload/status/preview plus populated table, board, navigator, and selectable full timeline.

- [ ] **Step 1: Write failing import-workspace wiring tests**

Assert that `importSection` contains an import workspace root, `app.js` converts a successful extraction into `importSession`, timeline selection calls `decisionSnapshotForAction`, and no selection calls `setMode("manual")`.

- [ ] **Step 2: Run the wiring test and verify failure**

Run: `node tests/importBuilderWiring.test.cjs`
Expected: FAIL because the import path still renders `importDecisions` and jumps to Manual Builder.

- [ ] **Step 3: Add the screenshot workspace shell**

Keep upload, drop, paste, progress, and collapsible preview above a builder-shaped empty/populated area. On successful extraction, atomically replace `importSession.handState`; on failure, retain the prior successful session and display the failure in `importStatus`.

- [ ] **Step 4: Replace row-list rendering with timeline selection**

Render every meaningful imported action within its street. Highlight the selected action and display the state immediately before it. Remove `loadImportedDecision` transitions that write hidden manual fields and call `setMode("manual")`.

- [ ] **Step 5: Adapt background prefetch to imported decision keys**

Rank the same postflop candidates, but bind status to timeline actions and imported session tokens. A completed prefetch updates only `importSession.analysisState.byDecision[key]`.

- [ ] **Step 6: Verify and commit**

Run: `node tests/importBuilderWiring.test.cjs && node tests/importAnalysisPrefetchWiring.test.cjs && node tests/importAnalysisPrefetchModel.test.cjs`
Expected: PASS.

```bash
git add public/index.html public/styles.css public/app.js tests/importBuilderWiring.test.cjs tests/importAnalysisPrefetchWiring.test.cjs
git commit -m "feat: show imported hands in the builder workspace"
```

### Task 6: Imported-Hand Editing, Warnings, and Downstream Invalidation

**Files:**
- Modify: `public/importBuilderAdapter.js`
- Modify: `public/handSessionModel.js`
- Modify: `public/handWorkspaceView.js`
- Modify: `public/app.js`
- Create: `tests/importBuilderEditing.test.cjs`
- Modify: `public/styles.css`

**Interfaces:**
- Produces: `editImportedAction(session, actionKey, replacement)`, `editImportedCards(session, fieldKey, cards)`, and `changeImportedHero(session, playerName)` coordinator operations.
- All successful corrections increment `importSession.revision` and return `{ session, invalidatedDecisionKeys, discardedStreets }`.

- [ ] **Step 1: Write failing invalidation tests**

Cover editing a flop action (discard turn/river), editing turn cards (discard turn actions/river), duplicate-card rejection without revision change, Hero reassignment, corrected-value markers, and no mutation of a provided manual session.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node tests/importBuilderEditing.test.cjs`
Expected: FAIL because imported edit operations are missing.

- [ ] **Step 3: Implement correction and replay operations**

Use model rewind/replace APIs, recompute the action index, increment revision after valid edits, and clear only affected imported cache entries. Return a structured preview of discarded streets before committing an edit with downstream effects.

- [ ] **Step 4: Render field-local confidence and correction states**

Add text-plus-icon warning labels, `data-confidence`, and `data-user-corrected` states. Link invalid-card warnings to the relevant picker trigger. Use an inline discard warning with explicit Apply/Cancel controls.

- [ ] **Step 5: Verify and commit**

Run: `node tests/importBuilderEditing.test.cjs && node tests/importCardValidity.test.cjs && node tests/importHeroCardModel.test.cjs && node tests/importDecisionSnapshot.test.cjs`
Expected: PASS.

```bash
git add public/importBuilderAdapter.js public/handSessionModel.js public/handWorkspaceView.js public/app.js public/styles.css tests/importBuilderEditing.test.cjs
git commit -m "feat: edit and validate imported builder histories"
```

### Task 7: Session-Scoped Analysis Surfaces

**Files:**
- Modify: `public/analysisRequestModel.js`
- Modify: `public/app.js`
- Modify: `public/postflopAnalysisView.js`
- Modify: `public/importAnalysisCacheModel.js`
- Create: `tests/sessionAnalysisIsolation.test.cjs`
- Modify: `tests/analysisRequestModel.test.cjs`
- Modify: `tests/importAnalysisCacheModel.test.cjs`

**Interfaces:**
- Analysis requests consume `{ source, revision, decisionKey, stateBefore, decisionOwner, recordedAction }`.
- Analysis snapshots contain the recommendation, metrics, calculation log, range view, Harrington output, PokerSkill output, and per-panel loading/error status.

- [ ] **Step 1: Write failing cross-session and stale-response tests**

Start manual and imported requests, resolve them out of order, and assert each complete bundle lands in only its originating session. Change the imported selection before resolving a request and assert the stale result is cached only under its original key and is not rendered as current.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `node tests/sessionAnalysisIsolation.test.cjs`
Expected: FAIL because current panels and request coordination are global.

- [ ] **Step 3: Build requests from explicit snapshots**

Stop relying on whichever hidden legacy inputs happen to be populated. Adapt `stateBefore` into the existing API request shape at dispatch time and pass explicit decision owner/recorded action into analysis context.

- [ ] **Step 4: Capture and restore complete analysis bundles**

Make render functions consume a session analysis snapshot. When switching tabs or decisions, restore every panel together; never retain Harrington or PokerSkill HTML from the previously active session.

- [ ] **Step 5: Scope cache and prefetch keys**

Include source, revision, and decision key while retaining hand facts needed by existing cache correctness tests. Guard completion with the request token from Task 1.

- [ ] **Step 6: Verify and commit**

Run: `node tests/sessionAnalysisIsolation.test.cjs && node tests/analysisRequestModel.test.cjs && node tests/importAnalysisCacheModel.test.cjs && node tests/importAnalysisCacheWiring.test.cjs && node tests/resultsLayout.test.cjs`
Expected: PASS.

```bash
git add public/analysisRequestModel.js public/app.js public/postflopAnalysisView.js public/importAnalysisCacheModel.js tests/sessionAnalysisIsolation.test.cjs tests/analysisRequestModel.test.cjs tests/importAnalysisCacheModel.test.cjs
git commit -m "feat: scope analysis content to each hand session"
```

### Task 8: Remove the Legacy Import Decision Page and Complete Regression Verification

**Files:**
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `public/app.js`
- Modify: `tests/unsafeImportAttributionUi.test.cjs`
- Modify: `tests/importBuilderWiring.test.cjs`
- Modify: `README.md`

**Interfaces:**
- Removes: `importSummary`, `importDecisions`, `.import-load-btn`, detached decision rendering, and import-to-manual hidden-field handoff.
- Retains: screenshot upload API, normalization/repair/validation, attribution guards, cache/prefetch behavior, and all shared analysis types.

- [ ] **Step 1: Strengthen removal and safety assertions**

Assert that old decision-list selectors and `setMode("manual")` import handoff are absent, unsafe decisions render disabled timeline actions with explanations, and manual/import reset buttons target only their own sessions.

- [ ] **Step 2: Delete superseded markup, styles, and event handlers**

Remove the detached import metadata editor and decision rows only after the new workspace covers upload review, identity/card correction, decision selection, prefetch status, and analysis.

- [ ] **Step 3: Update user documentation**

Document that Screenshot Import and Manual Builder use the same layout but maintain separate hands and analysis. Explain selecting a timeline action and correcting extracted history.

- [ ] **Step 4: Run syntax and targeted regression tests**

Run: `npm run check`
Expected: every syntax check and test passes.

- [ ] **Step 5: Perform manual browser acceptance**

Run: `npm run dev`

Verify at desktop and narrow widths:

1. Create and analyze a manual hand.
2. Import a multi-street screenshot and select Hero and opponent decisions.
3. Confirm recommendation, metrics, calculation, Harrington, and PokerSkill panels change with the imported decision.
4. Switch modes repeatedly and confirm both hands and all analysis panels restore independently.
5. Correct an early imported action and confirm later imported streets invalidate while the manual hand remains unchanged.
6. Attempt a failed replacement import and confirm the prior imported hand survives.
7. Navigate upload, street actions, warnings, dialogs, and analysis using the keyboard.

- [ ] **Step 6: Inspect the final diff and commit**

Run: `git diff --check && git status --short`
Expected: no whitespace errors; only intended task files are staged for this commit.

```bash
git add public/index.html public/styles.css public/app.js tests/unsafeImportAttributionUi.test.cjs tests/importBuilderWiring.test.cjs README.md
git commit -m "refactor: retire detached screenshot decision flow"
```

### Task 9: Final Verification and Review Gate

**Files:**
- Verify only; modify a file only to fix a demonstrated failure.

**Interfaces:**
- Produces: evidence that the approved specification is implemented without manual/import cross-contamination.

- [ ] **Step 1: Run the complete automated suite from a clean command invocation**

Run: `npm run check`
Expected: PASS with exit code 0.

- [ ] **Step 2: Re-run the new feature tests as an explicit acceptance group**

Run: `node tests/handSessionModel.test.cjs && node tests/importBuilderAdapter.test.cjs && node tests/importDecisionSnapshot.test.cjs && node tests/handWorkspaceView.test.cjs && node tests/importBuilderWiring.test.cjs && node tests/importBuilderEditing.test.cjs && node tests/sessionAnalysisIsolation.test.cjs`
Expected: PASS with exit code 0.

- [ ] **Step 3: Review repository state and implementation diff**

Run: `git status --short && git diff --check && git log --oneline -10`
Expected: no accidental generated files, no whitespace errors, and task commits matching the plan sequence.

- [ ] **Step 4: Request code review**

Use `superpowers:requesting-code-review` against the implementation diff. Resolve any correctness or spec-coverage findings, then repeat Steps 1-3.

- [ ] **Step 5: Prepare branch completion options**

Use `superpowers:finishing-a-development-branch` only after all verification passes. Do not merge, push, or delete work without the user's explicit selection.
