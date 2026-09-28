# CoinPoker Hero Card Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CoinPoker screenshot import attribute the bottom-center player's actual cards without anchoring to the broad vision result or fabricating collision repairs.

**Architecture:** Keep the broad screenshot pass for hand structure, then run an independent focused pass against a bottom-seat crop with no predicted cards in its prompt. A server-side acceptance policy validates seat identity, player identity, confidence, and cards before replacing the provisional hand. The browser stores card ownership explicitly and clears cards when the selected hero changes to a different player.

**Tech Stack:** Node.js ES modules, Gemini/OpenRouter vision pipeline, `sharp` for in-memory image crops, browser JavaScript, Node `assert` regression tests.

## Global Constraints

- Screenshot ambiguity and card collisions remain nonblocking import warnings; they must not cause HTTP 500.
- No rank or suit may be changed without an explicit vision result or user edit.
- Raw broad and focused vision outputs must remain available in vision debug records.
- CoinPoker defaults to the verified bottom-center player.
- Strategic analysis remains disabled while selected cards are incomplete, invalid, duplicated, or collide with the board.
- Do not refactor unrelated strategic-analysis or range code.

---

## File Structure

- `src/analysis/importRepair.js`: focused-result validation and application policy.
- `src/analysis/heroCardCrop.js`: pure crop-region calculation plus in-memory image cropping.
- `src/analysis/pipeline.js`: independent focused prompt, crop fallback, result application, and debug metadata.
- `src/analysis/visionDebug.js`: persistence shape for focused decision metadata.
- `public/importHeroCardModel.js`: browser-testable ownership and hero-switch behavior.
- `public/app.js`: remove fabricated suit repair and wire ownership-aware card selection.
- `public/index.html`: load the new browser model before `app.js`.
- `package.json` / lockfile: add `sharp`, syntax check, and new test commands.
- `tests/importRepair.test.mjs`: server acceptance-policy regressions.
- `tests/heroCardCrop.test.mjs`: crop-region and fallback regressions.
- `tests/visionDebugLogging.test.mjs`: focused-decision debug persistence.
- `tests/importHeroCardModel.test.cjs`: ownership and hero-switch regressions.
- `tests/coinPokerHeroAttribution.test.mjs`: exact reported end-to-end data regression.

---

### Task 1: Replace rank locking with explicit focused-verification policy

**Files:**
- Modify: `src/analysis/importRepair.js`
- Modify: `tests/importRepair.test.mjs`

**Interfaces:**
- Consumes: broad hand `{ heroName, heroHand, players, confidenceNotes }` and focused result `{ seat, playerName, heroHand, confidence, evidence }`.
- Produces: `applyFocusedHeroHandVerification(hand, focused) -> hand` with `heroName`, `heroHand`, `heroHandOwner`, player `isHero` flags, notes, and `focusedHeroDecision`.
- Produces: `normalizePlayerIdentity(name) -> string` for case/whitespace-safe comparison.

- [ ] **Step 1: Replace the old rank-mismatch expectation with failing policy tests**

Add assertions equivalent to:

```js
const corrected = applyFocusedHeroHandVerification(
  {
    site: "CoinPoker",
    heroName: "MauroG27129",
    heroHand: ["Js", "Ks"],
    players: [
      { name: "MauroG27129", position: "SB", isHero: true },
      { name: "dingsanpro", position: "BB", isHero: false },
    ],
    confidenceNotes: [],
  },
  {
    seat: "bottom-center",
    playerName: " dingsanpro ",
    heroHand: ["2d", "Kh"],
    confidence: "high",
    evidence: "red diamond 2 and red heart K at bottom-center",
  },
);
assert.equal(corrected.heroName, "dingsanpro");
assert.equal(corrected.heroHandOwner, "dingsanpro");
assert.deepEqual(corrected.heroHand, ["2d", "Kh"]);
assert.equal(corrected.players.find((p) => p.name === "dingsanpro").isHero, true);
assert.equal(corrected.focusedHeroDecision.accepted, true);

for (const focused of [
  { seat: "right", playerName: "dingsanpro", heroHand: ["2d", "Kh"], confidence: "high" },
  { seat: "bottom-center", playerName: "different", heroHand: ["2d", "Kh"], confidence: "high" },
  { seat: "bottom-center", playerName: "dingsanpro", heroHand: ["2d", "Kh"], confidence: "low" },
  { seat: "bottom-center", playerName: "dingsanpro", heroHand: ["2d", "2d"], confidence: "high" },
]) {
  const result = applyFocusedHeroHandVerification(baseHand, focused);
  assert.deepEqual(result.heroHand, baseHand.heroHand);
  assert.equal(result.focusedHeroDecision.accepted, false);
}
```

