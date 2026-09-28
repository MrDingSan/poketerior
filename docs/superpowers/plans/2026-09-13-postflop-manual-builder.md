# Post-flop Manual Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a frontend-only manual hand workflow that carries the current pre-flop state through flop, turn, river, and results without changing existing backend contracts.

**Architecture:** Keep `PokerCoachPreflopBuilderModel` as the pre-flop authority and convert its completed snapshot into a browser-global `PokerCoachPostflopBuilderModel` using integer tenths of a big blind. Render the post-flop workspace through focused browser-global view modules, and adapt the final state into the existing hidden form fields and analysis calls in `public/app.js`.

**Tech Stack:** Vanilla JavaScript browser globals, semantic HTML, existing CSS design tokens, Node `assert`/`vm` tests, current Poker Coach analysis endpoints.

**Spec:** `docs/superpowers/specs/2026-09-13-postflop-manual-builder-design.md`

## Global Constraints

- Make frontend-only changes; do not modify backend endpoints, LLM clients, prompts, provider selection, or server request contracts.
- Preserve Screenshot Import, current pre-flop analysis, and the visible Quick Entry state.
- Use integer tenths of a big blind for all post-flop monetary values.
- Keep community cards in dealt order and hero cards in descending rank order.
- Do not invent solver frequencies, range percentages, combo counts, or equity values.
- Do not add a frontend framework or large dependency.
- Side-pot settlement and custom range editing are out of scope.
- Follow test-driven development: add a failing focused test, observe the intended failure, implement the minimum behavior, and rerun the focused and full suites.

---

## File Structure

- Create `public/postflopBuilderModel.js`: pure post-flop initialization, replay, legal actions, board validation, street transitions, rewinds, sizing, and legacy-analysis conversion.
- Create `public/postflopBuilderView.js`: table/street/action rendering and DOM event wiring.
- Create `public/rangeMatrixView.js`: reusable weighted 13×13 range matrix.
- Create `public/postflopAnalysisView.js`: range, texture, equity, and AI-analysis presentation.
- Modify `public/preflopBuilderView.js`: hand the completed pre-flop state to the post-flop orchestrator.
- Modify `public/index.html`: add the semantic post-flop workspace and load new scripts before `app.js`.
- Modify `public/styles.css`: post-flop layout, street states, board, sizing, range matrices, analysis tabs, and responsive behavior.
- Modify `public/app.js`: initialize/show/reset the post-flop view and synchronize current state into existing analysis fields.
- Modify `package.json`: add focused post-flop tests to `check`.
- Create `tests/postflopBuilderModel.test.cjs`: state-engine and arithmetic coverage.
- Create `tests/postflopBuilderFlow.test.cjs`: complete street-flow and rewind coverage.
- Create `tests/postflopBuilderWiring.test.cjs`: script order, semantic hooks, analysis compatibility, and CSS contracts.
- Create `tests/rangeMatrixView.test.cjs`: weighted matrix normalization and rendering contracts.

---

### Task 1: Convert Completed Pre-flop State Into Post-flop State

