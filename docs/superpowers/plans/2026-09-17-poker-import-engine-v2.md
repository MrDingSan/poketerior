# Poker Import Engine V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a feature-gated, client-first Natural8 screenshot importer that uses deterministic cropping, card recognition, OCR parsing, and poker validation before targeted AI recovery, while preserving the existing replay, decisions, and full-image fallback.

**Architecture:** Browser-side modules produce a runtime-validated `ParsedPokerHand` through a site-adapter contract. Independent card and street jobs report progressive results, deterministic validation reuses strict modes of the existing poker engines, and only unresolved crops reach a new narrow server endpoint. A compatibility projection then feeds accepted hands into the current import adapter and decision flow.

**Tech Stack:** Vanilla browser JavaScript/IIFE modules, Node.js ES modules, Canvas/OffscreenCanvas, Tesseract.js 7.0.0, @tesseract.js-data/eng 1.0.0, Sharp (existing), node:test-style assertion scripts, Gemini/OpenRouter clients (existing).

**Spec:** `docs/superpowers/specs/2026-09-17-poker-import-engine-v2-design.md`

## Global Constraints

- Keep `POST /api/import/screenshot` and the current whole-image pipeline operational as the compatibility fallback.
- Default `IMPORT_ENGINE_V2_ENABLED` to `false`; initially configure only `Natural8` as a V2 site.
- Do not add OpenCV, a frontend framework, a bundler, or a general schema library.
- Do not persist original screenshots, crops, or base64 data in V2 debug records.
- Run Hero cards, board cards, and the four street recognition jobs independently; use a fixed two-worker OCR pool.
- Use high confidence at `>= 0.90`, medium confidence at `0.65–0.899`, and low confidence below `0.65`.
- Use pot tolerance `max(0.2 BB, displayedPot * 0.02)`.
- Preserve existing range, solver, coaching, editing, session isolation, and state-before-action behavior.
- Preserve all pre-existing uncommitted work and stage only files owned by the active task.

---

## File Structure

New browser modules attach focused APIs to `globalThis`, matching the repository's current public-module pattern:

- `public/import-engine/types.js`: canonical hand normalization, field references, legacy projection.
- `public/import-engine/legacyAdapter.js`: legacy vision result to/from canonical conversion.
- `public/import-engine/adapters/registry.js`: adapter registration and best-score selection.
- `public/import-engine/adapters/natural8.js`: Natural8 layout profiles, detection evidence, normalized regions.
- `public/import-engine/vision/regions.js`: normalized rectangle conversion and Canvas crop/preprocessing helpers.
- `public/import-engine/cards/templateRecognizer.js`: rank/suit template scoring and card candidates.
- `public/import-engine/ocr/workerPool.js`: reusable two-worker scheduler with dependency injection for tests.
- `public/import-engine/ocr/recognizer.js`: street OCR and preprocessing variants.
- `public/import-engine/parsing/actions.js`: OCR normalization and canonical action parsing.
- `public/import-engine/validation/validator.js`: structural, card, action, pot, and confidence validation.
- `public/import-engine/engine.js`: parallel orchestration, retry, fallback, and progress events.
- `public/import-engine/fallback/client.js`: typed calls to `/api/import/v2/resolve`.
- `src/import-engine/targetedFallback.js`: purpose-specific prompts and provider failover.
- `src/import-engine/debugRecord.js`: pixel-free V2 debug records.
- `scripts/copy_tesseract_assets.mjs`: copies pinned browser/WASM/language assets into ignored public vendor output.

Existing integration files changed narrowly:

- `public/importProgressModel.js`, `public/app.js`, `public/index.html`, and `public/styles.css` for stage progress and V2 dispatch.
- `public/importBuilderAdapter.js`, `public/preflopBuilderModel.js`, and `public/postflopBuilderModel.js` for strict replay and canonical projection metadata.
- `src/config/env.js`, `src/server/server.js`, `.env.example`, `package.json`, and `.gitignore` for feature flags, endpoint routing, and locally served OCR assets.

---

### Task 1: Canonical Hand Contract and Legacy Compatibility

**Files:**
- Create: `public/import-engine/types.js`
- Create: `public/import-engine/legacyAdapter.js`
- Create: `tests/importEngineTypes.test.cjs`
- Modify: `public/index.html:432-458`
- Modify: `package.json:5-25`

**Interfaces:**
- Produces: `PokerCoachImportTypes.normalizeParsedHand(input)`, `fieldRef(parts)`, and constants `STREETS`, `ACTIONS`, `AMOUNT_KINDS`.
- Produces: `PokerCoachLegacyImportAdapter.fromLegacy(hand, metadata)` and `toLegacy(parsed)`.
- Consumes: no V2 modules.