- [ ] **Step 2: Run the focused repair test and verify the new acceptance case fails**

Run: `node tests/importRepair.test.mjs`

Expected: FAIL because the current function rejects rank changes and does not expose ownership or decision metadata.

- [ ] **Step 3: Implement the minimal acceptance policy**

Implement these rules in `applyFocusedHeroHandVerification`:

```js
const accepted =
  normalizedSeat === "bottom-center" &&
  focusedCards.length === 2 &&
  new Set(focusedCards).size === 2 &&
  focused.confidence === "high" &&
  Boolean(matchedPlayer);
```

On acceptance, set `heroName`, `heroHandOwner`, `heroHand`, and exactly one matching player's `isHero`. On rejection, preserve cards and identity, append a concise warning note, and attach `{ accepted: false, reason, ... }` as `focusedHeroDecision`. Remove the same-rank gate entirely.

- [ ] **Step 4: Run the repair regressions**

Run: `node tests/importRepair.test.mjs`

Expected: PASS, including `Js Ks -> 2d Kh` and every rejection case.

- [ ] **Step 5: Commit the policy change**

```bash
git add src/analysis/importRepair.js tests/importRepair.test.mjs
git commit -m "fix: allow verified hero rank corrections"
```

---

### Task 2: Isolate the bottom-center seat for independent vision

**Files:**
- Create: `src/analysis/heroCardCrop.js`
- Create: `tests/heroCardCrop.test.mjs`
- Modify: `src/analysis/pipeline.js`
- Modify: `package.json`
- Modify: package lockfile if generated by the package manager

**Interfaces:**
- Produces: `bottomSeatCropRegion({ width, height }) -> { left, top, width, height }`.
- Produces: `cropBottomSeatImage({ imageBase64, mimeType }) -> Promise<{ imageBase64, mimeType, region }>`.
- Consumes: the crop result in `focusedHeroHandVerification`.

- [ ] **Step 1: Add failing crop-region tests for tall history screenshots and table-only screenshots**

```js
assert.deepEqual(bottomSeatCropRegion({ width: 1210, height: 2048 }), {
  left: 242,
  top: 410,
  width: 726,
  height: 512,
});
assert.deepEqual(bottomSeatCropRegion({ width: 1600, height: 900 }), {
  left: 320,
  top: 405,
  width: 960,
  height: 450,
});
```

The tall-image region covers the bottom-center seat in the upper table panel; the wide-image region covers the lower-center table seat.

- [ ] **Step 2: Run the crop test and verify it fails**

Run: `node tests/heroCardCrop.test.mjs`

Expected: FAIL because `heroCardCrop.js` does not exist.

- [ ] **Step 3: Add `sharp` and implement in-memory crop helpers**

Run: `npm install sharp`

Use `sharp(Buffer.from(imageBase64, "base64")).metadata()` and `.extract(region).toBuffer()`. Preserve JPEG for `image/jpeg`; use PNG otherwise. Reject missing dimensions so the caller can use its full-image fallback. Do not write uploaded images to disk.

- [ ] **Step 4: Make the focused prompt independent and crop-first**

Change `buildFocusedHeroHandPrompt` so it does not contain `hand.heroHand` or any broad-pass card prediction. Require JSON with:

```json
{
  "seat": "bottom-center",
  "playerName": "visible player name",
  "heroHand": ["rank+suit", "rank+suit"],
  "confidence": "high|medium|low",
  "evidence": "visible rank, color, and pip evidence for both cards"
}
```

Pass the crop to the focused model. If cropping throws, pass the original image and record `cropFailure`; the focused pass must still run.

- [ ] **Step 5: Run crop and repair tests**

Run: `node tests/heroCardCrop.test.mjs && node tests/importRepair.test.mjs`

Expected: PASS.

- [ ] **Step 6: Commit focused extraction isolation**

```bash
git add package.json package-lock.json src/analysis/heroCardCrop.js src/analysis/pipeline.js tests/heroCardCrop.test.mjs
git commit -m "fix: isolate CoinPoker bottom-seat card vision"
```

---

### Task 3: Persist focused attribution evidence in vision debug records

**Files:**
- Modify: `src/analysis/pipeline.js`
- Modify: `src/analysis/visionDebug.js`
- Modify: `tests/visionDebugLogging.test.mjs`

