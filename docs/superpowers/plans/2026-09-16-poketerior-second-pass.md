# PokeTerior Second-Pass UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild PokeTerior as the approved dense AI poker inference dashboard while preserving poker behavior and making every imported decision use an explicit Analyze Street action.

**Architecture:** Introduce a small shared presentation model for hand progress and compact timeline nodes, then make the manual and imported view renderers consume that model inside one three-column hand-stage composition. Keep existing state models and the central `analyze()` pipeline; change only view markup, layout styling, and imported-decision launch coordination.

**Tech Stack:** Vanilla HTML, CSS Grid/Flexbox, browser JavaScript, Node.js built-in test runner patterns (`assert`, `vm`), existing PokerCoach/PokeTerior models.

**Spec:** `docs/superpowers/specs/2026-09-16-poketerior-second-pass-design.md`

## Global Constraints

- Desktop target is 1440–1600px; at 1600×900 the analysis cards begin inside the first viewport.
- Hand-stage desktop columns are `170px minmax(0, 1fr) 360px` with 10–12px gaps.
- Poker table is wider than tall; table area is 330–390px including the timeline region.
- Timeline is horizontal and 90–120px tall.
- Under 1050px, progress becomes horizontal, decision moves below the table, and analysis cards stack.
- Preserve all poker models, calculations, imported-hand editing, caches, APIs, solver integrations, and diagnostics.
- Imported decision selection prepares the node; explicit Analyze Street launches uncached analysis.
- Remove mustard, gold, tan, and yellow emphasis; use emerald for active state styling.
- Keep all interactive targets at least 44px and preserve visible keyboard focus.

---

### Task 1: Shared Hand-Stage Presentation Model

**Files:**
- Create: `public/handStagePresentation.js`
- Create: `tests/handStagePresentation.test.cjs`
- Modify: `public/index.html`

**Interfaces:**
- Consumes: normalized street names and chronological action arrays already produced by the existing builder/import models.
- Produces: `window.PokeTeriorHandStagePresentation.buildProgress(activeStreet, completedStreets)` and `buildTimeline(actions, selectedKey)`.

- [ ] **Step 1: Write the failing presentation-model test**

Use a `vm` sandbox to load the browser module. Assert literal progress states for flop (`preflop=complete`, `flop=current`, later streets pending) and assert that timeline output inserts one street separator while marking exactly one selected node.

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/handStagePresentation.test.cjs`

Expected: failure because `public/handStagePresentation.js` does not exist.

- [ ] **Step 3: Implement the model**

Expose:

```js
function buildProgress(activeStreet, completedStreets = []) {
  return ["preflop", "flop", "turn", "river", "results"].map((street) => ({
    street,
    status: street === activeStreet ? "current" : completedStreets.includes(street) ? "complete" : "pending",
  }));
}

function buildTimeline(actions = [], selectedKey = null) {
  let previousStreet = null;
  return actions.flatMap((action, index) => {
    const entries = [];
    if (action.street !== previousStreet) entries.push({ type: "street", street: action.street });
    entries.push({ type: "action", index: index + 1, ...action, selected: action.key === selectedKey });
    previousStreet = action.street;
    return entries;
  });
}
```

Load it before the three view scripts in `public/index.html`.

- [ ] **Step 4: Run the focused test and syntax check**

Run: `node tests/handStagePresentation.test.cjs && node --check public/handStagePresentation.js`

Expected: PASS.

- [ ] **Step 5: Commit the isolated model**

```bash
git add public/handStagePresentation.js public/index.html tests/handStagePresentation.test.cjs
git commit -m "feat: add shared hand stage presentation model"
```

### Task 2: Recompose the Static Dashboard Shell

**Files:**
- Modify: `public/index.html`
- Modify: `tests/poketeriorShell.test.cjs`

**Interfaces:**
- Consumes: all existing IDs used by `public/app.js`; no required ID may be removed.
- Produces: semantic `topbar`, `mode-tabs`, `hand-stage`, and `analysis-dashboard` landmarks for view renderers and CSS.

- [ ] **Step 1: Extend the shell test with structural behavior**

Parse the HTML text and assert one `.hand-stage` landmark with `.hand-progress-region`, `.hand-table-region`, and `.hand-decision-region`; assert the analysis cards live in a sibling `.analysis-dashboard`; assert all existing IDs referenced by `$()` in `public/app.js` remain present.

- [ ] **Step 2: Run the shell test and verify RED**

Run: `node tests/poketeriorShell.test.cjs`

Expected: failure for the missing shared hand-stage landmarks.

- [ ] **Step 3: Rebuild the page composition**

Reorder existing controls into the approved header and mode selector. Add shared region wrappers without duplicating IDs. Keep legacy form controls hidden for compatibility. Place the shared analysis tabs and results dashboard immediately after the active hand workspace.

Header order:

```html
<header class="topbar panel">
  <a class="brand-lockup" aria-label="PokeTerior home">…</a>
  <nav class="product-nav" aria-label="Primary">…</nav>
  <div class="account-actions">…<button id="resetHandBtn">New Hand</button></div>