- [ ] **Step 1: Write the failing canonical-contract test**

Create a VM-loaded test that verifies normalization, deep-copy behavior, field confidence, and stable action IDs:

~~~js
const parsed = types.normalizeParsedHand({
  source: { kind: "screenshot", site: "Natural8", adapterId: "natural8", adapterVersion: "1" },
  hero: { playerId: "hero", name: "Hero", position: "BB", cards: ["Ah", "4d"] },
  players: [{ id: "hero", name: "Hero", position: "BB", isHero: true }],
  board: { flop: ["6h", "7s", "8c"], turn: null, river: null },
  actions: { preflop: [{ actorId: "hero", type: "call", amountBb: 2, amountKind: "increment" }] },
});
assert.equal(parsed.actions.preflop[0].id, "preflop:0");
assert.deepEqual(parsed.actions.flop, []);
assert.equal(parsed.confidence.level, "low");
assert.notEqual(parsed.players, input.players);
~~~

Add a round-trip assertion showing that a current legacy hand becomes canonical and projects back to the exact fields consumed by `importBuilderAdapter`.

- [ ] **Step 2: Run the test and verify the missing API failure**

Run: `node tests/importEngineTypes.test.cjs`

Expected: FAIL because `public/import-engine/types.js` does not exist or `PokerCoachImportTypes` is undefined.

- [ ] **Step 3: Implement the canonical normalizer and legacy adapter**

Attach an immutable API using the existing IIFE pattern. Normalize all four streets, convert card `10h` to `Th`, reject unknown action names, preserve `rawText` and `sourceRegion`, and assign IDs with this rule:

~~~js
function normalizeAction(action, street, index) {
  const type = String(action?.type || action?.action || "").toLowerCase();
  if (!ACTIONS.includes(type)) throw new Error(`Unsupported import action ${type || "empty"}.`);
  return {
    id: action.id || `${street}:${index}`,
    actorId: action.actorId || null,
    actorName: action.actorName || action.actor || null,
    position: normalizePosition(action.position),
    type,
    amountBb: finiteOrNull(action.amountBb),
    amountKind: AMOUNT_KINDS.includes(action.amountKind) ? action.amountKind : "unknown",
    rawText: String(action.rawText || ""),
    sourceRegion: action.sourceRegion || null,
  };
}
~~~

`toLegacy(parsed)` must return `heroName`, `heroHand`, `players`, `board`, and `streets[street].actions` with legacy `actor`, `action`, and `amountBb` names plus `validationWarnings`.

- [ ] **Step 4: Load the modules before existing import modules and run tests**

Add script tags before `importProgressModel.js`. Add the new test to the `check` command.

Run: `node tests/importEngineTypes.test.cjs && npm run test:unified-builder`

Expected: both commands PASS.

- [ ] **Step 5: Commit the canonical contract**

~~~bash
git add public/import-engine/types.js public/import-engine/legacyAdapter.js public/index.html tests/importEngineTypes.test.cjs package.json
git commit -m "feat: add canonical poker import hand contract"
~~~

---

### Task 2: Adapter Registry, Natural8 Layout, and Region Cropping

**Files:**
- Create: `public/import-engine/adapters/registry.js`
- Create: `public/import-engine/adapters/natural8.js`
- Create: `public/import-engine/vision/regions.js`
- Create: `tests/importAdapterRegistry.test.cjs`
- Create: `tests/natural8Adapter.test.cjs`
- Create: `tests/importRegions.test.cjs`
- Modify: `public/index.html`
- Modify: `package.json`

**Interfaces:**
- Consumes: `PokerCoachImportTypes.STREETS`.
- Produces: `PokerCoachImportAdapters.createRegistry(adapters).detect(context)` returning `{supported, adapter, detection, attempts}`.
- Produces: `PokerCoachNatural8Adapter` with `id`, `site`, `version`, `detect(context)`, and `regions(image)`.
- Produces: `PokerCoachImportRegions.pixelRect(normalized, dimensions)`, `crop(source, rect, options)`, and `preprocess(canvas, variant)`.

- [ ] **Step 1: Write failing adapter and region tests**

Test best-score selection and the `0.80` threshold:

~~~js
const registry = adapters.createRegistry([
  { id: "weak", detect: () => ({ score: 0.79, evidence: [] }) },
  { id: "natural8", detect: () => ({ score: 0.91, evidence: ["street-columns"] }) },
]);
const result = registry.detect({ width: 1280, height: 2022, anchors: {} });
assert.equal(result.supported, true);
assert.equal(result.adapter.id, "natural8");
~~~