**Files:**
- Create: `public/postflopBuilderModel.js`
- Create: `tests/postflopBuilderModel.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `PokerCoachPreflopBuilderModel` state with `potUnits`, `contributions`, `seats`, `heroPosition`, `heroCards`, `actions`, and `settings`.
- Produces: `createFromPreflop(preflopState) -> PostflopState`, `toPostflopUnits(bb) -> integer`, and `formatPostflopBb(units) -> string` on `globalThis.PokerCoachPostflopBuilderModel`.

- [ ] **Step 1: Write the failing initialization and conversion test**

```js
let state = postflop.createFromPreflop(preflop.createInitialState());
assert.equal(state.street, "flop");
assert.equal(state.potUnits, 190);
assert.equal(state.players.SB.stackUnits, 910);
assert.equal(state.players.UTG.stackUnits, 910);
assert.equal(state.players.BB.folded, true);
assert.deepEqual(Array.from(state.heroCards), ["Ah", "Kh"]);
assert.deepEqual(JSON.parse(JSON.stringify(state.board)), { flop: [], turn: null, river: null });
assert.equal(state.currentActor, null, "board entry precedes flop action");
assert.equal(postflop.toPostflopUnits(6.3), 63);
assert.equal(postflop.formatPostflopBb(63), "6.3");
```

- [ ] **Step 2: Run the focused test and confirm the missing module/API failure**

Run: `node tests/postflopBuilderModel.test.cjs`

Expected: FAIL because `public/postflopBuilderModel.js` or `createFromPreflop` does not exist.

- [ ] **Step 3: Implement conversion and serializable base state**

```js
function createFromPreflop(preflopState) {
  const startingStackUnits = toPostflopUnits(preflopState.settings.startingStackBb);
  const players = Object.fromEntries(POSITIONS.map((position) => {
    const committed = preflopState.contributions[position] * 5;
    return [position, {
      position,
      stackUnits: startingStackUnits - committed,
      folded: preflopState.seats[position].folded,
      allin: preflopState.seats[position].allin,
      streetContributionUnits: 0,
      assumption: preflopState.seats[position].assumption,
    }];
  }));
  return {
    settings: { ...preflopState.settings },
    heroPosition: preflopState.heroPosition,
    heroCards: [...preflopState.heroCards],
    dealerPosition: "BTN",
    players,
    board: { flop: [], turn: null, river: null },
    street: "flop",
    potUnits: preflopState.potUnits * 5,
    currentActor: null,
    streetActions: { flop: [], turn: [], river: [] },
    preflopActions: preflopState.actions.map((action) => ({ ...action })),
    rangesByStreet: {},
    analysisByStreet: {},
    streetComplete: false,
    error: null,
  };
}
```

Attach the API through the same IIFE/browser-global pattern used by `preflopBuilderModel.js`, and support CommonJS export for focused tests.

- [ ] **Step 4: Run the focused test and syntax check**

Run: `node tests/postflopBuilderModel.test.cjs && node --check public/postflopBuilderModel.js`

Expected: PASS with no output other than the npm/node command wrapper.

- [ ] **Step 5: Register the focused test and commit**

Add `test:postflop-builder` to `package.json` and append the model syntax/test commands to `check`.

```bash
git add public/postflopBuilderModel.js tests/postflopBuilderModel.test.cjs package.json
git commit -m "feat: add postflop hand state"
```

---

### Task 2: Implement Board Validation and Street Activation

**Files:**
- Modify: `public/postflopBuilderModel.js`
- Modify: `tests/postflopBuilderModel.test.cjs`

**Interfaces:**
- Consumes: `PostflopState` from Task 1.
- Produces: `setBoardCards(state, street, cards) -> PostflopState`, `usedCards(state) -> string[]`, `startStreet(state) -> PostflopState`, and `nextActivePostflopActor(players, dealerPosition, afterActor?) -> position|null`.

- [ ] **Step 1: Add failing board and actor-order tests**

```js
state = postflop.createFromPreflop(preflop.createInitialState());
state = postflop.setBoardCards(state, "flop", ["Qh", "7s", "4h"]);
assert.deepEqual(Array.from(state.board.flop), ["Qh", "7s", "4h"]);
assert.equal(state.currentActor, "SB");
assert.throws(() => postflop.setBoardCards(state, "flop", ["Ah", "7s", "4h"]), /already in use/i);
assert.throws(() => postflop.setBoardCards(state, "turn", ["Jc"]), /complete the flop/i);
assert.throws(() => postflop.setBoardCards(state, "flop", ["Qh", "7s"]), /exactly three/i);
```

- [ ] **Step 2: Run the focused test and confirm the missing-operation failure**

Run: `npm run test:postflop-builder`

Expected: FAIL because `setBoardCards` is undefined.

- [ ] **Step 3: Implement card validation and actor selection**

Use the fixed post-flop traversal `SB → BB → UTG → HJ → CO → BTN`, beginning with the first non-folded, non-all-in player. Validate card syntax with `/^[2-9TJQKA][cdhs]$/`, exact street card counts, uniqueness within the selection, and collisions with hero/previous board cards. `setBoardCards(..., "flop", cards)` starts flop action after three valid cards.

```js
function usedCards(state) {
  return [...state.heroCards, ...state.board.flop, state.board.turn, state.board.river].filter(Boolean);
}

