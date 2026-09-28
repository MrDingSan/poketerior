# PokeTerior UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand and reorganize the existing PokerCoach browser UI as PokeTerior while preserving all current builder, poker-state, range, AI, solver, API, and diagnostic behavior.

**Architecture:** Keep the current vanilla HTML/CSS/JavaScript architecture and stable DOM IDs. Refactor the static shell and view-generated semantic markup, apply a new tokenized visual system, and reorganize existing analysis output through CSS/HTML progressive disclosure rather than changing model or API behavior.

**Tech Stack:** HTML5, CSS3, browser JavaScript, Node.js built-in test runner/assertions, existing local Node server

**Spec:** `docs/superpowers/specs/2026-09-15-poketerior-ui-refactor-design.md`

## Global Constraints

- Preserve Manual Builder and Screenshot Import behavior and state isolation.
- Do not change poker calculations, strategic semantics, solver logic, or API contracts.
- Keep the oval poker table as the primary hand visualization.
- Retain detailed analysis, fallback output, and diagnostics through progressive disclosure.
- Do not add a framework or branding dependency.
- Desktop is primary; narrow layouts must stack sensibly.
- Preserve unrelated changes already present in the working tree.

---

### Task 1: Lock the PokeTerior Shell Contract

**Files:**
- Modify: `public/index.html`
- Create: `tests/poketeriorShell.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Existing application DOM IDs used by `public/app.js` and builder views.
- Produces: Stable PokeTerior shell landmarks and analysis disclosure containers without renaming behavioral hooks.

- [ ] **Step 1: Write the failing shell test**

Create `tests/poketeriorShell.test.cjs` using `fs.readFileSync` and `node:assert/strict`. Assert that `public/index.html` contains the title `PokeTerior`, the subtitle `Posterior reasoning for better poker decisions`, all three existing mode IDs, the existing builder IDs, analysis tab labels (`Ranges`, `Equity`, `AI Analysis`, `Breakdown`), and a closed `<details>` element whose summary contains `Developer Details` or `Diagnostics`. Also assert that the standalone `.brand-mark` element and visible `Poker Coach` text are absent.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/poketeriorShell.test.cjs`

Expected: FAIL because `public/index.html` still identifies the product as Poker Coach and lacks the new analysis landmarks.

- [ ] **Step 3: Implement the semantic shell**

Update `public/index.html` to:

- Use `PokeTerior` in the document title and an accessible text wordmark in `.brand-lockup`.
- Render “Poke” and “Terior” as separate spans, with the spade attached to the “i” through CSS rather than a standalone icon.
- Add the approved subtitle and retain `resetHandBtn` as New Hand.
- Add small icon/copy wrappers to the three existing mode buttons without changing their IDs or disabled state.
- Wrap shared analysis in a `.analysis-workspace` with a presentational tab bar and summary-card classes while retaining every existing output ID.
- Put calculation logs, full range details, Harrington/PokerSkill long output, prompt debug, and related technical surfaces inside initially closed `<details>` elements. Do not delete their target elements.

- [ ] **Step 4: Add the shell test to the check script and verify**

Add `node tests/poketeriorShell.test.cjs` to `npm run check`, then run:

```bash
node tests/poketeriorShell.test.cjs
npm run test:unified-builder
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the shell contract**

```bash
git add public/index.html tests/poketeriorShell.test.cjs package.json
git commit -m "feat: establish PokeTerior application shell"
```

### Task 2: Implement Brand Tokens and Builder Layout

**Files:**
- Modify: `public/styles.css`
- Modify: `tests/poketeriorShell.test.cjs`

**Interfaces:**
- Consumes: Semantic classes and unchanged IDs from Task 1.
- Produces: Dark forest/charcoal/emerald design tokens and responsive builder layout.

- [ ] **Step 1: Extend the failing test for visual tokens**

Read `public/styles.css` in `tests/poketeriorShell.test.cjs` and assert it declares `--accent: #20` or another explicit emerald hex value, includes `.brand-word-poke`, `.brand-word-terior`, `.brand-spade`, `.analysis-workspace`, and responsive rules for `.street-navigator` and the builder rail. Assert the old primary token `--accent: #d6b15d` is absent.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/poketeriorShell.test.cjs`

Expected: FAIL on the new CSS assertions.

- [ ] **Step 3: Replace global presentation tokens**