Test normalized-to-pixel conversion for the existing 1280x2022 fixture and a scaled 640x1011 equivalent. Assert every region remains within image bounds and street columns are non-overlapping in Pre-Flop, Flop, Turn, River order.

- [ ] **Step 2: Run tests and verify missing-module failures**

Run: `node tests/importAdapterRegistry.test.cjs && node tests/natural8Adapter.test.cjs && node tests/importRegions.test.cjs`

Expected: FAIL because the three new APIs do not exist.

- [ ] **Step 3: Implement registry selection and Natural8 layout profile**

Use a deterministic score made from explicit evidence:

~~~js
const weights = { tallAspect: 0.10, historyBoundary: 0.20, fiveColumns: 0.25, streetHeadings: 0.30, tableCards: 0.15 };
const score = Object.entries(weights).reduce(
  (sum, [key, weight]) => sum + (context.anchors?.[key] ? weight : 0),
  0,
);
return { score, evidence: Object.keys(weights).filter((key) => context.anchors?.[key]), profile: "classic-tall-v1" };
~~~

Define normalized profile regions for metadata, Hero cards, board, history panel, blinds, Pre-Flop, Flop, Turn, and River based on the structured tall layout. The adapter identifies a layout family; it reports `site: Natural8` only when street headings and the configured Natural8 profile both match.

- [ ] **Step 4: Implement Canvas region helpers with injected canvas creation**

`crop` accepts `{image, width, height}` and an optional `createCanvas` factory so Node tests can inspect requested draw coordinates without a DOM. `preprocess` supports `original`, `upscale2`, `upscale3`, `grayscaleContrast`, and `threshold`.

- [ ] **Step 5: Load modules and run focused tests**

Run: `node tests/importAdapterRegistry.test.cjs && node tests/natural8Adapter.test.cjs && node tests/importRegions.test.cjs && node tests/screenshotUploadModel.test.cjs`

Expected: PASS.

- [ ] **Step 6: Commit adapter and cropping foundation**

~~~bash
git add public/import-engine/adapters public/import-engine/vision public/index.html tests/importAdapterRegistry.test.cjs tests/natural8Adapter.test.cjs tests/importRegions.test.cjs package.json
git commit -m "feat: add Natural8 adapter and screenshot regions"
~~~

---

### Task 3: Deterministic Action and Amount Parsing

**Files:**
- Create: `public/import-engine/parsing/actions.js`
- Create: `tests/importActionParser.test.cjs`
- Modify: `public/index.html`
- Modify: `package.json`

**Interfaces:**
- Consumes: canonical action vocabulary from `PokerCoachImportTypes`.
- Produces: `PokerCoachImportActionParser.normalizeOcrText(text)`, `parseAmount(text)`, `parseActionRow(row, context)`, and `parseStreet(rows, context)`.
- `parseActionRow` returns `{action, confidence, warnings}` where `action` is canonical.

- [ ] **Step 1: Write parser tests for OCR variations and unsafe ambiguity**

~~~js
assert.deepEqual(parser.parseAmount("Call 2.2BB"), { value: 2.2, confidence: 1 });
assert.deepEqual(parser.parseAmount("RAISE 2,5 BB"), { value: 2.5, confidence: 0.94 });
assert.equal(parser.parseActionRow({ text: "AII IN 19.8 BB", actorName: "Hero" }, {}).action.type, "allin");
assert.equal(parser.parseActionRow({ text: "Check" }, {}).action.amountBb, null);
assert.equal(parser.parseActionRow({ text: "Wins 21.6 BB" }, {}).action, null);
assert.ok(parser.parseActionRow({ text: "Bet O.B BB" }, {}).warnings.length > 0);
~~~

Also test `2.2 BB`, `2,2BB`, `Fold`, `CALL`, `All-in`, `RETURN`, `refund`, `muck`, and an empty actor. Empty actors stay null rather than becoming Hero.

- [ ] **Step 2: Run the test and verify the missing API failure**

Run: `node tests/importActionParser.test.cjs`

Expected: FAIL because `PokerCoachImportActionParser` is undefined.

- [ ] **Step 3: Implement vocabulary-constrained normalization**

Token normalization may convert `AII IN` to `ALL IN` and decimal commas to dots. Digit substitutions are accepted only inside an amount token and only when the result parses as one finite non-negative number. Filter bookkeeping rows before canonical action creation.

Map amount kinds as follows: call text is `increment`; bet text is `street-total`; raise text is `street-total`; explicit all-in is `stack-total`; fold/check are `none`.

- [ ] **Step 4: Run parser and existing consistency tests**

