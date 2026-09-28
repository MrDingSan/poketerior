# Pre-flop Manual Builder Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Poker Coach’s manual pre-flop form with a premium visual six-seat builder that infers turns, offers contextual actions, calculates the pot, and feeds the existing analysis pipeline.

**Architecture:** Add a dependency-free browser-global state model containing pure pre-flop rules and a focused view module that renders the new DOM surface. Keep `public/app.js` responsible for mode switching, invoking existing analysis, and post-flop progression; bridge the new model into the legacy analysis inputs through an explicit adapter.

**Tech Stack:** Vanilla HTML/CSS/JavaScript, browser globals with CommonJS-compatible exports, Node’s built-in `assert`, existing Node test scripts.

**Spec:** `docs/superpowers/specs/2026-09-10-preflop-manual-builder-redesign-design.md`

## Global Constraints

- Redesign manual pre-flop only; preserve Screenshot Import and the existing flop, turn, river, results, and backend behavior.
- Add no third-party dependencies or UI framework.
- Use 6-max positions `UTG`, `HJ`, `CO`, `BTN`, `SB`, and `BB`; normalize legacy `MP` to `HJ` at the compatibility boundary.
- Represent betting amounts in half-big-blind integer units internally and display them as big blinds.
- Preserve the initial example: Hero SB with A♥ K♥, UTG raise to 2.5 bb, SB 3-bet to 9 bb, UTG call, pot 19 bb.
- New Hand resets hand state but retains validated Game Type, Starting Stack, and Opponent Profile settings in local storage.
- Hero and action state must not rely on color alone; all controls require keyboard and visible focus support.
- The card modal requires explicit Done confirmation, supports Escape/close, and returns focus to its trigger.
- Quick Entry remains visibly unavailable in this phase.
- Use inline SVG or CSS shapes for icons; do not add emoji icons or an icon package.
- Keep the pure model independent from the DOM and test it before UI implementation.

---

### Task 1: Pure pre-flop state, pot arithmetic, and initial example

**Files:**
- Create: `public/preflopBuilderModel.js`
- Create: `tests/preflopBuilderModel.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `window.PokerCoachPreflopBuilderModel` and `module.exports` with `POSITIONS`, `createInitialState(options)`, `replayState(state)`, `formatBb(units)`, and `toUnits(bb)`.
- State shape: `{ settings, seats, heroPosition, heroCards, actions, contributions, currentActor, highestContribution, potUnits, amountToCallUnits, roundComplete, error }`.
- Action shape: `{ actor, type, targetUnits, automatic?: boolean }`, where `type` is `fold`, `check`, `call`, `raise`, or `allin`.

- [ ] **Step 1: Write failing tests for initialization and the 19 bb example**

```js
const assert = require("node:assert/strict");
const model = require("../public/preflopBuilderModel.js");

const state = model.createInitialState();
assert.equal(state.heroPosition, "SB");
assert.deepEqual(state.heroCards, ["Ah", "Kh"]);
assert.equal(state.potUnits, 38);
assert.equal(model.formatBb(state.potUnits), "19");
assert.deepEqual(
  state.actions.filter((action) => !action.automatic).map(({ actor, type, targetUnits }) => ({ actor, type, targetUnits })),
  [
    { actor: "UTG", type: "raise", targetUnits: 5 },
    { actor: "SB", type: "raise", targetUnits: 18 },
    { actor: "UTG", type: "call", targetUnits: 18 },
  ],
);
```

- [ ] **Step 2: Run the model test and verify RED**

Run: `node tests/preflopBuilderModel.test.cjs`

Expected: FAIL with `Cannot find module '../public/preflopBuilderModel.js'`.

- [ ] **Step 3: Implement unit conversion, seats, blinds, and initial replay**

```js
const POSITIONS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];

function toUnits(bb) {
  const units = Math.round(Number(bb) * 2);
  if (!Number.isFinite(units) || units < 0) throw new Error("Amount must be a non-negative number.");
  return units;
}

function formatBb(units) {
  const bb = units / 2;
  return Number.isInteger(bb) ? String(bb) : bb.toFixed(1);
}