Update `public/styles.css` with one authoritative `:root` palette for near-black background, charcoal-green panels, emerald accent, warm off-white text, muted secondary text, restrained borders, success/warning/error colors, radii, spacing, and shadows. Remove gold token usage from primary buttons, focus rings, active tabs, timelines, table commitments, and card selection.

- [ ] **Step 4: Restyle the shell and builder**

Implement:

- Compact header, text wordmark, subtitle, and outlined emerald New Hand button.
- Understated three-segment mode navigation.
- Desktop preflop/postflop layouts with street navigation, table, decision rail, and timeline hierarchy.
- Deep muted felt, restrained table rim, compact seat cards, readable board cards and pot, subtle current-actor/Hero emphasis.
- Neutral legal-action buttons, emerald selected/recommended states, compact opponent assumptions, and dominant Analyze CTA.
- Completed/current/future street states and previous/transition/current timeline states.
- `max-width: 1024px` and `max-width: 720px` behavior that moves the rail below the table, makes street navigation horizontal, and stacks analysis blocks.
- `prefers-reduced-motion` preservation.

- [ ] **Step 5: Verify brand CSS and existing rendering tests**

Run:

```bash
node tests/poketeriorShell.test.cjs
node tests/preflopBuilderWiring.test.cjs
node tests/postflopBuilderWiring.test.cjs
node tests/handWorkspaceView.test.cjs
```

Expected: all PASS.

- [ ] **Step 6: Commit the visual system**

```bash
git add public/styles.css tests/poketeriorShell.test.cjs
git commit -m "feat: apply PokeTerior visual system"
```

### Task 3: Refine View-Generated Decision and Timeline Markup

**Files:**
- Modify: `public/preflopBuilderView.js`
- Modify: `public/postflopBuilderView.js`
- Modify: `public/handWorkspaceView.js`
- Modify: `tests/preflopBuilderWiring.test.cjs`
- Modify: `tests/postflopBuilderWiring.test.cjs`
- Modify: `tests/handWorkspaceView.test.cjs`

**Interfaces:**
- Consumes: Existing builder model snapshots and callbacks; no model signature changes.
- Produces: Semantic state classes and PokeTerior labels on existing interactive controls.

- [ ] **Step 1: Add failing view assertions**

Extend the existing wiring/view tests to assert that generated markup includes `Your Decision`, explicit semantic classes for current decisions and completed/current/future streets, and a `Decision path`/`Hand Timeline` label. Keep existing assertions for button data attributes, legal actions, and callbacks.

- [ ] **Step 2: Run focused tests to verify failure**

Run:

```bash
node tests/preflopBuilderWiring.test.cjs
node tests/postflopBuilderWiring.test.cjs
node tests/handWorkspaceView.test.cjs
```

Expected: at least one new semantic assertion FAILS while existing behavior assertions still pass.

- [ ] **Step 3: Implement presentation-only markup changes**

Update the three view files to add semantic classes and concise labels without altering callbacks, action values, dataset attributes, replay state, or selected decision identity. Ensure current actions receive an emerald-targetable class, completed streets include accessible completion text, and future streets remain distinguishable without relying on color alone.

- [ ] **Step 4: Run focused tests**

Run the three commands from Step 2.

Expected: all PASS.

- [ ] **Step 5: Commit view refinements**

```bash
git add public/preflopBuilderView.js public/postflopBuilderView.js public/handWorkspaceView.js tests/preflopBuilderWiring.test.cjs tests/postflopBuilderWiring.test.cjs tests/handWorkspaceView.test.cjs
git commit -m "feat: refine PokeTerior builder hierarchy"
```

### Task 4: Add Analysis Summary and Safe Diagnostic Disclosure