**Interfaces:**
- Consumes: `focusedHeroHandCheck` and `hand.focusedHeroDecision`.
- Produces debug fields: `focusedHeroCropRegion`, `focusedHeroCropFailure`, `focusedHeroDecision`, alongside existing raw/parsed focused output.

- [ ] **Step 1: Add failing debug-persistence assertions**

```js
assert.deepEqual(record.focusedHeroCropRegion, { left: 242, top: 410, width: 726, height: 512 });
assert.equal(record.focusedHeroCropFailure, null);
assert.deepEqual(record.focusedHeroDecision, {
  accepted: true,
  reason: "verified-bottom-center-player",
  originalCards: ["Js", "Ks"],
  focusedCards: ["2d", "Kh"],
  playerName: "dingsanpro",
});
```

- [ ] **Step 2: Run the debug test and verify it fails**

Run: `node tests/visionDebugLogging.test.mjs`

Expected: FAIL because these fields are not copied into the record.

- [ ] **Step 3: Attach crop and decision metadata to successful and failed imports**

Populate the three fields in the pipeline's returned `debug` object and `error.visionDebug`. Copy them in `buildVisionImportRecord`. Continue storing full `focusedHeroRawVisionOutput` and `focusedHeroParsedOutput` without truncation.

- [ ] **Step 4: Run debug and import tests**

Run: `node tests/visionDebugLogging.test.mjs && node tests/importRepair.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit debug attribution metadata**

```bash
git add src/analysis/pipeline.js src/analysis/visionDebug.js tests/visionDebugLogging.test.mjs
git commit -m "chore: log focused hero attribution decisions"
```

---

### Task 4: Remove fabricated card repair and bind cards to their owner

**Files:**
- Create: `public/importHeroCardModel.js`
- Create: `tests/importHeroCardModel.test.cjs`
- Modify: `public/app.js`
- Modify: `public/index.html`
- Modify: `package.json`

**Interfaces:**
- Produces browser global `PokerCoachImportHeroCards`.
- Produces `initializeCardOwnership(hand) -> hand`.
- Produces `cardsForSelectedHero(hand, selectedName) -> string[]`.
- Produces `setCardsForSelectedHero(hand, selectedName, cards) -> hand`.
- Consumes these helpers from `public/app.js` during normalization, rendering, editing, and decision loading.

- [ ] **Step 1: Add failing ownership regressions**

Create a UMD-style model test matching existing browser model tests:

```js
const hand = model.initializeCardOwnership({
  heroName: "dingsanpro",
  heroHandOwner: "dingsanpro",
  heroHand: ["2d", "Kh"],
});
assert.deepEqual(model.cardsForSelectedHero(hand, "dingsanpro"), ["2d", "Kh"]);
assert.deepEqual(model.cardsForSelectedHero(hand, "MauroG27129"), []);