function createInitialState(options = {}) {
  const settings = { gameType: "6max", startingStackBb: 100, opponentProfile: "loose", ...options.settings };
  const actions = options.empty
    ? []
    : [
        { actor: "UTG", type: "raise", targetUnits: 5 },
        { actor: "HJ", type: "fold", targetUnits: 0, automatic: true },
        { actor: "CO", type: "fold", targetUnits: 0, automatic: true },
        { actor: "BTN", type: "fold", targetUnits: 0, automatic: true },
        { actor: "SB", type: "raise", targetUnits: 18 },
        { actor: "BB", type: "fold", targetUnits: 2, automatic: true },
        { actor: "UTG", type: "call", targetUnits: 18 },
      ];
  return replayState({ settings, heroPosition: "SB", heroCards: ["Ah", "Kh"], actions });
}
```

Implement `replayState` so it starts SB at 1 unit and BB at 2 units, adds only contribution deltas, and returns an immutable derived snapshot.

- [ ] **Step 4: Run the model test and verify GREEN**

Run: `node tests/preflopBuilderModel.test.cjs`

Expected: PASS with no output.

- [ ] **Step 5: Register the test and run the full baseline**

Modify `package.json` so `check` syntax-checks `public/preflopBuilderModel.js`, and add:

```json
"test:preflop-builder": "node tests/preflopBuilderModel.test.cjs"
```

Run: `npm run check && npm run test:preflop-builder`

Expected: both commands PASS.

- [ ] **Step 6: Commit the model foundation**

```bash
git add public/preflopBuilderModel.js tests/preflopBuilderModel.test.cjs package.json
git commit -m "feat: add preflop builder state model"
```

---

### Task 2: Turn inference, legal actions, validation, and timeline editing

**Files:**
- Modify: `public/preflopBuilderModel.js`
- Modify: `tests/preflopBuilderModel.test.cjs`

**Interfaces:**
- Consumes: state and action shapes from Task 1.
- Produces: `legalActions(state)`, `applyAction(state, action)`, `replaceAction(state, index, action)`, `setHero(state, position)`, `setHeroCards(state, cards)`, `resetHand(state)`, and `isAnalyzable(state)`.
- `legalActions` returns `{ actor, amountToCallUnits, actions: [{ type, label, quickTargetsUnits, minTargetUnits?, maxTargetUnits? }] }`.

- [ ] **Step 1: Add failing tests for actor order and contextual actions**

```js
let state = model.createInitialState({ empty: true });
assert.equal(state.currentActor, "UTG");
assert.deepEqual(model.legalActions(state).actions.map((item) => item.type), ["fold", "call", "raise", "allin"]);

state = model.applyAction(state, { actor: "UTG", type: "raise", targetUnits: 5 });
assert.equal(state.currentActor, "HJ");
assert.equal(model.legalActions(state).amountToCallUnits, 5);

state = model.applyAction(state, { actor: "HJ", type: "fold", targetUnits: 0 });
assert.equal(state.currentActor, "CO");
assert.throws(
  () => model.applyAction(state, { actor: "BTN", type: "call", targetUnits: 5 }),
  /CO is next to act/,
);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node tests/preflopBuilderModel.test.cjs`

Expected: FAIL because `legalActions` or `applyAction` is undefined.

- [ ] **Step 3: Implement clockwise actor inference and legal action descriptors**

Use `POSITIONS` as the pre-flop order. Skip folded and all-in seats. Track the last aggressor and matched contributions. Complete the round only when all remaining players have responded and matched the highest target, or only one unfolded player remains.

Use total-contribution sizing and expose quick raise targets based on the current wager:

```js
function quickRaiseTargets(state) {
  if (state.highestContribution <= 2) return [5, 6, 8, 10];
  const base = state.highestContribution;
  return [...new Set([Math.ceil(base * 3), Math.ceil(base * 3.6), base * 4, base * 5])]
    .filter((units) => units <= state.settings.startingStackBb * 2);
}
```

- [ ] **Step 4: Add failing tests for editing, Hero/cards, reset, and round completion**

```js
const example = model.createInitialState();
const edited = model.replaceAction(example, 4, { actor: "SB", type: "raise", targetUnits: 20 });
assert.equal(edited.actions.length, 5);
assert.equal(edited.potUnits, 27);
assert.equal(edited.currentActor, "BB");

assert.deepEqual(model.setHeroCards(example, ["As", "Kd"]).heroCards, ["As", "Kd"]);
assert.throws(() => model.setHeroCards(example, ["As", "As"]), /unique/);
assert.equal(model.setHero(example, "BTN").heroPosition, "BTN");