function startStreet(state) {
  const players = resetStreetContributions(state.players);
  return replayPostflop({ ...state, players, currentActor: firstPostflopActor(players), streetComplete: false });
}
```

- [ ] **Step 4: Run focused model tests**

Run: `npm run test:postflop-builder`

Expected: PASS, including duplicate-card and SB-first assertions.

- [ ] **Step 5: Commit**

```bash
git add public/postflopBuilderModel.js tests/postflopBuilderModel.test.cjs
git commit -m "feat: validate postflop board entry"
```

---

### Task 3: Implement Post-flop Betting Replay and Legal Actions

**Files:**
- Modify: `public/postflopBuilderModel.js`
- Modify: `tests/postflopBuilderModel.test.cjs`

**Interfaces:**
- Consumes: active `PostflopState` with a valid board for the current street.
- Produces: `legalActions(state) -> { actor, amountToCallUnits, actions }`, `applyAction(state, action) -> PostflopState`, `replayPostflop(input) -> PostflopState`, and `betSizePresets(state) -> BetSizePreset[]`.
- `PostflopAction` input: `{ actor, type, targetStreetContributionUnits }`.

- [ ] **Step 1: Add failing check-through and bet/call accounting tests**

```js
let flop = postflop.setBoardCards(postflop.createFromPreflop(preflop.createInitialState()), "flop", ["Qh", "7s", "4h"]);
assert.deepEqual(Array.from(postflop.legalActions(flop).actions, (action) => action.type), ["check", "bet", "allin"]);
flop = postflop.applyAction(flop, { actor: "SB", type: "bet", targetStreetContributionUnits: 63 });
assert.equal(flop.potUnits, 253);
assert.equal(flop.players.SB.stackUnits, 847);
assert.equal(flop.currentActor, "UTG");
assert.equal(postflop.legalActions(flop).amountToCallUnits, 63);
flop = postflop.applyAction(flop, { actor: "UTG", type: "call", targetStreetContributionUnits: 63 });
assert.equal(flop.potUnits, 316);
assert.equal(flop.streetComplete, true);
assert.equal(flop.currentActor, null);
```

Also assert that two checks close the reference heads-up flop, a fold leaves the bettor as the sole player, illegal out-of-order actions throw, and no target exceeds the player's stack.

- [ ] **Step 2: Run the focused test and confirm legal-action/replay failure**

Run: `npm run test:postflop-builder`

Expected: FAIL because `legalActions` or `applyAction` is missing.

- [ ] **Step 3: Implement deterministic replay**

Rebuild each street from its starting pot/player snapshot and its ordered actions. On every action record `incrementAmountUnits`, `potBeforeUnits`, `potAfterUnits`, `stackBeforeUnits`, and `stackAfterUnits`. A new bet or full raise reopens pending action for other active players; a check/call/fold removes the actor from pending action.

```js
function legalActions(state) {
  const actor = state.currentActor;
  const contribution = state.players[actor].streetContributionUnits;
  const amountToCallUnits = Math.max(0, state.highestStreetContributionUnits - contribution);
  return {
    actor,
    amountToCallUnits,
    actions: amountToCallUnits
      ? callFacingActions(state, actor, amountToCallUnits)
      : unopenedActions(state, actor),
  };
}
```

Use `bet`, `raise`, and `allin` target totals for validation; add only the increment over the actor's existing street contribution to the pot.

- [ ] **Step 4: Run model tests and syntax check**

Run: `npm run test:postflop-builder && node --check public/postflopBuilderModel.js`

Expected: PASS for check-through, bet/call, fold, raise, and all-in assertions.

- [ ] **Step 5: Commit**

```bash
git add public/postflopBuilderModel.js tests/postflopBuilderModel.test.cjs
git commit -m "feat: add postflop betting engine"
```

---

### Task 4: Implement Street Transitions, Rewind, and Analysis Adapter

**Files:**
- Modify: `public/postflopBuilderModel.js`
- Create: `tests/postflopBuilderFlow.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: completed street state from Task 3.
- Produces: `advanceStreet(state) -> PostflopState`, `replaceAction(state, street, index, action) -> PostflopState`, `rewindToStreet(state, street) -> PostflopState`, and `toLegacyAnalysisInput(state) -> object`.

