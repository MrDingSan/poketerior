# Screenshot Import Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce valid Hold'em card structure on screenshot imports and retain raw vision output in every associated analysis log.

**Architecture:** Add a focused server-side import validation module, call it immediately after parsing vision JSON, and expose structured debug data from the import pipeline. Assign each import an ID and associate that record with later analysis-log creation through the browser payload.

**Tech Stack:** Node.js ES modules, browser JavaScript, Node assertion-based tests, filesystem JSON logs.

## Global Constraints

- A flop contains exactly three cards when present; turn and river contain at most one card each.
- Hero and community cards represent unique physical cards.
- Never log image base64 or API credentials.
- Store complete raw model text without truncation for debugging.

---

### Task 1: Hold'em import normalization

**Files:**
- Create: `src/analysis/importValidation.js`
- Create: `tests/importValidation.test.mjs`
- Modify: `src/analysis/pipeline.js`

**Interfaces:**
- Produces: `normalizeAndValidateImportedCards(hand)` returning `{ hand, notes }` or throwing an actionable error.

- [ ] Write failing tests for splitting a five-card flop array and rejecting duplicate/colliding cards.
- [ ] Run `node tests/importValidation.test.mjs` and confirm the missing implementation fails.
- [ ] Implement normalization and validation, then invoke it after vision parsing and focused hero verification.
- [ ] Run `node tests/importValidation.test.mjs` and confirm it passes.

### Task 2: Vision debug persistence and analysis association

**Files:**
- Modify: `src/analysis/pipeline.js`
- Modify: `src/server/server.js`
- Modify: `public/app.js`
- Create: `tests/visionDebugLogging.test.mjs`

**Interfaces:**
- Import response produces `importId` and non-sensitive debug metadata.
- Analysis-log start consumes `importId` and copies the server-side import record into `visionImport`.

- [ ] Write failing tests proving complete raw vision text is retained and associated without image base64.
- [ ] Run `node tests/visionDebugLogging.test.mjs` and confirm failure for missing behavior.
- [ ] Capture raw primary/focused responses, persist import records, pass `importId` from browser analysis startup, and attach the record to the analysis log.
- [ ] Run `node tests/visionDebugLogging.test.mjs` and confirm it passes.

### Task 3: Prompt constraints, verification, and deployment

**Files:**
- Modify: `src/analysis/pipeline.js`
- Modify: `package.json`

**Interfaces:**
- Vision prompt states the authoritative 3/1/1 and uniqueness constraints.

- [ ] Add prompt assertions to the regression tests and update the prompt.
- [ ] Add new regression tests to `npm run check`.
- [ ] Run `npm run check` and inspect all output for zero failures.
- [ ] Determine the active local server process, restart it safely, and verify `GET /api/health`.
