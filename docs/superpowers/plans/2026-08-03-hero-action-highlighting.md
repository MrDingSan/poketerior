# Hero Action Highlighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Highlight every hero-authored action consistently in manual action editors and imported decision cells.

**Architecture:** Add a small pure classification helper for manual rows, call it whenever action or hero-position state changes, and reuse one semantic CSS class for the emerald row treatment. Imported decision kinds will map both hero cases to that same semantic class while retaining their existing labels and buttons.

**Tech Stack:** Browser JavaScript, HTML/CSS, Node.js assertion tests

## Global Constraints

- Hero rows use emerald/felt-green styling plus a visible `HERO` badge; gold remains reserved for primary actions.
- Villain rows retain their existing neutral styling.
- Classification updates without reload after row creation, actor changes, and hero-position changes.
- Poker analysis and import behavior must remain unchanged.
- The validated result is redeployed locally at `http://localhost:4175`.

---

### Task 1: Hero row classification

**Files:**
- Create: `public/actionRowPresentation.js`
- Create: `tests/actionRowPresentation.test.cjs`
- Modify: `public/index.html`
- Modify: `public/app.js:120-190`
- Modify: `package.json`

**Interfaces:**
- Produces: `globalThis.PokerCoachActionRowPresentation.isHeroActor(actor, heroPosition): boolean`
- Consumes: actor and hero-position strings from the existing selects.

- [ ] **Step 1: Write the failing test**

```js
assert.equal(presentation.isHeroActor("SB", "SB"), true);
assert.equal(presentation.isHeroActor("UTG", "SB"), false);
assert.equal(presentation.isHeroActor("", "SB"), false);
```

- [ ] **Step 2: Run the focused test and verify it fails because the presentation module does not exist**

Run: `node tests/actionRowPresentation.test.cjs`

- [ ] **Step 3: Implement the pure helper and row refresh integration**

```js
function isHeroActor(actor, heroPosition) {
  return Boolean(actor && heroPosition && actor === heroPosition);
}
```

Add `refreshHeroActionRows()` to toggle `is-hero-action` and `data-action-owner="hero"` on every `.action-row`. Invoke it from `refreshActionRows`, action-container change handling, and the hero-position change handling.

- [ ] **Step 4: Run the focused test and full check**

Run: `node tests/actionRowPresentation.test.cjs && npm run check`

### Task 2: Shared visual treatment

**Files:**
- Modify: `public/app.js:2940-3070`
- Modify: `public/styles.css:330-460`
- Test: `tests/actionRowPresentation.test.cjs`

**Interfaces:**
- Consumes: `.is-hero-action` on manual rows and `.hero-action-cell` on imported decision cells.
- Produces: a shared emerald surface, border, inset accent, and `HERO` badge for manual rows.

- [ ] **Step 1: Extend the failing regression test**

Assert that first-hero and review-hero imported decision kinds both expose `hero-action-cell`, while villain decisions do not.

- [ ] **Step 2: Run the focused test and verify the review-hero case fails**

Run: `node tests/actionRowPresentation.test.cjs`

- [ ] **Step 3: Apply semantic classes and CSS**

Map both imported hero kinds to `hero-action-cell` alongside their existing state class. Style `.action-row.is-hero-action` and `.decision-item.hero-action-cell` with an emerald translucent background, green border, and inset left accent. Render the manual `HERO` badge with `.action-row.is-hero-action::after`.

- [ ] **Step 4: Run the focused test and full project check**

Run: `node tests/actionRowPresentation.test.cjs && npm run check`

### Task 3: Rendered verification and local deployment

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: the complete local application.
- Produces: a verified local deployment on port `4175`.

- [ ] **Step 1: Verify rendered behavior**

Open the local app, confirm hero and villain rows differ across preflop and postflop, switch an actor to and from the hero position, and confirm the class updates immediately. Confirm imported first/review hero cells share the treatment while villain cells remain neutral.

- [ ] **Step 2: Run final automated verification**

Run: `npm run check`

- [ ] **Step 3: Restart and probe the local server**

Stop only the process listening on `127.0.0.1:4175`, run `npm run dev`, then run `curl --fail http://127.0.0.1:4175/` and confirm HTTP 200.