const reset = model.resetHand(example);
assert.equal(reset.actions.length, 0);
assert.deepEqual(reset.heroCards, []);
assert.deepEqual(reset.settings, example.settings);
```

- [ ] **Step 5: Run tests and verify RED**

Run: `node tests/preflopBuilderModel.test.cjs`

Expected: FAIL at the first missing editing or setter function.

- [ ] **Step 6: Implement immutable mutations and rewind/replay editing**

`replaceAction(state, index, action)` must slice through `index`, replace that entry, discard later actions, and call `replayState`. `setHeroCards` accepts exactly two unique `/^[2-9TJQKA][cdhs]$/` cards or an empty array. `resetHand` keeps settings and seat assumptions but clears Hero cards/actions.

- [ ] **Step 7: Run the model suite and commit**

Run: `npm run test:preflop-builder && npm run check`

Expected: PASS.

```bash
git add public/preflopBuilderModel.js tests/preflopBuilderModel.test.cjs
git commit -m "feat: infer legal preflop action flow"
```

---

### Task 3: Semantic pre-flop shell, visual table, and card picker

**Files:**
- Create: `public/preflopBuilderView.js`
- Create: `tests/preflopBuilderWiring.test.cjs`
- Modify: `public/index.html`
- Modify: `package.json`

**Interfaces:**
- Consumes: `PokerCoachPreflopBuilderModel` from Tasks 1–2.
- Produces: `window.PokerCoachPreflopBuilderView.createPreflopBuilderView({ root, model, initialState, onStateChange, onAnalyze, onContinueFlop })`, returning `{ getState(), setState(state), reset(), destroy() }`.
- DOM contract: `#preflopBuilder`, `#preflopTable`, `#nextActionPanel`, `#preflopTimeline`, `#heroCardDialog`, `#analyzePreflopBtn`, `#continueFlopBtn`, and hidden legacy compatibility fields retained outside the visual flow.

- [ ] **Step 1: Write a failing static wiring test**

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const html = fs.readFileSync("public/index.html", "utf8");

for (const id of ["preflopBuilder", "preflopTable", "nextActionPanel", "preflopTimeline", "heroCardDialog"]) {
  assert.match(html, new RegExp(`id=["']${id}["']`));
}
assert.match(html, /preflopBuilderModel\.js/);
assert.match(html, /preflopBuilderView\.js/);
assert.ok(html.indexOf("preflopBuilderModel.js") < html.indexOf("preflopBuilderView.js"));
assert.ok(html.indexOf("preflopBuilderView.js") < html.indexOf("app.js"));
```

- [ ] **Step 2: Run the wiring test and verify RED**

Run: `node tests/preflopBuilderWiring.test.cjs`

Expected: FAIL because `#preflopBuilder` is absent.

- [ ] **Step 3: Replace only the manual pre-flop HTML shell**

Add three mode buttons in order: Screenshot Import, Quick Entry (`disabled`, with explanatory `title`), Manual Builder. Replace the existing pre-flop form content with semantic settings controls, table root, right rail, timeline, and dialog. Retain IDs needed by downstream logic (`gameType`, `rangeMode`, `heroPosition`, `heroHand`, `villainPosition`, `preflopPotSize`, `preflopCallAmount`, `preflopActions`) as hidden compatibility fields until Task 5 removes obsolete reads.

Load scripts in this order:

```html
<script src="./preflopBuilderModel.js"></script>
<script src="./preflopBuilderView.js"></script>
<script src="./app.js"></script>
```

- [ ] **Step 4: Implement table and card picker rendering**

`createPreflopBuilderView` renders six `<button class="poker-seat">` elements from `model.POSITIONS`. Seat clicks call `model.setHero`. Hero card clicks call `dialog.showModal()` and save `document.activeElement` for focus restoration.

Build picker cards with native buttons:

```js
const SUITS = ["s", "h", "d", "c"];
const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const cards = SUITS.flatMap((suit) => RANKS.map((rank) => `${rank}${suit}`));
```

Give each button `aria-label`, `aria-pressed`, rank/suit text, and disabled state when present in the supplied disabled-card set. Keep a draft selection inside the dialog; Done calls `model.setHeroCards`, closes, rerenders, and restores focus. Cancel/close discards the draft.

- [ ] **Step 5: Expand the wiring test for accessibility and script registration**

