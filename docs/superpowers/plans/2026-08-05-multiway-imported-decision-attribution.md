# Multiway Imported Decision Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make imported multiway decision points analyze the selected hero's next unresolved decision using actual actor identities.

**Architecture:** Extend the pure import decision model to build an actor-aware context for the clicked action, including normalized positions, target actor, primary aggressor, and actions through the target. Pass that context explicitly into the manual analyzer so it overrides the heads-up ordinal inference only for imported decisions, then validate the derived node before any LLM request.

**Tech Stack:** Browser JavaScript, Node.js, Node `assert`, VM-loaded browser modules, existing Poker Coach action and pot-state models.

## Global Constraints

- Preserve actual imported actor names and positions through the clicked action.
- Map imported `UTG+1` and `HJ` to internal six-max `MP` without changing their displayed imported labels.
- Exclude actions after the clicked action, including Hero's historical response.
- Use the clicked non-hero aggressor as primary villain.
- Do not change screenshot vision extraction or multi-opponent equity modeling.
- Never send a Review node for an unresolved non-hero aggressive target.

---

## File Structure

- `public/importDecisionModel.js`: pure position normalization, actor-aware context construction, imported-node derivation, and consistency validation.
- `public/app.js`: consume the context while loading and analyzing an imported decision.
- `tests/importDecisionModel.test.cjs`: unit tests for normalized positions, context construction, heads-up compatibility, and guards.
- `tests/multiwayImportedDecision.test.cjs`: exact regression for analysis `pc_20260805123754_10c7ac6d`.
- `package.json`: include the exact regression in the full check command.

---

### Task 1: Build an actor-aware imported decision context

**Files:**
- Modify: `public/importDecisionModel.js`
- Modify: `tests/importDecisionModel.test.cjs`

**Interfaces:**
- Produces: `normalizeAnalyzerPosition(position) -> string | null`.
- Produces: `buildImportedDecisionContext(hand, targetStreet, targetIndex, heroName) -> ImportedDecisionContext`.
- `ImportedDecisionContext` contains `heroName`, `heroPosition`, `displayHeroPosition`, `targetActor`, `targetPosition`, `targetAction`, `targetIsHero`, `actionsThroughTarget`, `heroHasResponded`, and `primaryVillainPosition`.

- [ ] **Step 1: Write failing position and multiway-context tests**

Add the reported hand fixture and assertions:

```js
assert.equal(model.normalizeAnalyzerPosition("UTG+1"), "MP");
assert.equal(model.normalizeAnalyzerPosition("HJ"), "MP");

const context = model.buildImportedDecisionContext(multiwayHand, "river", 1, "dingsanpro");
assert.deepEqual(JSON.parse(JSON.stringify(context)), {
  heroName: "dingsanpro",
  heroPosition: "MP",
  displayHeroPosition: "UTG+1",
  targetActor: "GordonCole",
  targetPosition: "BB",
  targetAction: "bet",
  targetAmount: 7.35,
  targetIsHero: false,
  actionsThroughTarget: [
    { actorName: "dofamin", actor: "SB", action: "check", amount: "" },
    { actorName: "GordonCole", actor: "BB", action: "bet", amount: 7.35 },
  ],
  heroHasResponded: false,
  primaryVillainPosition: "BB",
});
```

- [ ] **Step 2: Run the unit test and verify it fails**

Run: `node tests/importDecisionModel.test.cjs`

Expected: FAIL because the two exported functions do not exist.

- [ ] **Step 3: Implement position normalization and context construction**

Normalize `UTG+1` and `HJ` to `MP`; return existing supported positions unchanged and `null` otherwise. Include actions only through `targetIndex`. Select the clicked actor as primary villain when its action is `bet`, `raise`, or `allin`; otherwise choose the most recent non-hero aggressor through the target, then the clicked non-hero actor.

Every mapped row must use:

```js
{
  actorName: action.actor || null,
  actor: normalizeAnalyzerPosition(actorPosition(hand, action)) || "MP",
  action: mappedAction,
  amount: action.amountBb || "",
}
```

- [ ] **Step 4: Run the unit test and verify it passes**

Run: `node tests/importDecisionModel.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit the context model**

```bash
git add public/importDecisionModel.js tests/importDecisionModel.test.cjs
git commit -m "fix: model imported multiway decision actors"
```

---

### Task 2: Derive and validate imported decision nodes explicitly

**Files:**
- Modify: `public/importDecisionModel.js`
- Modify: `tests/importDecisionModel.test.cjs`

**Interfaces:**
- Consumes: `ImportedDecisionContext` from Task 1.
- Produces: `decisionNodeForImportedContext(context, streetLabel) -> DecisionNode`.
- Produces: `validateImportedDecisionNode(context, node) -> { valid: boolean, errors: string[] }`.

- [ ] **Step 1: Write failing node-derivation tests**

```js
const node = model.decisionNodeForImportedContext(context, "River");
assert.deepEqual(node, {
  street: "River",
  title: "River Node: Hero facing BB bet",
  description: "BB bet 7.35bb and Hero has the next unresolved decision.",
  facingBet: true,
  facingAllIn: false,
  importedTargetIsHero: false,
});
assert.deepEqual(model.validateImportedDecisionNode(context, { ...node, legalActions: ["Fold", "Call", "Raise"] }), {
  valid: true,
  errors: [],
});
assert.equal(
  model.validateImportedDecisionNode(context, { ...node, facingBet: false, legalActions: ["Review"] }).valid,
  false,
);
```

Also retain a Hero-target test that produces a terminal Review node and a heads-up opponent-check test that produces Hero's pending check/bet decision.

- [ ] **Step 2: Run the model test and verify it fails**

Run: `node tests/importDecisionModel.test.cjs`

Expected: FAIL because node derivation and validation are absent.

- [ ] **Step 3: Implement actor-aware node derivation**

Rules:

```js
if (context.targetIsHero) return explicitReviewNode;
if (["bet", "raise", "allin"].includes(context.targetAction)) return heroFacingTargetNode;
return heroPendingAfterOpponentActionNode;
```

Set `facingAllIn` only for `allin`. Validation rejects Review without `targetIsHero`, unresolved aggressive targets with `facingBet: false`, unsupported positions, or identical hero/villain positions.

- [ ] **Step 4: Run the model tests and verify they pass**

Run: `node tests/importDecisionModel.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit node derivation and guards**