Run: `node tests/importActionParser.test.cjs && node tests/importActionConsistency.test.mjs && node tests/allinImportMapping.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit the deterministic parser**

~~~bash
git add public/import-engine/parsing/actions.js public/index.html tests/importActionParser.test.cjs package.json
git commit -m "feat: parse screenshot action OCR deterministically"
~~~

---

### Task 4: Template-Based Card Recognition

**Files:**
- Create: `public/import-engine/cards/templateRecognizer.js`
- Create: `public/import-engine/cards/templates/natural8/classic-tall-v1.json`
- Create: `tests/importCardRecognizer.test.cjs`
- Create: `tests/fixtures/import-engine/card-glyphs.json`
- Modify: `public/index.html`
- Modify: `package.json`

**Interfaces:**
- Consumes: pixel samples shaped `{width, height, data}` and adapter template set.
- Produces: `PokerCoachCardRecognizer.createTemplateRecognizer(templateSet)` with `recognizeCard(sample)` and `recognizeCards(samples)`.
- Recognition result: `{card, confidence, candidates, evidence}`.

- [ ] **Step 1: Add failing synthetic glyph tests covering all ranks and suits**

Store small binary/color matrices in `card-glyphs.json`; the fixture is deterministic test data, not a poker screenshot. For every rank and suit, assert the expected card ranks first. Add a close heart/diamond case and verify the top-two margin lowers confidence:

~~~js
const result = recognizer.recognizeCard(fixtures.ambiguousRedAce);
assert.equal(result.candidates[0].card, "Ah");
assert.equal(result.candidates[1].card, "Ad");
assert.ok(result.confidence >= 0.65 && result.confidence < 0.90);
~~~

- [ ] **Step 2: Run the test and verify the missing API failure**

Run: `node tests/importCardRecognizer.test.cjs`

Expected: FAIL because `PokerCoachCardRecognizer` is undefined.

- [ ] **Step 3: Implement normalized SAD template scoring**

Resize rank and suit glyph matrices to their template dimensions, calculate normalized sum-of-absolute-differences, constrain suits by measured red/black pixel family, and combine scores:

~~~js
const score = 0.55 * rank.score + 0.35 * suit.score + 0.10 * color.score;
const margin = Math.max(0, score - second.score);
const confidence = clamp(score * 0.85 + Math.min(0.15, margin));
~~~

Return all 52 card candidates sorted descending. Reject a sample with insufficient foreground pixels as low confidence rather than selecting a plausible card.

- [ ] **Step 4: Add the versioned seed templates and run tests**

The JSON template set contains 13 rank matrices, four suit matrices, expected glyph dimensions, and `adapterVersion: "classic-tall-v1"`. It is feature-disabled production seed data until real Natural8 fixtures validate it.

Run: `node tests/importCardRecognizer.test.cjs && node tests/importCardValidity.test.cjs && node tests/importHeroCardModel.test.cjs`

Expected: PASS.

- [ ] **Step 5: Commit the card-recognition abstraction**

~~~bash
git add public/import-engine/cards public/index.html tests/importCardRecognizer.test.cjs tests/fixtures/import-engine/card-glyphs.json package.json
git commit -m "feat: add deterministic card template recognition"
~~~

---

### Task 5: Local Tesseract Assets, OCR Pool, and Street Recognition

**Files:**
- Create: `scripts/copy_tesseract_assets.mjs`
- Create: `public/import-engine/ocr/workerPool.js`
- Create: `public/import-engine/ocr/recognizer.js`
- Create: `tests/importOcrPool.test.cjs`
- Create: `tests/importStreetRecognizer.test.cjs`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.gitignore`
- Modify: `public/index.html`

**Interfaces:**
- Consumes: adapter row regions and `PokerCoachImportRegions.preprocess`.
- Produces: `PokerCoachImportOcr.createPool({createWorker, size: 2, workerOptions})` with `recognize(image, options)` and `terminate()`.
- Produces: `PokerCoachStreetRecognizer.recognizeStreet({street, crop, rows, pool})` returning `{street, rawText, rows, confidence, attempts}`.

- [ ] **Step 1: Write failing worker-pool concurrency and reuse tests**

Inject fake workers whose `recognize` promises are manually resolved. Submit four jobs, assert exactly two begin before either resolves, resolve one, and assert the third begins on the released worker. Assert `terminate()` calls each worker exactly once.

- [ ] **Step 2: Write failing street-recognition preprocessing tests**

Inject a fake pool and verify the first attempt uses `upscale2`; when confidence is below `0.65`, the retry uses `grayscaleContrast` or `threshold`, preserves both attempt records, and returns the better result.