Assert that the source contains `showModal`, `aria-pressed`, `focus()`, `keydown`, `Escape`, and all 52 generated cards through the rank/suit arrays. Add syntax checks for the view and the new wiring test script to `package.json`.

- [ ] **Step 6: Run tests and commit**

Run: `node tests/preflopBuilderWiring.test.cjs && npm run test:preflop-builder && npm run check`

Expected: PASS.

```bash
git add public/index.html public/preflopBuilderView.js tests/preflopBuilderWiring.test.cjs package.json
git commit -m "feat: add visual preflop table and card picker"
```

---

### Task 4: Contextual action panel, sizing, timeline, and persisted settings

**Files:**
- Modify: `public/preflopBuilderView.js`
- Modify: `public/preflopBuilderModel.js`
- Modify: `tests/preflopBuilderModel.test.cjs`
- Modify: `tests/preflopBuilderWiring.test.cjs`

**Interfaces:**
- Consumes: `legalActions`, `applyAction`, `replaceAction`, `formatBb`, and the view lifecycle from prior tasks.
- Produces: settings persistence under local-storage key `pokerCoach.manualBuilder.settings.v1`; view callbacks receive every committed state.

- [ ] **Step 1: Add failing model tests for custom size validation and analysis readiness**

```js
const openState = model.createInitialState({ empty: true });
assert.throws(
  () => model.applyAction(openState, { actor: "UTG", type: "raise", targetUnits: 2 }),
  /minimum raise/,
);
assert.equal(model.isAnalyzable(openState), false);
assert.equal(model.isAnalyzable(model.createInitialState()), true);
```

- [ ] **Step 2: Run RED, implement validation/readiness, and run GREEN**

Run: `node tests/preflopBuilderModel.test.cjs`

Expected before implementation: FAIL on validation or `isAnalyzable`.

Implement minimum target validation, stack cap, exact call targets, check-only-when-unopened, and readiness requiring a Hero, two unique cards, at least one meaningful opponent action, and no replay error.

Run again; expected: PASS.

- [ ] **Step 3: Add failing wiring assertions for contextual controls**

Assert the view source renders `data-action-type`, `data-target-units`, `customRaiseAmount`, `aria-live="polite"`, timeline action buttons, and a native `<details>` section for opponent assumptions.

- [ ] **Step 4: Run the wiring test and verify RED**

Run: `node tests/preflopBuilderWiring.test.cjs`

Expected: FAIL at `data-action-type` or the first absent contract.

- [ ] **Step 5: Render actions, quick sizes, timeline editing, and assumptions**

Render action buttons from `model.legalActions(state)` rather than hard-coding actor choices. Clicking Fold/Call/Check commits immediately. Clicking Raise reveals quick totals and a labeled custom numeric input; validating custom input shows the model error below the field with `role="alert"`.

Timeline buttons call `replaceAction` using a pending replacement selected through the same action panel. Display automatic folds in a collapsed “4 players folded” chip, but keep them in state. Display the derived pot after the final chip.

Persist only validated settings:

```js
const SETTINGS_KEY = "pokerCoach.manualBuilder.settings.v1";
localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
```

Catch malformed local storage JSON and fall back to defaults. Render individual assumptions as `Tight`, `Standard`, `Loose`, or `Custom`; exclude Hero from opponent controls.

- [ ] **Step 6: Run focused suites and commit**

Run: `npm run test:preflop-builder && node tests/preflopBuilderWiring.test.cjs && npm run check`

Expected: PASS.

```bash
git add public/preflopBuilderModel.js public/preflopBuilderView.js tests/preflopBuilderModel.test.cjs tests/preflopBuilderWiring.test.cjs
git commit -m "feat: add contextual preflop action workflow"
```

---

### Task 5: Existing analysis and post-flop compatibility integration

**Files:**
- Modify: `public/preflopBuilderModel.js`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `tests/preflopBuilderModel.test.cjs`
- Modify: `tests/preflopBuilderWiring.test.cjs`

**Interfaces:**
- Consumes: new builder state and existing `analyze()`, `setVisibleStreet("flop")`, `updatePotReadouts()`, and result rendering in `public/app.js`.
- Produces: `toLegacyPreflopInput(state)` returning `{ heroPosition, heroHand, villainPosition, preflopActions, preflopPotBb, preflopCallBb }`; `window.getManualPreflopInput()` in `app.js` returns that snapshot.

- [ ] **Step 1: Write a failing adapter test**