- [ ] **Step 1: Write the failing complete-flow and invalidation tests**

Build the reference flop, check it through, advance, add Jc, check through turn, advance, add 2d, check through river, and assert Results:

```js
state = checkThroughReferenceStreet(state, postflop);
state = postflop.advanceStreet(state);
assert.equal(state.street, "turn");
assert.equal(state.currentActor, null);
state = postflop.setBoardCards(state, "turn", ["Jc"]);
state = checkThroughReferenceStreet(state, postflop);
state = postflop.advanceStreet(state);
state = postflop.setBoardCards(state, "river", ["2d"]);
state = checkThroughReferenceStreet(state, postflop);
state = postflop.advanceStreet(state);
assert.equal(state.street, "results");
assert.equal(state.board.river, "2d");
```

Then rewind the flop and assert `board.turn`, `board.river`, turn/river actions, and later analysis snapshots are cleared while pre-flop history is preserved.

- [ ] **Step 2: Run the focused flow test and confirm transition failure**

Run: `node tests/postflopBuilderFlow.test.cjs`

Expected: FAIL because `advanceStreet` is undefined.

- [ ] **Step 3: Implement transition, rewind, and compatibility output**

`advanceStreet` requires `streetComplete === true`; it changes flop→turn, turn→river, and river→results. `rewindToStreet` truncates later actions/cards/ranges/analysis. `replaceAction` replays the target street through the replacement and performs the same downstream invalidation.

```js
function toLegacyAnalysisInput(state) {
  return {
    heroPosition: state.heroPosition,
    heroHand: state.heroCards.join(" "),
    boardCards: state.board.flop.join(" "),
    turnCard: state.board.turn || "",
    riverCard: state.board.river || "",
    potSize: state.potUnits / 10,
    street: state.street === "results" ? "river" : state.street,
    actionsByStreet: cloneStreetActions(state.streetActions),
  };
}
```

- [ ] **Step 4: Run both post-flop suites**

Run: `npm run test:postflop-builder && node tests/postflopBuilderFlow.test.cjs`

Expected: PASS for flop→results and downstream invalidation.

- [ ] **Step 5: Register flow test and commit**

Add `test:postflop-flow` and include it in `check`.

```bash
git add public/postflopBuilderModel.js tests/postflopBuilderFlow.test.cjs package.json
git commit -m "feat: add postflop street progression"
```

---

### Task 5: Build the Post-flop Workspace and Shared Board Picker