- [ ] **Step 3: Run tests and verify missing-module failures**

Run: `node tests/importOcrPool.test.cjs && node tests/importStreetRecognizer.test.cjs`

Expected: FAIL because OCR modules are absent.

- [ ] **Step 4: Install pinned OCR packages and add deterministic asset copying**

Run: `npm install --save-exact tesseract.js@7.0.0 @tesseract.js-data/eng@1.0.0`

The copy script recreates `public/vendor/tesseract/` and copies:

- `node_modules/tesseract.js/dist/tesseract.min.js`
- `node_modules/tesseract.js/dist/worker.min.js`
- all `node_modules/tesseract.js-core/tesseract-core*` JavaScript/WASM files
- `node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz`

Add `public/vendor/tesseract/` to `.gitignore`, add `prepare:tesseract`, and run it from `postinstall` and before `dev`. Load `./vendor/tesseract/tesseract.min.js` before the OCR modules.

- [ ] **Step 5: Implement the fixed two-worker pool and recognizer**

Initialize workers once with local `workerPath`, `corePath`, and `langPath`. Use Tesseract parameters `tessedit_char_whitelist` per row type and `preserve_interword_spaces: "1"`. Do not create a new worker for each street.

- [ ] **Step 6: Run focused tests and syntax checks**

Run: `node tests/importOcrPool.test.cjs && node tests/importStreetRecognizer.test.cjs && npm run prepare:tesseract && test -f public/vendor/tesseract/eng.traineddata.gz`

Expected: all tests PASS and the local language asset exists.

- [ ] **Step 7: Commit OCR runtime integration**

~~~bash
git add package.json package-lock.json .gitignore scripts/copy_tesseract_assets.mjs public/import-engine/ocr public/index.html tests/importOcrPool.test.cjs tests/importStreetRecognizer.test.cjs
git commit -m "feat: add local parallel OCR runtime"
~~~

---

### Task 6: Strict Poker Validation and Confidence

