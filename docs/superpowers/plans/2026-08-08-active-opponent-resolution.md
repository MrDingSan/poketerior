# Active Opponent Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve imported postflop opponents from the complete hand history so Hero-first actions work in heads-up and multiway pots.

**Architecture:** Extend the pure browser-side import decision model with active-player derivation from folds and chronological actions. Build each decision context with every active opponent, then choose a primary villain using target actor and aggression precedence while retaining all opponents.

**Tech Stack:** Browser JavaScript, Node.js VM regression tests, `node:assert`.

## Global Constraints

- Do not invent opponent actions.
- Folded players must never remain active.
- Genuine multiway pots must retain every active opponent.
- Reject only when no distinct active opponent with a supported position can be resolved.
- Make the production change test-first.

---

### Task 1: Resolve active opponents and primary villain

**Files:**
- Modify: `public/importDecisionModel.js`
- Modify: `tests/multiwayImportedDecision.test.cjs`

**Interfaces:**
- Produces: `activeImportedOpponents(hand, targetStreet, targetIndex, heroName) -> Array<{ name, position, displayPosition }>`
- Extends: `buildImportedDecisionContext(...)` with `activeOpponents` and `primaryVillainName`.

- [ ] **Step 1: Write the failing reported-hand regression**

Add a fixture where Hero SB and Villain CO survive preflop while all other players fold. The flop begins with Hero checking. Assert the Hero review context contains only CO in `activeOpponents`, resolves `primaryVillainName` to `GordonCole`, resolves `primaryVillainPosition` to `CO`, and passes `validateImportedDecisionNode`.

- [ ] **Step 2: Add failing multiway and invalid-position regressions**

Add a three-way fixture where Hero acts first and assert both non-folded opponents remain in `activeOpponents`. Assert folded players are excluded. Add a fixture whose only opponent has an unsupported/missing position and assert validation still fails.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `node tests/multiwayImportedDecision.test.cjs`

Expected: FAIL because Hero's first action resolves no primary villain and the context lacks `activeOpponents`.

- [ ] **Step 4: Implement active-opponent derivation**

Traverse streets chronologically through the target index, collect folded actor identities, and derive active opponents from `hand.players`. Normalize supported positions with `normalizeAnalyzerPosition`. Preserve player-list order for deterministic fallback and export the pure helper.

- [ ] **Step 5: Update primary-villain precedence**

For opponent targets, prefer the clicked active target. For Hero targets, prefer the most recent active opponent aggressor, then the sole active opponent, then the most recent active preflop aggressor, then the first resolvable active opponent. Store both `primaryVillainName` and `primaryVillainPosition` without adding action rows.

- [ ] **Step 6: Run focused and full verification**

Run: `node tests/multiwayImportedDecision.test.cjs && npm run check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/importDecisionModel.js tests/multiwayImportedDecision.test.cjs
git commit -m "fix: resolve active opponents for imported reviews"
```

### Task 2: Restart and verify the local application

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes the committed browser/server code from Task 1.
- Produces a fresh process listening on port `4175`.

- [ ] **Step 1: Stop the stale process explicitly**

Resolve the single PID listening on `127.0.0.1:4175`, verify its command is `node src/server/server.js`, and terminate that PID without using a broad process pattern.

- [ ] **Step 2: Start the current branch**

Run:

```bash
screen -dmS pokercoach4175 zsh -lc 'cd /Users/kevinling0218/Documents/PokerCoach && npm run dev'
```

- [ ] **Step 3: Verify runtime and version freshness**

Run `curl -fsS http://localhost:4175/ >/dev/null`, confirm the listener start time is current, and confirm a new screenshot import log contains the current debug schema on the next user import.
