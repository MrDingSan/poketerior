# Nonblocking Card-Collision Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return collision-bearing screenshot imports for manual review while preventing invalid calculations.

**Architecture:** Convert physical-card collision failures in server normalization into structured warnings. Add a small browser-side imported-card validity helper that controls warning rendering and decision-button availability after every edit.

**Tech Stack:** Node.js ES modules, browser JavaScript, Node assertion tests.

## Global Constraints

- Never calculate equity or blockers with duplicate physical cards.
- Do not reject an otherwise parseable screenshot import solely for card collisions.
- Preserve deterministic CoinPoker suit repair and debug logging.

### Task 1: Nonblocking server collision warnings

**Files:**
- Modify: `src/analysis/importValidation.js`
- Modify: `src/analysis/pipeline.js`
- Modify: `tests/importValidation.test.mjs`

- [ ] Write a failing test requiring unresolved collisions to return warnings.
- [ ] Run the focused test and confirm the collision still throws.
- [ ] Return structured warnings and include them in import/debug results.
- [ ] Run the focused test and confirm it passes.

### Task 2: Editable review validity gate

**Files:**
- Create: `public/importCardValidity.js`
- Modify: `public/index.html`
- Modify: `public/app.js`
- Create: `tests/importCardValidity.test.cjs`

- [ ] Write failing tests for collision detection and valid corrected cards.
- [ ] Run the focused test and confirm the helper is missing.
- [ ] Implement the helper, warning UI, and decision-button gate with edit-time refresh.
- [ ] Run the focused test and confirm it passes.

### Task 3: Verification and deployment

**Files:**
- Modify: `package.json`

- [ ] Add new checks to the project verification script.
- [ ] Run `npm run check` with zero failures.
- [ ] Restart the detached `pokercoach4175` service and verify `/api/health` from a new listener PID.