model.setCardsForSelectedHero(hand, "MauroG27129", ["Js", "Ks"]);
assert.deepEqual(model.cardsForSelectedHero(hand, "MauroG27129"), ["Js", "Ks"]);
assert.deepEqual(model.cardsForSelectedHero(hand, "dingsanpro"), ["2d", "Kh"]);
```

Also add a source assertion that `public/app.js` contains neither `repairImportedCoinPokerHeroBlackDuplicateDiamonds` nor a collision-driven `${card[0]}d` substitution.

- [ ] **Step 2: Run the browser model test and verify it fails**

Run: `node tests/importHeroCardModel.test.cjs`

Expected: FAIL because the ownership model does not exist and the fabricated repair remains.

- [ ] **Step 3: Implement the ownership model and remove both automatic suit-repair calls**

Represent known cards as `hand.holeCardsByPlayer[normalizedPlayerName] = cards`. Initialize it from `heroHandOwner || heroName` and `heroHand`. Keep `heroHand` synchronized to the currently selected player's cards only for compatibility with existing validity and analyzer code.

Delete `repairImportedCoinPokerHeroBlackDuplicateDiamonds`, delete `repairImportedCoinPokerHeroRedSuits`, and delete their calls from `normalizeImportedHand`. Validation warnings remain visible.

- [ ] **Step 4: Wire hero selection and manual editing**

When `importHeroSelect` changes, store the previous player's edited cards, switch identity, set `importedHand.heroHand` to the selected player's owned cards or `[]`, and re-render. When `importHeroHandEdit` changes, store the cards for the selected player. `loadImportedDecision` must obtain cards through `cardsForSelectedHero`; unknown cards keep analysis disabled through existing validity checks.

- [ ] **Step 5: Load the model and add it to project checks**

Load `importHeroCardModel.js` before `app.js` in `public/index.html`. Add `node --check public/importHeroCardModel.js` and `node tests/importHeroCardModel.test.cjs` to `npm run check`.

- [ ] **Step 6: Run ownership and card-validity tests**

Run: `node tests/importHeroCardModel.test.cjs && node tests/importCardValidity.test.cjs && node --check public/app.js`

Expected: PASS.

- [ ] **Step 7: Commit ownership-safe browser behavior**

```bash
git add public/importHeroCardModel.js public/app.js public/index.html package.json tests/importHeroCardModel.test.cjs
git commit -m "fix: bind imported hole cards to players"
```

---

### Task 5: Add the exact CoinPoker attribution regression and verify the application

**Files:**
- Create: `tests/coinPokerHeroAttribution.test.mjs`
- Modify: `package.json`
- Modify: `README.md` only if current import-debug documentation omits the focused attribution fields

**Interfaces:**
- Consumes: focused policy and browser ownership interfaces from Tasks 1 and 4.
- Produces: a permanent regression for analysis `pc_20260804190607_ebb50f2f`.

- [ ] **Step 1: Write the exact cross-module regression**

```js
const broad = {
  site: "CoinPoker",
  heroName: "MauroG27129",
  heroHand: ["Js", "Ks"],
  board: { flop: ["Jc", "5c", "9c"], turn: "Qh", river: "2s" },
  players: [
    { name: "MauroG27129", position: "SB", isHero: true },
    { name: "dingsanpro", position: "BB", isHero: false },
  ],
  confidenceNotes: [],
};
const focused = {
  seat: "bottom-center",
  playerName: "dingsanpro",
  heroHand: ["2d", "Kh"],
  confidence: "high",
  evidence: "bottom-left red diamond 2; bottom-right red heart K",
};
const repaired = applyFocusedHeroHandVerification(broad, focused);
assert.equal(repaired.heroName, "dingsanpro");
assert.deepEqual(repaired.heroHand, ["2d", "Kh"]);
assert.equal(repaired.heroHand.includes("Jd"), false);
assert.equal(repaired.heroHand.includes("Kd"), false);
```

Include ownership assertions proving a later selection of Mauro returns no cards unless Mauro's cards are explicitly stored.

- [ ] **Step 2: Run the exact regression**

Run: `node tests/coinPokerHeroAttribution.test.mjs`

Expected: PASS after Tasks 1–4; any `Jd Kd` output fails explicitly.

- [ ] **Step 3: Add the regression to `npm run check` and run the full suite**

Run: `npm run check`

Expected: exit code 0 and every existing plus new regression prints its pass message.

- [ ] **Step 4: Launch or restart the local app and verify health**

Start the configured development command in the existing detached process convention, then run:

```bash
curl --fail --silent http://localhost:4175/ >/dev/null
```

Expected: exit code 0. Confirm the serving process remains alive after the health check.

- [ ] **Step 5: Perform a browser smoke test with the reported screenshot**

Upload `/var/folders/ww/xjp27f3159ngx3rx06sv4gx80000gn/T/codex-clipboard-056923e8-540a-4469-b2c3-68e21a8ca614.png` or the original equivalent. Verify:

- Import succeeds.
- Default hero is `dingsanpro`.
- Hero hand is `2d Kh`.
- Board is `Jc 5c 9c Qh 2s`, subject only to actual vision accuracy and editable warnings.
- Selecting Mauro does not retain `2d Kh`.
- The vision-import debug record contains both raw outputs and the focused decision.

- [ ] **Step 6: Commit the integration regression and documentation**

```bash
git add package.json tests/coinPokerHeroAttribution.test.mjs README.md
git commit -m "test: cover CoinPoker hero card attribution regression"
```

---

## Final Verification

- [ ] Run `git diff --check` and confirm no whitespace errors.
- [ ] Run `npm run check` from `/Users/kevinling0218/Documents/PokerCoach` and confirm exit code 0.
- [ ] Confirm `curl --fail --silent http://localhost:4175/ >/dev/null` exits 0.
- [ ] Inspect the newest `logs/vision-imports` record and confirm it contains broad raw output, focused raw output, crop metadata, acceptance decision, final hand, and warnings.
- [ ] Confirm no source occurrence of `repairImportedCoinPokerHeroBlackDuplicateDiamonds` or `repairImportedCoinPokerHeroRedSuits` remains.
- [ ] Confirm unrelated pre-existing dirty files were not staged or reverted.