```js
const legacy = model.toLegacyPreflopInput(model.createInitialState());
assert.deepEqual(legacy, {
  heroPosition: "SB",
  heroHand: "Ah Kh",
  villainPosition: "UTG",
  preflopActions: [
    { actor: "HJ", action: "fold", amount: 0 },
    { actor: "CO", action: "fold", amount: 0 },
    { actor: "BTN", action: "fold", amount: 0 },
    { actor: "UTG", action: "open", amount: 2.5 },
    { actor: "SB", action: "raise", amount: 9 },
    { actor: "BB", action: "fold", amount: 1 },
    { actor: "UTG", action: "call", amount: 9 },
  ],
  preflopPotBb: 19,
  preflopCallBb: 0,
});
```

- [ ] **Step 2: Run RED, implement adapter, and run GREEN**

Run: `node tests/preflopBuilderModel.test.cjs`

Expected before implementation: FAIL because `toLegacyPreflopInput` is undefined.

Map the first aggressive action from `raise` to legacy `open`; subsequent aggressive actions remain `raise`. Pick villain as the first meaningful non-Hero aggressor/caller. Convert half-bb units to numbers only at this boundary.

- [ ] **Step 3: Add failing wiring assertions for app integration**

Assert that `public/app.js` creates one builder instance, exposes `getManualPreflopInput`, uses its result inside manual `analyze()`, routes `onContinueFlop` to `setVisibleStreet("flop")`, and routes New Hand to the builder’s reset method.

- [ ] **Step 4: Run wiring test and verify RED**

Run: `node tests/preflopBuilderWiring.test.cjs`

Expected: FAIL because the builder is not instantiated in `app.js`.

- [ ] **Step 5: Integrate without changing backend payload contracts**

Instantiate the view after existing helper declarations and before event registration:

```js
const preflopBuilder = window.PokerCoachPreflopBuilderView.createPreflopBuilderView({
  root: $("preflopBuilder"),
  model: window.PokerCoachPreflopBuilderModel,
  initialState: window.PokerCoachPreflopBuilderModel.createInitialState({ settings: loadManualBuilderSettings() }),
  onStateChange: syncManualPreflopCompatibility,
  onAnalyze: () => analyze("preflop"),
  onContinueFlop: () => setVisibleStreet("flop"),
});
```

Make manual analysis read `getManualPreflopInput()` while imported-hand analysis remains untouched. Sync hidden compatibility fields only where untouched post-flop code still reads them. Remove superseded `setupActionSequence("preflop")` and duplicate pre-flop button listeners. Keep post-flop action sequence setup unchanged.

- [ ] **Step 6: Verify static compatibility and existing behavior tests**

Run: `npm run check && npm run test:preflop-builder && node tests/preflopBuilderWiring.test.cjs && for test_file in tests/*.cjs tests/*.mjs; do node "$test_file"; done`

Expected: all commands PASS; existing import and analysis tests remain green.

- [ ] **Step 7: Commit integration**

```bash
git add public/preflopBuilderModel.js public/app.js public/index.html tests/preflopBuilderModel.test.cjs tests/preflopBuilderWiring.test.cjs
git commit -m "feat: connect visual builder to preflop analysis"
```

---

### Task 6: Premium responsive visual system and interaction states

**Files:**
- Modify: `public/styles.css`
- Modify: `tests/preflopBuilderWiring.test.cjs`

**Interfaces:**
- Consumes: class names and semantic markup introduced in Tasks 3–5.
- Produces: responsive layout at desktop, tablet, and mobile; reduced-motion and focus-visible behavior.

- [ ] **Step 1: Add failing CSS contract tests**

Read `public/styles.css` and assert it contains selectors/tokens for `.builder-layout`, `.poker-table`, `.poker-seat.is-hero`, `.next-action-panel`, `.card-picker-grid`, `.preflop-timeline`, `:focus-visible`, `@media (max-width: 1024px)`, `@media (max-width: 720px)`, and `@media (prefers-reduced-motion: reduce)`.

- [ ] **Step 2: Run wiring test and verify RED**

Run: `node tests/preflopBuilderWiring.test.cjs`

Expected: FAIL on the first missing redesigned selector.

- [ ] **Step 3: Extend semantic tokens and implement desktop layout**