**Files:**
- Create: `public/postflopBuilderView.js`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Create: `tests/postflopBuilderWiring.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `PokerCoachPostflopBuilderModel`, completed pre-flop state, and callbacks `{ onStateChange, onAnalyze, onEditPreflop }`.
- Produces: `createPostflopBuilderView(options) -> { getState, setState, startFromPreflop, reset }` on `globalThis.PokerCoachPostflopBuilderView`.

- [ ] **Step 1: Write failing semantic and script-order tests**

```js
for (const id of [
  "postflopBuilder", "streetNavigator", "postflopTable", "boardCardSlots",
  "postflopNextAction", "postflopTimeline", "postflopCardDialog", "postflopAnalysis"
]) assert.match(html, new RegExp(`id=["']${id}["']`));
assert.ok(html.indexOf("postflopBuilderModel.js") < html.indexOf("postflopBuilderView.js"));
assert.ok(html.indexOf("postflopBuilderView.js") < html.indexOf("app.js"));
for (const selector of [".postflop-layout", ".street-navigator", ".board-card-slot", ".postflop-builder.is-active"]) {
  assert.ok(css.includes(selector), `Missing ${selector}`);
}
```

- [ ] **Step 2: Run wiring test and confirm missing-shell failure**

Run: `node tests/postflopBuilderWiring.test.cjs`

Expected: FAIL because the post-flop IDs and scripts are absent.

- [ ] **Step 3: Add semantic shell, rendering module, and contained desktop layout**

Add the post-flop section after the pre-flop section, hidden until activated. Reuse the existing card visual language, but give the board dialog independent IDs and state. Render five slots: three active on flop and muted turn/river slots. Disable picker cards returned by `model.usedCards(state)`.

```js
const view = createPostflopBuilderView({ root, model, initialState, onStateChange, onAnalyze, onEditPreflop });
function render() {
  renderStreetNavigator();
  renderTable();
  renderBoard();
  renderNextAction();
  renderTimeline();
}
```

Set `.postflop-main` to `minmax(0, 1fr) minmax(340px, 390px)` and every nested grid track to `minmax(0, 1fr)` so timeline content cannot overlap the right rail.

- [ ] **Step 4: Run wiring and syntax tests**

Run: `node tests/postflopBuilderWiring.test.cjs && node --check public/postflopBuilderView.js`

Expected: PASS with all semantic hooks and scripts present.

- [ ] **Step 5: Register test and commit**

Add `test:postflop-wiring` and include the new view/test in `check`.

```bash
git add public/postflopBuilderView.js public/index.html public/styles.css tests/postflopBuilderWiring.test.cjs package.json
git commit -m "feat: add postflop table workspace"
```

---

### Task 6: Wire Contextual Actions, Sizing, Timeline, and Editing

**Files:**
- Modify: `public/postflopBuilderView.js`
- Modify: `public/styles.css`
- Modify: `tests/postflopBuilderWiring.test.cjs`

**Interfaces:**
- Consumes: `model.legalActions`, `model.betSizePresets`, `model.applyAction`, `model.replaceAction`, and `model.advanceStreet`.
- Produces: interactive legal-action buttons, sizing controls, live seat/pot rendering, street-grouped history, and edit dispatch.

- [ ] **Step 1: Add failing rendering-contract tests**

Assert the view source contains dispatch hooks for `data-postflop-action`, `data-postflop-size`, `data-postflop-edit`, `data-street-target`, and IDs for custom sizing and advance/analyze actions. Assert CSS contains `.postflop-action-call`, `.postflop-action-aggressive`, `.postflop-size.is-selected`, `.street-action.is-pending`, and `.felt-commitment`.

- [ ] **Step 2: Run wiring test and confirm missing interaction hooks**

Run: `npm run test:postflop-wiring`

Expected: FAIL listing the first absent hook or selector.

- [ ] **Step 3: Implement interaction dispatch and render states**

Render Check/Bet/All-in or Fold/Call/Raise/All-in directly from `legalActions`. Clicking Bet/Raise reveals `betSizePresets`, each with a fraction label and formatted amount. Submitting dispatches a target street contribution to the model. Timeline actions call `replaceAction`; clicking a completed street calls `rewindToStreet` after showing the downstream-reset message in the panel.

```js
nextAction.addEventListener("click", (event) => {
  const action = event.target.closest("[data-postflop-action]");
  const size = event.target.closest("[data-postflop-size]");
  if (size) return commitAggressiveAction(size.dataset.postflopSize);
  if (action) return chooseAction(action.dataset.postflopAction);
});
```

Render current contributions as felt chips, remaining stack at each seat, pot in the board area, current actor in gold, folded seats muted, and all-in status in text.

- [ ] **Step 4: Run model, flow, and wiring tests**

Run: `npm run test:postflop-builder && npm run test:postflop-flow && npm run test:postflop-wiring`

Expected: PASS with no missing selector or interaction contract.

- [ ] **Step 5: Commit**

```bash
git add public/postflopBuilderView.js public/styles.css tests/postflopBuilderWiring.test.cjs
git commit -m "feat: add contextual postflop actions"
```

---

### Task 7: Build Reusable Range Matrix and Analysis Panels

**Files:**
- Create: `public/rangeMatrixView.js`
- Create: `public/postflopAnalysisView.js`
- Create: `tests/rangeMatrixView.test.cjs`
- Modify: `tests/postflopBuilderWiring.test.cjs`
- Modify: `public/index.html`
- Modify: `public/styles.css`
- Modify: `package.json`

**Interfaces:**
- Produces: `PokerCoachRangeMatrixView.normalizeRangeData(input)`, `renderRangeMatrix(container, data, options)`, and `PokerCoachPostflopAnalysisView.createPostflopAnalysisView({ root, rangeMatrixView })`.
- Range input: `{ weights?: Record<HandClass, number>, actionFrequencies?: Record<HandClass, { aggressive, call, fold }>, percentage?: number|null, comboCount?: number|null }`.
- Analysis input: `{ heroRange, villainRange, rangeHistory, boardTexture, equity, aiAnalysis }`.

- [ ] **Step 1: Write failing normalization tests**

```js
const normalized = rangeView.normalizeRangeData({ weights: { AA: 1, AKs: 0.6, AKo: -1, QJs: 2 } });
assert.equal(normalized.weights.AA, 1);
assert.equal(normalized.weights.AKs, 0.6);
assert.equal(normalized.weights.AKo, 0);
assert.equal(normalized.weights.QJs, 1);
assert.equal(normalized.cells.length, 169);
assert.equal(rangeView.normalizeRangeData(null).available, false);
```

- [ ] **Step 2: Run matrix test and confirm missing module failure**

Run: `node tests/rangeMatrixView.test.cjs`

Expected: FAIL because `public/rangeMatrixView.js` does not exist.

- [ ] **Step 3: Implement matrices and analysis presentation**

Generate canonical 13×13 labels from ranks `AKQJT98765432`; pairs occupy the diagonal, suited hands the upper triangle, and offsuit hands the lower triangle. Clamp all weights/frequencies to `[0, 1]`. Render weighted colors only from supplied data.

Build Ranges, Equity, AI Analysis, and Breakdown tabs. Ranges includes villain matrix, concise deterministic board texture, range evolution snapshots, and equity bars. Missing data renders “Run analysis to populate this panel.” Provider/confidence text is shown only when supplied by existing results.

- [ ] **Step 4: Run matrix, wiring, and syntax tests**

Run: `node tests/rangeMatrixView.test.cjs && npm run test:postflop-wiring && node --check public/rangeMatrixView.js && node --check public/postflopAnalysisView.js`

Expected: PASS for 169 cells, clamped values, unavailable state, and script order.

- [ ] **Step 5: Register test and commit**

Add both scripts before `postflopBuilderView.js`, add `test:range-matrix`, and include syntax/tests in `check`.

```bash
git add public/rangeMatrixView.js public/postflopAnalysisView.js public/index.html public/styles.css tests/rangeMatrixView.test.cjs tests/postflopBuilderWiring.test.cjs package.json
git commit -m "feat: add postflop range analysis panels"
```

---

### Task 8: Integrate Pre-flop Handoff and Existing Analysis APIs

**Files:**
- Modify: `public/preflopBuilderView.js`
- Modify: `public/app.js`
- Modify: `tests/postflopBuilderWiring.test.cjs`
- Modify: `tests/preflopBuilderWiring.test.cjs`

**Interfaces:**
- Consumes: `preflopBuilder.getState()`, `postflopModel.createFromPreflop`, `postflopModel.toLegacyAnalysisInput`, and existing `analyze(button)`/`setVisibleStreet(street)` behavior.
- Produces: a preflop→postflop handoff, synchronized legacy fields, existing analysis invocation, and unified New Hand reset.

- [ ] **Step 1: Add failing compatibility assertions**

Assert `app.js` creates `postflopBuilder`, passes the actual pre-flop state from `onContinueFlop`, updates `boardCards`, `turnCard`, `riverCard`, the matching `flopPotSize`/`turnPotSize`/`riverPotSize` and call-amount fields, and existing action rows from `toLegacyAnalysisInput`. Assert it invokes existing `analyze(...)` rather than a new endpoint and that no files under `src/` are modified in the task diff.

- [ ] **Step 2: Run pre-flop and post-flop wiring tests**

Run: `npm run test:preflop-builder-wiring && npm run test:postflop-wiring`

Expected: FAIL because the post-flop orchestrator is not initialized in `app.js`.

- [ ] **Step 3: Implement the frontend orchestration**

Change the pre-flop callback to pass state:

```js
onContinueFlop: (preflopState) => {
  postflopBuilder.startFromPreflop(preflopState);
  showManualBuilderStage("postflop");
},
```

Initialize the post-flop view once. On every state change, write the adapter output into the existing hidden board fields, the pot/call fields for each populated street, and the matching action sequence elements, then call existing progressive-control refresh logic. Route Analyze Street and Analyze Full Hand to the existing `analyze` function. New Hand resets both builder models and returns to pre-flop without clearing persisted game settings.

- [ ] **Step 4: Run all builder tests and full check**

Run: `npm run test:preflop-builder && npm run test:preflop-builder-wiring && npm run test:postflop-builder && npm run test:postflop-flow && npm run test:postflop-wiring && npm run test:range-matrix && npm run check`

Expected: PASS with current backend/client tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add public/preflopBuilderView.js public/app.js tests/postflopBuilderWiring.test.cjs tests/preflopBuilderWiring.test.cjs
git commit -m "feat: connect postflop manual workflow"
```