**Files:**
- Create: `public/import-engine/validation/validator.js`
- Create: `tests/importEngineValidation.test.cjs`
- Modify: `public/preflopBuilderModel.js`
- Modify: `public/postflopBuilderModel.js`
- Modify: `public/importBuilderAdapter.js`
- Modify: `public/index.html`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ParsedPokerHand`, preflop/postflop model APIs, and canonical-to-legacy projection.
- Produces: `PokerCoachImportValidator.validate(parsed, {strictReplay: true})` returning `{hand, valid, confidence, warnings, blockingIssues, replayIssues, reconciledPots}`.
- Produces: `importBuilderAdapter.fromImportedHand(hand, {heroName, strict})`; strict mode never inserts automatic folds.

- [ ] **Step 1: Write failing validation tests**

Cover duplicate Hero/board cards, river without turn, unknown actor, action after fold, self-response, illegal check facing a bet, undersized call, and pot mismatch. Add the strict replay regression:

~~~js
const converted = adapter.fromImportedHand(missingMiddleActorHand, { heroName: "Hero", strict: true });
assert.equal(converted.unresolved[0].key, "preflop:1");
assert.match(converted.unresolved[0].message, /next to act/i);
assert.equal(converted.preflopState.actions.some((action) => action.automatic), false);
~~~

Test pot tolerance at exactly `0.2 BB`, at `2%`, and just outside the computed tolerance.

- [ ] **Step 2: Run the test and verify failures**

Run: `node tests/importEngineValidation.test.cjs`

Expected: FAIL because strict adapter mode and the validator do not exist.

- [ ] **Step 3: Add strict replay without changing normal builder behavior**

Wrap the preflop automatic-fold loop in `if (!options.strict)`. In strict mode, pass the recognized actor directly to `PREFLOP.applyAction`, capture its existing next-actor error, and stop at that field. Preserve current behavior when `strict` is omitted.

Expose pure replay helpers only where the validator needs them; do not duplicate pot or legality rules.

- [ ] **Step 4: Implement layered validation and confidence aggregation**

Use structured issues shaped `{code, severity, field, message, correctable}`. Overall confidence is the minimum confidence of required fields, then capped at `0.64` for blocking issues and at `0.89` for recoverable replay/pot issues. Assign `high`, `medium`, or `low` from the global thresholds.

- [ ] **Step 5: Run validator and replay regressions**

Run: `node tests/importEngineValidation.test.cjs && node tests/importBuilderAdapter.test.cjs && node tests/importDecisionSnapshot.test.cjs && node tests/importValidation.test.mjs && node tests/importActionConsistency.test.mjs`

Expected: PASS, including unchanged non-strict adapter tests.

- [ ] **Step 6: Commit strict validation**

~~~bash
git add public/import-engine/validation/validator.js public/preflopBuilderModel.js public/postflopBuilderModel.js public/importBuilderAdapter.js public/index.html tests/importEngineValidation.test.cjs package.json
git commit -m "feat: validate imported hands with strict replay"
~~~

---

### Task 7: Stage Progress and V2 Orchestration

**Files:**
- Create: `public/import-engine/engine.js`
- Create: `tests/importEngineOrchestration.test.cjs`
- Modify: `public/importProgressModel.js`
- Modify: `tests/importProgressModel.test.cjs`
- Modify: `public/index.html`
- Modify: `package.json`

**Interfaces:**
- Consumes: registry, regions, card recognizer, street recognizer, action parser, validator, and fallback client through constructor injection.
- Produces: `PokerCoachImportEngineV2.create(dependencies).import(source, options)`.
- Produces: progress API `createStageProgress({onChange})`, `start(stage)`, `complete(stage, detail)`, `warn(stage, detail)`, `fail(stage, detail)`, `snapshot()`.

- [ ] **Step 1: Replace the timer test with failing stage-state tests**

Verify all ten stages begin pending, legal transitions are emitted, snapshots are immutable, and warnings carry field references. Keep compatibility `start()`/`stop()` methods only if existing app wiring still calls them during migration.

- [ ] **Step 2: Write failing orchestration tests with deferred jobs**

Inject six deferred recognizers. Start an import and assert Hero, board, Pre-Flop, Flop, Turn, and River jobs have all been invoked before resolving any. Resolve them out of order and assert progress emits in actual completion order. Make one street medium confidence, assert only that crop is retried, and make one low-confidence amount invoke exactly one targeted fallback.

- [ ] **Step 3: Run tests and verify missing behavior**

Run: `node tests/importProgressModel.test.cjs && node tests/importEngineOrchestration.test.cjs`

Expected: FAIL because stage progress and the V2 engine are absent.

- [ ] **Step 4: Implement the progress state machine**

Use the exact stage order from the spec and reject unknown stages. Every mutation clones the stage record before calling `onChange`.

- [ ] **Step 5: Implement parallel orchestration and scoped recovery**

Use `Promise.allSettled` over the six recognition promises. Build a partial canonical hand after each completion, but run final strict validation only after all initial jobs settle. Retry only fields reported as medium or correctable. Call targeted fallback only for the unresolved field's `sourceRegion` and purpose.

- [ ] **Step 6: Run orchestration tests**

Run: `node tests/importProgressModel.test.cjs && node tests/importEngineOrchestration.test.cjs && node tests/handSessionModel.test.cjs`

Expected: PASS.

- [ ] **Step 7: Commit orchestration and progress**

~~~bash
git add public/import-engine/engine.js public/importProgressModel.js public/index.html tests/importEngineOrchestration.test.cjs tests/importProgressModel.test.cjs package.json
git commit -m "feat: orchestrate progressive screenshot extraction"
~~~

---

### Task 8: Targeted AI Recovery Endpoint and Pixel-Free Debugging

**Files:**
- Create: `public/import-engine/fallback/client.js`
- Create: `src/import-engine/targetedFallback.js`
- Create: `src/import-engine/debugRecord.js`
- Create: `tests/targetedImportFallback.test.mjs`
- Create: `tests/importV2DebugRecord.test.mjs`
- Modify: `src/server/server.js`
- Modify: `src/config/env.js`
- Modify: `.env.example`
- Modify: `public/index.html`
- Modify: `package.json`

**Interfaces:**
- Consumes: existing `callGeminiWithFailover`/`callOpenRouterWithFailover` exports and config import models.
- Produces: `resolveImportField({purpose, cropBase64, mimeType, context, config, signal})`.
- Produces: endpoint `POST /api/import/v2/resolve` and health fields `importEngineV2Enabled`, `importEngineV2Sites`, `importEngineV2Debug`.
- Produces: `buildImportV2DebugRecord(input)` that strips pixel-bearing keys recursively.

- [ ] **Step 1: Write failing purpose-schema and prompt tests**

For every allowed purpose, inject a fake provider and assert the prompt asks only for that field and returns JSON. Assert an unknown purpose fails before any provider call. Assert an action-amount response containing prose or an invalid action vocabulary is rejected.

- [ ] **Step 2: Write failing debug-redaction tests**

~~~js
const record = buildImportV2DebugRecord({
  cropBase64: "secret",
  source: { dataUrl: "data:image/png;base64,secret" },
  attempts: [{ region: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, candidates: ["2.2"] }],
});
assert.doesNotMatch(JSON.stringify(record), /secret|base64/);
assert.deepEqual(record.attempts[0].region, { x: 0.1, y: 0.2, width: 0.3, height: 0.1 });
~~~

- [ ] **Step 3: Run tests and verify missing-module failures**

Run: `node tests/targetedImportFallback.test.mjs && node tests/importV2DebugRecord.test.mjs`

Expected: FAIL because server modules do not exist.

- [ ] **Step 4: Implement fixed prompt/schema dispatch**

Use a map keyed by the six purpose values. Each entry defines system instruction, prompt builder, maximum tokens, and response validator. Reuse existing six-second focused timeout and import model ordering. Never accept a prompt string from the client.

- [ ] **Step 5: Add config, route, request limits, abort signal, and response shape**

Parse booleans explicitly from `true`, `1`, `yes`, or `on`. Parse site lists with the existing comma-list helper. Limit targeted request JSON to 2 MB. Return `{ok, importId, purpose, value, confidence, provider, model}` without raw provider completion.

- [ ] **Step 6: Implement the browser fallback client and debug redaction**

The client accepts an injected `postJson`, enforces allowed purposes, and sends only the encoded crop plus narrow context. The debug record keeps adapter version, region coordinates, candidates, confidence, retries, provider/model, validation issues, and final canonical hand.

- [ ] **Step 7: Run endpoint, legacy, and timeout regressions**

Run: `node tests/targetedImportFallback.test.mjs && node tests/importV2DebugRecord.test.mjs && node tests/screenshotImportJsonValidation.test.mjs && node tests/screenshotImportTimeout.test.mjs && node --check src/server/server.js`

Expected: PASS.

- [ ] **Step 8: Commit targeted fallback**

~~~bash
git add public/import-engine/fallback/client.js src/import-engine src/server/server.js src/config/env.js .env.example public/index.html tests/targetedImportFallback.test.mjs tests/importV2DebugRecord.test.mjs package.json
git commit -m "feat: add targeted screenshot ambiguity fallback"
~~~

---

### Task 9: Browser Integration, Feature Gate, and Field-Level UI

**Files:**
- Create: `tests/importV2Wiring.test.cjs`
- Create: `tests/importV2PartialUi.test.cjs`
- Modify: `public/app.js:2950-3036`
- Modify: `public/index.html:44-60,432-458`
- Modify: `public/styles.css`
- Modify: `public/handWorkspaceView.js`
- Modify: `public/importBuilderAdapter.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: health flags, `PokerCoachImportEngineV2`, canonical projection, stage progress, current hand session and workspace APIs.
- Produces: V2-or-legacy dispatch inside `importScreenshotFile(file)`.
- Produces: accessible progress list and correction links keyed by canonical field reference.