```bash
git add public/importDecisionModel.js tests/importDecisionModel.test.cjs
git commit -m "fix: derive imported nodes from target actors"
```

---

### Task 3: Wire the imported context into analysis

**Files:**
- Modify: `public/app.js`
- Create: `tests/multiwayImportedDecision.test.cjs`

**Interfaces:**
- Consumes: `buildImportedDecisionContext`, `decisionNodeForImportedContext`, and `validateImportedDecisionNode`.
- Changes: `analyze(triggerButton = null, importedCacheState = null, importedDecisionContext = null)`.
- Changes: `loadImportedDecision` builds and supplies the explicit context.

- [ ] **Step 1: Write a failing source-wiring regression**

The test loads `public/importDecisionModel.js`, constructs the exact reported context, derives its node, and asserts:

```js
assert.equal(context.heroPosition, "MP");
assert.equal(context.primaryVillainPosition, "BB");
assert.equal(node.title, "River Node: Hero facing BB bet");
assert.equal(node.facingBet, true);
assert.notDeepEqual(legalActionsForNode(node), ["Review"]);
assert.deepEqual(context.actionsThroughTarget.map((row) => `${row.actor}:${row.action}`), ["SB:check", "BB:bet"]);
```

It also reads `public/app.js` and verifies `loadImportedDecision` passes the context into `analyze` rather than relying solely on `currentDecisionNode(sequence)`.

- [ ] **Step 2: Run the exact regression and verify it fails**

Run: `node tests/multiwayImportedDecision.test.cjs`

Expected: FAIL because `app.js` does not pass an explicit imported context.

- [ ] **Step 3: Use the context in `loadImportedDecision`**

Build the context before setting form controls. If context construction fails, show `Cannot analyze imported point: <reason>` and return. Set the hero selector to `context.heroPosition`, villain selector to `context.primaryVillainPosition`, and populate target-street rows from `context.actionsThroughTarget`.

Continue using normal imported rows for prior streets. Do not include actions after the target.

- [ ] **Step 4: Override and validate the node inside `analyze`**

After generic node creation, replace it only when `importedDecisionContext` is supplied:

```js
const decisionNode = importedDecisionContext
  ? IMPORT_DECISION_MODEL.decisionNodeForImportedContext(importedDecisionContext, streetLabel(street))
  : currentDecisionNode(sequence);
```

Apply existing preflop handling only without an imported override. After legal actions are calculated, call `validateImportedDecisionNode`; throw its joined errors before range calculation or LLM calls. The existing `combinedPotState` supplies the 7.35bb call amount from the BB bet.

- [ ] **Step 5: Run exact, model, policy, and syntax tests**

Run:

```bash
node tests/multiwayImportedDecision.test.cjs
node tests/importDecisionModel.test.cjs
node tests/actionPolicy.test.cjs
node --check public/app.js
```

Expected: PASS.

- [ ] **Step 6: Commit analyzer wiring**

```bash
git add public/app.js tests/multiwayImportedDecision.test.cjs
git commit -m "fix: analyze imported multiway hero decisions"
```

---

### Task 4: Full regression and live verification

**Files:**
- Modify: `package.json`

**Interfaces:**
- Adds `tests/multiwayImportedDecision.test.cjs` to `npm run check`.

- [ ] **Step 1: Add the regression to the full check command**

Insert `node tests/multiwayImportedDecision.test.cjs` beside the existing imported-decision tests.

- [ ] **Step 2: Run the complete suite**

Run: `npm run check`

Expected: exit code 0, including the exact multiway regression and all existing heads-up tests.

- [ ] **Step 3: Restart the local application and verify health**

Restart the existing detached local service and run:

```bash
curl --fail --silent http://localhost:4175/ >/dev/null
```

Expected: exit code 0 and a persistent serving process.

- [ ] **Step 4: Reproduce the reported point in the browser**

Open the imported hand corresponding to `pc_20260805123754_10c7ac6d` or re-upload its screenshot. Click Analyze Point on `BB bet 7.35bb` and verify:

- Node says Hero facing BB bet.
- Call amount is 7.35bb.
- Recommendation is not Review.
- Raw action history still says SB check then BB bet.
- PokerSkill and Harrington prompts agree with the actor-aware node.

- [ ] **Step 5: Inspect the new analysis log**

Confirm `pokerFacts` contains internal hero position `MP`, villain position `BB`, `decisionNode: "River Node: Hero facing BB bet"`, `facingBet: true`, call 7.35, and non-Review legal actions.

- [ ] **Step 6: Run final verification**

```bash
git diff --check
npm run check
curl --fail --silent http://localhost:4175/ >/dev/null
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit the suite wiring**

```bash
git add package.json
git commit -m "test: cover multiway imported decision attribution"
```