---

### Task 9: Responsive, Accessibility, and Browser Acceptance

**Files:**
- Modify: `public/styles.css`
- Modify: `public/postflopBuilderView.js`
- Modify: `tests/postflopBuilderWiring.test.cjs`

**Interfaces:**
- Consumes: completed integrated post-flop builder.
- Produces: keyboard-accessible dialogs/actions, live status text, contained responsive layouts, and verified complete browser workflow.

- [ ] **Step 1: Add failing accessibility and responsive-contract assertions**

Assert the post-flop dialog has `aria-labelledby`, current action uses `aria-live="polite"`, board slots expose full card names, future street controls expose disabled state, and CSS contains breakpoints that convert the left navigator to a horizontal row and move the action rail below the table without page-level horizontal overflow.

- [ ] **Step 2: Run wiring test and confirm the first missing contract**

Run: `npm run test:postflop-wiring`

Expected: FAIL on the first absent ARIA attribute or responsive selector.

- [ ] **Step 3: Implement final responsive and accessibility states**

Add visible `:focus-visible` styles, 44 px minimum controls, text labels for current/completed/future streets, focus return after board-picker dismissal, and reduced-motion behavior. At the laptop breakpoint stack the right rail below the table; at mobile widths use a horizontal street navigator and preserve a readable table through an internal scroll region.