- [ ] **Step 1: Write failing wiring tests**

Read `public/app.js` and assert:

- V2 runs only when health enables it and detected site is configured;
- unsupported detection calls `/api/import/screenshot` unchanged;
- successful V2 projection reaches `IMPORT_BUILDER_ADAPTER.fromImportedHand`;
- a stale `screenshotImportGeneration` cannot replace `importSession`;
- the previous successful imported session remains when a replacement fails.

- [ ] **Step 2: Write failing partial-result UI tests**

Render progress with one complete card stage, one warning action amount, and pending later streets. Assert status text is present in an `aria-live="polite"` region, uncertainty includes the exact field label, and earlier selectable decisions remain enabled while dependent later decisions are disabled.

- [ ] **Step 3: Run tests and verify missing integration**

Run: `node tests/importV2Wiring.test.cjs && node tests/importV2PartialUi.test.cjs`

Expected: FAIL because V2 is not wired into upload handling or the workspace.

- [ ] **Step 4: Add the progressive import markup and styles**

Add one ordered stage list below `importStatus`. Use text plus icons so state is not color-only. Add compact warning controls with `data-import-field-ref` attributes. Keep the source preview behavior and existing import workspace.

- [ ] **Step 5: Route uploads through the gate without deleting legacy code**

Cache health capability data. Decode the local source once. When V2 is enabled, run adapter detection and V2 only for a configured supported site. Otherwise call the current full-image endpoint. Convert accepted canonical output with `toLegacy`, normalize it through the existing app helper, and replace the import session exactly as the current success path does.

- [ ] **Step 6: Connect partial warnings to existing correction controls**

Map `hero.cards`, board fields, and `actions.<street>.<index>.<field>` to the existing card/action editing controls. Mark tentative values until validation completes. Use the adapter's unresolved boundary to disable only dependent decision keys.

