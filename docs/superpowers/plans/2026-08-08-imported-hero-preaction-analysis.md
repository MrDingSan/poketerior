# Imported Hero Pre-Action Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analyze imported completed Hero actions from the decision state immediately before they occurred, using real poker actions instead of Review.

**Architecture:** Correct the pure imported decision model so Hero targets preserve the recorded action separately while excluding it from calculation rows and producing a non-terminal node. Feed the recorded action alongside real legal actions into shared analysis facts and PokerSkill prompts for explicit recommendation-versus-recorded comparison.

**Tech Stack:** Browser JavaScript, Node.js VM regression tests, Node ES modules, `node:assert`.

## Global Constraints

- “Review Point” remains a UI navigation label only.
- `Review` must never be a legal poker action for an imported Hero decision.
- The recorded Hero action must not affect the pre-action pot state.
- Opponent-target import behavior and manual-mode terminal review behavior must remain unchanged.
- All production changes are test-first.

---

### Task 1: Model imported Hero targets as pre-action decisions

**Files:**
- Modify: `public/importDecisionModel.js`
- Modify: `tests/importDecisionModel.test.cjs`
- Modify: `tests/multiwayImportedDecision.test.cjs`

**Interfaces:**
- Extends `buildImportedDecisionContext` with `recordedHeroAction` and `recordedHeroAmount`.
- Changes Hero-target `actionsThroughTarget` to stop immediately before the target action.
- Changes `decisionNodeForImportedContext` to return a non-terminal pre-action node for Hero targets.

- [ ] **Step 1: Write failing first-to-act and checked-to regressions**

Assert that Hero's first flop check yields zero calculation rows, records `check`, produces `terminal: false`, and receives Check/Bet from `legalActionsForNode`. Add Hero bet after opponent check and assert the preceding opponent check remains while Hero's bet is excluded; legal actions remain Check/Bet.

- [ ] **Step 2: Write failing bet-response regressions**

Assert Hero call after a normal bet excludes the call and yields Fold/Call/Raise. Assert Hero call after an opponent all-in yields Fold/Call. Preserve the actual call as `recordedHeroAction`.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node tests/importDecisionModel.test.cjs && node tests/multiwayImportedDecision.test.cjs`

Expected: FAIL because Hero targets are terminal and produce Review.

- [ ] **Step 4: Implement pre-action row slicing and node semantics**

For Hero targets, slice current-street rows at `targetIndex`; for opponent targets, retain `targetIndex + 1`. Store recorded action/amount independently. Hero-target nodes describe evaluating the decision before the recorded action, remain non-terminal, and set `facingBet`/`facingAllIn` from the last unresolved preceding opponent aggression.

- [ ] **Step 5: Update validation**

Reject `Review` if it appears in an imported node's legal actions. Continue validating active opponent positions and unresolved opponent aggression.

- [ ] **Step 6: Run focused and full tests**

Run: `node tests/importDecisionModel.test.cjs && node tests/multiwayImportedDecision.test.cjs && npm run check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/importDecisionModel.js tests/importDecisionModel.test.cjs tests/multiwayImportedDecision.test.cjs
git commit -m "fix: analyze imported hero actions before they occur"
```

### Task 2: Ground PokerSkill in real actions and recorded-action comparison

**Files:**
- Modify: `public/app.js`
- Modify: `src/analysis/pipeline.js`
- Modify: `tests/strategicPromptSanitization.test.mjs`
- Modify: `tests/multiwayImportedDecision.test.cjs`

**Interfaces:**
- Consumes `recordedHeroAction` and `recordedHeroAmount` from Task 1.
- Adds recorded action to the shared spot/debug payload while retaining real `legalActions`.

- [ ] **Step 1: Write a failing shared-facts regression**

Assert the imported Hero check reaches analysis with `legalActions: ["Check", "Bet"]`, `recordedHeroAction: "check"`, and no `Review` recommendation constraint.

- [ ] **Step 2: Write a failing PokerSkill prompt regression**

Assert the PokerSkill prompt requires one recommendation from the real legal actions and a comparison with the recorded Hero action. Assert it does not describe Review as a candidate or recommendation.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `node tests/multiwayImportedDecision.test.cjs && node tests/strategicPromptSanitization.test.mjs`

Expected: FAIL because the recorded action is not propagated or compared.

- [ ] **Step 4: Propagate recorded-action facts**

Include `recordedHeroAction` and `recordedHeroAmount` in the imported decision node/spot passed to analysis. Keep `Review Point` only in importer presentation code.

- [ ] **Step 5: Update PokerSkill instructions and prompt**

When a recorded action exists, require PokerSkill to recommend a legal action first, then state whether it agrees with the recorded action and explain any disagreement. Preserve existing legal-action hard constraints.

- [ ] **Step 6: Run full verification and restart**

Run: `npm run check`. Restart the exact process listening on port 4175, start `npm run dev` from the current branch, and verify `curl -fsS http://localhost:4175/` succeeds.

- [ ] **Step 7: Commit**

```bash
git add public/app.js src/analysis/pipeline.js tests/strategicPromptSanitization.test.mjs tests/multiwayImportedDecision.test.cjs
git commit -m "fix: compare PokerSkill advice with recorded hero action"
```