</header>
```

- [ ] **Step 4: Run structural and wiring tests**

Run: `node tests/poketeriorShell.test.cjs && node tests/preflopBuilderWiring.test.cjs && node tests/postflopBuilderWiring.test.cjs && node tests/importBuilderWiring.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit the shell composition**

```bash
git add public/index.html tests/poketeriorShell.test.cjs
git commit -m "feat: recompose PokeTerior dashboard shell"
```

### Task 3: Unify Manual Hand Progress, Table, Decision, and Timeline Views

**Files:**
- Modify: `public/preflopBuilderView.js`
- Modify: `public/postflopBuilderView.js`
- Modify: `tests/preflopBuilderWiring.test.cjs`
- Modify: `tests/postflopBuilderWiring.test.cjs`

**Interfaces:**
- Consumes: `PokeTeriorHandStagePresentation`, existing preflop/postflop state, and existing view callbacks.
- Produces: `.hand-progress-list`, `.hand-timeline-track`, compact `.decision-actions`, and populated `.decision-context` markup while retaining existing action data attributes.

- [ ] **Step 1: Add failing manual-view assertions**

Assert rendered postflop markup contains five progress items with status text, a single horizontal timeline track, legal action buttons in the decision region, and no legacy standalone street button stack. Assert preflop continues to emit its current actor and action callbacks.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node tests/preflopBuilderWiring.test.cjs && node tests/postflopBuilderWiring.test.cjs`

Expected: failure for missing integrated progress/timeline markup.

- [ ] **Step 3: Update both view renderers**

Use the shared presentation model to render progress and timeline nodes. Keep existing `data-edit-index`, `data-postflop-edit`, `data-street-target`, action, sizing, and callback behavior. Populate the right rail from current actor, pot, legal actions, opponent profile, and existing panel message; do not introduce placeholder height.

- [ ] **Step 4: Run manual builder model and wiring tests**

Run: `node tests/preflopBuilderModel.test.cjs && node tests/preflopBuilderWiring.test.cjs && node tests/postflopBuilderModel.test.cjs && node tests/postflopBuilderFlow.test.cjs && node tests/postflopBuilderWiring.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit manual view integration**

```bash
git add public/preflopBuilderView.js public/postflopBuilderView.js tests/preflopBuilderWiring.test.cjs tests/postflopBuilderWiring.test.cjs
git commit -m "feat: unify manual hand stage views"
```

### Task 4: Make Imported Decisions Explicitly Analyzable

**Files:**
- Modify: `public/handWorkspaceView.js`
- Modify: `public/app.js`
- Modify: `tests/handWorkspaceView.test.cjs`
- Modify: `tests/importBuilderWiring.test.cjs`
- Create: `tests/importDecisionLaunch.test.cjs`

**Interfaces:**
- Consumes: `HandSessionModel.selectDecision`, `prepareImportedDecision(street, index, heroName)`, `applyPreparedImportedDecision(prepared)`, and `analyze(triggerButton, cacheState, importedContext)`.
- Produces: `onSelectDecision(decisionKey)` that only prepares/selects and `onAnalyzeDecision(decisionKey, triggerButton)` that launches or restores analysis.

- [ ] **Step 1: Write failing interaction tests**

Create a minimal workspace fixture with two selectable decisions. Assert clicking a timeline node calls selection but not analysis. Assert clicking the shared `[data-analyze-imported]` CTA calls analysis once with the currently selected key. Assert changing selection updates the CTA target.

- [ ] **Step 2: Run import tests and verify RED**

Run: `node tests/handWorkspaceView.test.cjs && node tests/importDecisionLaunch.test.cjs`

Expected: failure because selection currently invokes `loadImportedDecision()` and there is no explicit imported CTA callback.

- [ ] **Step 3: Separate preparation from execution**

Refactor the imported selection callback to validate and prepare the selected node, update `importSession`, apply the prepared state, render the selected node, and restore a cached snapshot when available. Do not call `analyze()` for an uncached node.

Add one decision-rail button:

```html
<button class="primary-btn analyze-street-btn" type="button"
        data-analyze-imported="flop:3">Analyze Street →</button>
```