- [ ] **Step 4: Run automated verification and manual acceptance**

Run: `npm run check && git diff --check`

Expected: exit code 0 with all existing and new tests passing.

Then run `npm run dev` and manually verify at `http://127.0.0.1:4175/`:

1. New Hand → Hero SB → A♥ K♥.
2. UTG raises 2.5 → SB raises to 9 → UTG calls → pot 19 bb.
3. Continue to Flop → Q♥ 7♠ 4♥ → Hero Check/Bet and correct fraction sizes.
4. Bet 6.3 bb → UTG call → pot 31.6 bb and both stacks 84.7 bb.
5. Continue to Turn → J♣ → complete turn action.
6. Continue to River → 2♦ → complete river action → Results.
7. Rewind flop and verify turn/river state is cleared.
8. Verify duplicate cards are disabled, matrices do not invent missing data, and table/timeline do not overlap the action rail at desktop and laptop widths.
9. Trigger existing analysis and confirm the current API response populates the new panels without a new route.
10. Recheck Screenshot Import and pre-flop Analyze.

- [ ] **Step 5: Commit**

```bash
git add public/styles.css public/postflopBuilderView.js tests/postflopBuilderWiring.test.cjs
git commit -m "fix: polish postflop builder workflow"
```

---

## Final Verification

- [ ] Run `npm run check` and confirm exit code 0.
- [ ] Run `git diff --check` and confirm no whitespace errors.
- [ ] Confirm `git diff --name-only <design-commit>..HEAD -- src` is empty, proving backend source files were not changed.
- [ ] Inspect `git status --short` and preserve unrelated user-owned files.
- [ ] Perform the complete browser acceptance flow from Task 9 once more after the final commit.