- [ ] **Step 7: Run UI, session, and import regressions**

Run: `node tests/importV2Wiring.test.cjs && node tests/importV2PartialUi.test.cjs && node tests/importBuilderWiring.test.cjs && node tests/importBuilderEditing.test.cjs && node tests/handWorkspaceView.test.cjs && node tests/handSessionModel.test.cjs`

Expected: PASS.

- [ ] **Step 8: Commit V2 browser integration**

~~~bash
git add public/app.js public/index.html public/styles.css public/handWorkspaceView.js public/importBuilderAdapter.js tests/importV2Wiring.test.cjs tests/importV2PartialUi.test.cjs package.json
git commit -m "feat: integrate feature-gated import engine v2"
~~~

---

### Task 10: End-to-End Fixtures, Documentation, and Verification

**Files:**
- Create: `tests/fixtures/import-engine/structured-tall-v1.json`
- Create: `tests/importEngineV2EndToEnd.test.cjs`
- Modify: `README.md`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-09-17-poker-import-engine-v2-design.md` only if implementation revealed a factual correction

**Interfaces:**
- Consumes: complete V2 engine with injected image/card/OCR dependencies and the real canonical projection/replay modules.
- Produces: one offline end-to-end acceptance test and documented rollout procedure.

- [ ] **Step 1: Add a labeled structured-layout manifest**

The manifest references `tests/fixtures/coinpoker-river-showdown.png` only as a structured tall-layout geometry fixture, not as proof of Natural8 branding. Record width, height, normalized regions, visible cards, street headings, and expected action strings. Set `siteEvidence: "layout-only"` so brand detection tests cannot accidentally treat it as Natural8 ground truth.

- [ ] **Step 2: Write the failing offline end-to-end test**

Inject deterministic labeled recognition outputs for each crop while using the real registry, parser, validator, projection, import adapter, and decision model. Assert:

~~~js
assert.equal(result.route, "v2");
assert.equal(result.fullImageProviderCalls, 0);
assert.deepEqual(result.hand.board.flop, ["4d", "6h", "7h"]);
assert.equal(result.converted.unresolved.length, 0);
assert.ok(decisions.selectableDecisionKeys(result.converted).length > 0);
assert.equal(result.progress.decisions.status, "complete");
~~~

Add a second case with an unresolved river amount that uses one targeted crop fallback and zero whole-image calls.

- [ ] **Step 3: Run the end-to-end test and fix only integration defects**

Run: `node tests/importEngineV2EndToEnd.test.cjs`

Expected before integration fixes: FAIL at the first mismatched contract. Apply minimal fixes in the owning modules, rerunning their focused tests after each fix.

- [ ] **Step 4: Document configuration and rollout**

Update README with the three environment variables, local Tesseract asset preparation, supported-site behavior, targeted fallback, and rollback instructions. State clearly that V2 remains disabled until a labeled Natural8 corpus validates detection and card templates.

- [ ] **Step 5: Run the complete offline suite**

Run: `npm run check`

Expected: PASS with no live model calls.

- [ ] **Step 6: Run focused V2 verification as one command**

Add `test:import-v2` to package scripts containing every new V2 test, then run:

~~~bash
npm run test:import-v2
npm run precheck
git diff --check
~~~

Expected: all commands PASS.

- [ ] **Step 7: Perform manual browser acceptance with V2 explicitly enabled**

Start the server with `IMPORT_ENGINE_V2_ENABLED=true` and `IMPORT_ENGINE_V2_SITES=Natural8`. Confirm the page loads local OCR assets, the stage list updates without freezing the UI, an unsupported image uses the legacy endpoint, and a field warning opens the relevant correction control. Do not claim Natural8 production accuracy from the layout-only fixture.

- [ ] **Step 8: Commit final verification and documentation**

~~~bash
git add tests/fixtures/import-engine/structured-tall-v1.json tests/importEngineV2EndToEnd.test.cjs README.md package.json docs/superpowers/specs/2026-09-17-poker-import-engine-v2-design.md
git commit -m "test: verify poker import engine v2 pipeline"
~~~

---

## Completion Gate

Before calling implementation complete:

- `npm run test:import-v2`, `npm run precheck`, and `npm run check` pass.
- `git diff --check` reports no whitespace errors.
- The legacy screenshot-import tests remain green.
- The full-image endpoint is still reachable and unchanged for unsupported/disabled V2.
- V2 debug output contains no screenshot or crop base64.
- A supported injected Natural8 path produces an accepted canonical hand and existing decision snapshots without a full-image provider call.
- The feature flag remains disabled by default until genuine labeled Natural8 screenshots validate real-world accuracy.