**Files:**
- Modify: `public/postflopAnalysisView.js`
- Modify: `public/app.js`
- Modify: `tests/resultsLayout.test.cjs`
- Modify: `tests/llmOnlyRangeUi.test.cjs`
- Create: `tests/poketeriorDiagnostics.test.cjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: Existing analysis payloads, range interpretations, solver results, and DOM target IDs.
- Produces: Compact recommendation/range summaries and sanitized user-facing error states; full raw detail remains available in diagnostics.

- [ ] **Step 1: Write failing analysis hierarchy tests**

Extend `tests/resultsLayout.test.cjs` to assert the analysis surface contains Estimated Range, Board Texture, Range Evolution, Recommended Action, and the existing metric IDs. Extend `tests/llmOnlyRangeUi.test.cjs` so range errors require the concise phrase `AI range analysis unavailable` and a retry control rather than interpolating the raw error into the primary range summary.

Create `tests/poketeriorDiagnostics.test.cjs` to inspect `public/app.js` and assert that raw error content is routed to a diagnostics target while the primary status uses a stable generic message. Assert that prompt debug/model metadata targets remain present and are not deleted.

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node tests/resultsLayout.test.cjs
node tests/llmOnlyRangeUi.test.cjs
node tests/poketeriorDiagnostics.test.cjs
```

Expected: FAIL because the current primary interface exposes interpolated error text and lacks the complete new hierarchy.

- [ ] **Step 3: Implement compact analysis rendering**

Update `public/postflopAnalysisView.js` and the relevant render helpers in `public/app.js` to:

- Lead with recommended action and available metrics.
- Keep the 13×13 matrix and live combo count prominent.
- Label range history as Prior Range and street Posterior Range snapshots.
- Render board texture and range evolution summaries from already available analysis data; omit unavailable metrics instead of fabricating values.
- Preserve the existing longer explanation and structured provider output below the summary.

- [ ] **Step 4: Implement diagnostic separation**

Add a dedicated diagnostic target inside the collapsed details surface. Primary failures show `AI range analysis unavailable` (or the equivalent subsystem-specific status) and Retry. Raw `error.message`, endpoint data, model metadata, analysis IDs, prompt debug, and solver detail render only in the diagnostic target with HTML escaping preserved.

- [ ] **Step 5: Register and run focused tests**

Add `node tests/poketeriorDiagnostics.test.cjs` to `npm run check`, then run all three commands from Step 2 plus:

```bash
node tests/rangeMatrixView.test.cjs
node tests/solverUiLegalActionGuard.test.cjs
node tests/reasoningFailoverValidation.test.mjs
```

Expected: all PASS.

- [ ] **Step 6: Commit the analysis workspace**

```bash
git add public/postflopAnalysisView.js public/app.js tests/resultsLayout.test.cjs tests/llmOnlyRangeUi.test.cjs tests/poketeriorDiagnostics.test.cjs package.json
git commit -m "feat: reorganize PokeTerior analysis workspace"
```

### Task 5: Integrate the Approved Logo Asset and Verify End-to-End

**Files:**
- Replace: `resources/logo.png`
- Modify: `public/index.html` only if the final raster asset is used directly
- Modify: `public/styles.css` only for final visual corrections

**Interfaces:**
- Consumes: The approved attached PokeTerior wordmark and completed shell.
- Produces: A valid source logo asset plus a verified application build.

- [ ] **Step 1: Replace the invalid placeholder asset**

Copy the approved attached PNG to `resources/logo.png`. Verify with `file resources/logo.png` that it reports PNG image data. Keep the accessible HTML/CSS wordmark in the header unless the raster asset can be displayed on the dark background without its white canvas or loss of contrast.

- [ ] **Step 2: Run static and full automated checks**

Run:

```bash
node tests/poketeriorShell.test.cjs
node tests/poketeriorDiagnostics.test.cjs
npm run check
```

Expected: all PASS with no JavaScript syntax errors or behavioral regressions.

- [ ] **Step 3: Start the application and perform browser verification**

Run `npm run dev`, open the served local application, and verify:

1. PokeTerior branding and all three input modes render correctly.
2. A manual preflop hand can select Hero cards, choose actions, and analyze.
3. Continuing to flop/turn/river preserves the table, board entry, action selection, and street progression.
4. Screenshot Import still accepts an image and populates its isolated workspace.
5. Range matrix, combo count, range evolution, recommendation, metrics, and reasoning appear after analysis.
6. Forced range/AI failure shows a concise status and Retry while raw details remain collapsed.
7. At narrow width, street navigation is horizontal, the table remains primary, the action panel moves below it, and analysis blocks stack.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; only intended presentation, test, plan, and logo files are part of this refactor, alongside pre-existing user changes.

- [ ] **Step 5: Commit final integration corrections**

```bash
git add resources/logo.png public/index.html public/styles.css
git commit -m "chore: finalize PokeTerior brand integration"
```