The analyze callback resolves the selected key, calls the existing imported preparation helpers, then calls the central `analyze()` exactly once. Loading, validation, cache, and error status remain visible through `#importStatus`.

- [ ] **Step 4: Run all import decision regressions**

Run: `node tests/importDecisionLaunch.test.cjs && node tests/handWorkspaceView.test.cjs && node tests/importBuilderAdapter.test.cjs && node tests/importDecisionSnapshot.test.cjs && node tests/importBuilderWiring.test.cjs && node tests/importBuilderEditing.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit explicit imported analysis launch**

```bash
git add public/handWorkspaceView.js public/app.js tests/handWorkspaceView.test.cjs tests/importBuilderWiring.test.cjs tests/importDecisionLaunch.test.cjs
git commit -m "feat: analyze imported decisions explicitly"
```

### Task 5: Replace the Conflicting Layout CSS with the Approved Design System

**Files:**
- Modify: `public/styles.css`
- Create: `tests/poketeriorLayoutContract.test.cjs`

**Interfaces:**
- Consumes: semantic classes delivered by Tasks 2–4.
- Produces: one token-driven responsive layout with no legacy gold state rules or trailing override stack.

- [ ] **Step 1: Write a failing rendered-layout contract test**

Use a lightweight local browser test script or DOM/CSS inspection helper to assert at a 1600×900 viewport:

- hand-stage columns are approximately 170px / flexible / 360px;
- table region height is 330–390px including timeline;
- timeline height is 90–120px;
- analysis top is below the stage but under 900px;
- no element extends beyond the viewport width;
- no computed active border/background uses the legacy gold values.

At 1000px, assert one-column stage flow, horizontal progress, and stacked analytics cards.

- [ ] **Step 2: Run the layout contract and verify RED**

Run: `node tests/poketeriorLayoutContract.test.cjs`

Expected: failure on current 500–540px tables and two-column layout.

- [ ] **Step 3: Replace the legacy composition rules**

Rewrite the structural CSS sections around the semantic tokens. Remove duplicate late-file PokeTerior overrides and all gold declarations from active states. Implement:

```css
.hand-stage {
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr) 360px;
  gap: var(--space-sm);
}
.poker-table,
.postflop-table,
.import-builder-table { height: 270px; min-height: 0; }
.hand-timeline { height: 104px; }
.analysis-dashboard {
  display: grid;
  grid-template-columns: 1.05fr .95fr 1.15fr;
}
```

Use subtle 150–250ms opacity/color transitions and honor `prefers-reduced-motion`.

- [ ] **Step 4: Run layout and shell tests**

Run: `node tests/poketeriorLayoutContract.test.cjs && node tests/poketeriorShell.test.cjs && node tests/poketeriorDiagnostics.test.cjs && git diff --check`

Expected: PASS.

- [ ] **Step 5: Commit the design system and layout**

```bash
git add public/styles.css tests/poketeriorLayoutContract.test.cjs
git commit -m "feat: match approved PokeTerior dashboard layout"
```

### Task 6: End-to-End Functional and Visual Verification

**Files:**
- Modify only if a verified defect requires a focused correction.

**Interfaces:**
- Consumes: completed application and local server.
- Produces: verified desktop/responsive UI and evidence that both manual and imported analysis flows work.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm run check && node tests/handStagePresentation.test.cjs && node tests/importDecisionLaunch.test.cjs && node tests/poketeriorLayoutContract.test.cjs && git diff --check`

Expected: all commands exit 0 with no failures.

- [ ] **Step 2: Start or restart the local server**

Run: `npm run dev`

Verify `/api/health` returns HTTP 200 before opening the page.

- [ ] **Step 3: Inspect desktop at 1600×900**

Verify the header, selector, complete table, progress rail, populated decision panel, timeline, tabs, and upper analytics cards are visible without scrolling. Confirm no blank decision area, clipping, overlap, floating controls, gold states, or oversized table.

- [ ] **Step 4: Exercise manual analysis**

Build a legal preflop-to-flop hand, select cards/actions, and launch Analyze Street. Confirm the active node, recommendation, range matrix, metrics, and disclosures update.

- [ ] **Step 5: Exercise screenshot import and every extracted decision**

Import a known local poker screenshot. Select at least two distinct decision nodes and confirm selection changes the reconstructed state without launching analysis. Click Analyze Street for each and confirm the correct historical node is analyzed or restored from cache.

- [ ] **Step 6: Inspect the responsive layout**

At 1000px, confirm horizontal street progress, decision below the table, stacked analysis cards, 44px controls, and no page-level horizontal overflow.

- [ ] **Step 7: Run the final verification gate**

Re-run the full command from Step 1 after any visual correction. Do not report completion from a stale run.