Add tokens for three surface elevations, subtle/strong borders, focus ring, aggressive gold, continue green, danger, radii, and 150/220 ms motion. Build a two-column layout with a flexible table column and a 340–400 px right rail. Use an oval felt with CSS gradients and seat coordinates; use `font-variant-numeric: tabular-nums` for amounts.

- [ ] **Step 4: Implement modal, states, and responsive breakpoints**

Ensure 44 px minimum targets, visible text labels, disabled opacity plus cursor changes, focus rings, and no color-only state. At 1024 px stack the right rail below the table. At 720 px make settings single-column, scale the table without page overflow, move seats inward, and make the card dialog a full-width sheet. Disable nonessential transitions under reduced motion.

- [ ] **Step 5: Run tests and perform automated syntax verification**

Run: `node tests/preflopBuilderWiring.test.cjs && npm run test:preflop-builder && npm run check && for test_file in tests/*.cjs tests/*.mjs; do node "$test_file"; done`

Expected: PASS with no syntax errors.

- [ ] **Step 6: Commit visual implementation**

```bash
git add public/styles.css tests/preflopBuilderWiring.test.cjs
git commit -m "style: redesign the preflop builder workspace"
```

---

### Task 7: Browser walkthrough, regression fixes, and final verification

**Files:**
- Modify as required by observed defects: `public/preflopBuilderModel.js`, `public/preflopBuilderView.js`, `public/index.html`, `public/styles.css`, `public/app.js`
- Modify corresponding tests first: `tests/preflopBuilderModel.test.cjs`, `tests/preflopBuilderWiring.test.cjs`

**Interfaces:**
- Consumes: complete visual builder from Tasks 1–6.
- Produces: verified workflow with no known regression in Screenshot Import, analysis, or post-flop continuation.

- [ ] **Step 1: Start the application and record the local URL**

Run: `npm run dev`

Expected: server starts successfully and reports the local Poker Coach URL.

- [ ] **Step 2: Walk through New Hand and Hero/card selection**

Verify New Hand clears actions/cards but preserves changed settings; choose BTN as Hero; open the picker; select A♠ and K♦; deselect one; choose Q♦; confirm; reopen and cancel; verify focus returns and state remains unchanged.

- [ ] **Step 3: Walk through contextual betting and editing**

Build UTG raise 2.5 bb → intervening folds → Hero SB 3-bet 9 bb → BB fold → UTG call. Verify each inferred actor, only legal controls, pot 19 bb, compact fold display, and Analyze enabled. Edit the SB action to 10 bb and verify later actions truncate and the next actor/pot recompute.

- [ ] **Step 4: Verify analysis and post-flop handoff**

Restore the 9 bb sequence, click Analyze Pre-flop, and verify the existing result panels populate or show their existing recoverable provider error without losing hand state. Click Continue to Flop and verify the existing flop UI receives Hero SB, `Ah Kh`, pre-flop actions, and 19 bb.

- [ ] **Step 5: Verify modes and responsive behavior**

Switch to Screenshot Import and back without losing manual state. Confirm Quick Entry is visibly unavailable. Inspect widths around 1440, 1024, 768, and 375 px: no page-level horizontal scrolling, table/actions remain usable, opponent assumptions collapse, and dialog content remains reachable by keyboard.

- [ ] **Step 6: For every defect, add a failing regression test before fixing it**

Add the smallest assertion to `tests/preflopBuilderModel.test.cjs` for state defects or `tests/preflopBuilderWiring.test.cjs` for integration/style defects. Run it to observe the expected failure, implement the minimal correction, then rerun until green.

- [ ] **Step 7: Run final verification**

Run: `npm run check && npm run test:preflop-builder && node tests/preflopBuilderWiring.test.cjs && for test_file in tests/*.cjs tests/*.mjs; do node "$test_file"; done && git diff --check`

Expected: every command PASS, no warnings caused by the new builder, and no whitespace errors.

- [ ] **Step 8: Review scope and commit final fixes**

Run: `git status --short && git diff --stat HEAD~6..HEAD`

Confirm unrelated `docs/research/` and `scripts/build_toolpoker_report.py` files remain untouched and uncommitted.

```bash
git add public/preflopBuilderModel.js public/preflopBuilderView.js public/index.html public/styles.css public/app.js tests/preflopBuilderModel.test.cjs tests/preflopBuilderWiring.test.cjs package.json
git commit -m "fix: polish preflop builder workflow"
```

Skip the final commit if the walkthrough required no corrections.
