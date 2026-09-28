# Poker Import Engine V2 Design

## Goal

Replace the default full-image vision-model import path for supported Natural8 screenshots with a deterministic, client-first pipeline. The common path detects the layout, crops relevant regions, recognizes cards and action text in parallel, parses them into one canonical hand representation, validates the result with poker rules, and then feeds the accepted hand into PokerCoach's existing replay and decision-analysis flow.

AI remains available for narrowly scoped unresolved fields. The existing whole-image Gemini/OpenRouter importer remains the fallback for unsupported layouts and the rollback path while V2 is feature-gated.

## Success Criteria

- A supported, high-confidence Natural8 screenshot imports without a full-image Gemini or OpenRouter request.
- Hero cards, board cards, and the four street histories are independent recognition jobs; card recognition and street OCR begin concurrently.
- Only a problematic crop is uploaded when targeted AI recovery is required.
- The UI reports site detection, card recognition, each street, validation, reconstruction, and decision discovery as separate progress stages.
- An uncertain field remains visible and correctable without discarding unrelated valid fields.
- Existing range analysis, solver, coaching, imported-hand editing, and state-before-action decision behavior remain unchanged after reconstruction.
- The legacy screenshot endpoint remains usable whenever V2 is disabled, the site is unsupported, or layout detection is below the supported threshold.

## Current Architecture

The browser resizes the screenshot and uploads the complete image to `POST /api/import/screenshot`. The server asks Gemini to extract the entire hand and uses OpenRouter as a provider fallback. It may then make a full-image action-repair request and a cropped Hero-card verification request. Card and limited action-consistency checks run before the response returns to the browser.

The browser normalizes the response, converts it through `public/importBuilderAdapter.js`, and replays it with `public/preflopBuilderModel.js` and `public/postflopBuilderModel.js`. `public/importDecisionModel.js` reconstructs state immediately before each selected action. This downstream replay and decision flow is retained.

The current progress model only reports a generic extraction message and elapsed time because the server returns one final response rather than incremental field results.

## Chosen Architecture

V2 is primarily a browser-side subsystem under `public/import-engine/`. Local file decoding, site detection, crop generation, preprocessing, card recognition, OCR, parsing, validation, and recovery orchestration run in the browser. The server is involved only for targeted AI recovery, legacy whole-image fallback, and import debug logging.

This placement provides immediate stage progress, avoids uploading unnecessary pixels, and fits the current vanilla browser application without introducing a build system.

### Proposed Module Boundaries

```text
public/import-engine/
  types.js
  engine.js
  progress.js
  adapters/
    registry.js
    natural8.js
  vision/
    imageSource.js
    cropper.js
    preprocess.js
  cards/
    recognizer.js
    templateRecognizer.js
    templates/natural8/
  ocr/
    workerPool.js
    recognizer.js
  parsing/
    actions.js
    amounts.js
    natural8Rows.js
  validation/
    cards.js
    actions.js
    replay.js
    confidence.js
  fallback/
    client.js

src/import-engine/
  targetedFallback.js
  legacyAdapter.js
  debugRecord.js
```

Files may be consolidated when a module would otherwise contain only a trivial wrapper, but adapter, recognition, parsing, validation, fallback, and orchestration responsibilities remain separate.

## Site Adapter Contract

Each supported site implements the same logical contract:

```js
{
  id,
  site,
  version,
  detect(imageSource),
  regions(imageSource, detection),
  segmentHistory(crops),
  normalizeRecognition(results),
}
```

`detect` returns a score, evidence, and the matched layout profile. `regions` returns normalized rectangles for metadata, Hero cards, board cards, and each street column. `segmentHistory` identifies action rows and their actor/position evidence. `normalizeRecognition` converts site-specific recognition output into the canonical hand representation.

Natural8 is the first adapter. Its coordinates are normalized to image width and height and selected from versioned layout profiles. Detection uses multiple stable signals rather than aspect ratio alone: expected table/history-panel division, street-column boundaries, column headings, and card/table anchors. A detection score below `0.80` is unsupported and routes to the legacy importer. Scores at or above `0.80` may proceed, but field confidence and poker validation remain authoritative.

A future CoinPoker adapter can supply different layout profiles and parsing conventions without changing the parser output, validator, replay integration, or UI.

## Image and Region Processing

The browser decodes the local file once into an `ImageBitmap` when supported, with an HTML image fallback. A shared image source retains the original dimensions and exposes normalized cropping.

Canvas or `OffscreenCanvas` produces only the regions requested by the selected adapter. Preprocessing variants include:

- 2x and 3x enlargement with smoothing disabled for text and glyph regions;
- grayscale and contrast normalization;
- luminance thresholding for light action bubbles;
- color-preserving processing for suits;
- narrow padding around detected action rows.

Original, preprocessed, and retry crops remain in memory for the active import. They are not persisted or logged. Only a crop selected for targeted fallback is encoded and uploaded.

## Parallel Recognition

Once Natural8 is detected, the engine starts these logical jobs without waiting for one another:

- Hero-card recognition;
- board-card recognition;
- Pre-Flop OCR;
- Flop OCR;
- Turn OCR;
- River OCR.

Card jobs use deterministic Canvas processing. OCR jobs are submitted to a reusable two-worker Tesseract.js pool. Each street remains a separate promise and progress stage even when the pool queues two of the four jobs. The worker pool is initialized once and reused across imports.

The orchestrator uses settled-result handling so one failed region does not erase successful fields. Every completed job emits a progress event immediately.

## Card Recognition

The card recognizer has a replaceable interface that accepts a crop plus adapter-provided glyph geometry and returns ranked candidates with evidence:

```js
{
  card: "Ah",
  confidence: 0.96,
  candidates: [
    { card: "Ah", score: 0.96 },
    { card: "Ad", score: 0.71 }
  ],
  evidence: { rankScore, suitScore, colorFamily, region }
}
```

The first implementation uses template matching over a constrained vocabulary:

- rank glyphs are compared with 13 normalized templates;
- suit color first constrains candidates to red or black;
- suit shapes are compared with four normalized templates;
- the final score combines rank match, suit match, color consistency, and the margin over the second candidate.

Natural8 templates are versioned adapter assets built from approved, correctly labeled fixtures. Hero and board cards use the same recognizer. When the layout provides secondary evidence, such as a showdown card summary, the adapter may cross-check it without treating winnings text as a player action.

No OpenCV dependency is introduced in V2's first implementation. The recognizer interface allows template matching to be replaced later by OpenCV or a small classifier.

## OCR and Deterministic Action Parsing

Tesseract.js is the only new runtime dependency. Its browser worker, WASM core, English data, and required assets are served locally rather than loaded from a CDN.

The Natural8 adapter segments a street column into action rows using column geometry, action-bubble boundaries, actor lanes, nearby player labels, and position badges. OCR operates on these smaller regions when segmentation succeeds and on the complete street crop as a fallback.

The parser normalizes:

- action names to `fold`, `check`, `call`, `bet`, `raise`, or `allin`;
- `2.2BB`, `2.2 BB`, decimal commas, and harmless spacing differences;
- capitalization and punctuation differences;
- common context-safe confusions such as `O/0`, `I/1`, and split `ALL IN` tokens;
- position aliases such as `HJ` and `UTG+1` according to existing analyzer conventions.

Corrections are applied only when the corrected token belongs to the allowed poker vocabulary and is unambiguous in context. The parser preserves raw OCR text and never invents an amount or actor merely to make replay succeed.

Actor attribution combines recognized player/position text with row geometry. Geometry is evidence, not permission to assign every unknown row to Hero.

## Canonical `ParsedPokerHand`

Every V2 producer returns one runtime-validated JavaScript structure:

```text
source
  kind, site, adapterId, adapterVersion, importId

game
  variant, tableSize, stakesText, smallBlindBb, bigBlindBb, anteBb

hero
  playerId, name, position, cards

players[]
  id, name, position, startingStackBb, isHero

board
  flop[], turn, river

actions
  preflop[], flop[], turn[], river[]
  action fields:
    id, actorId, actorName, position, type,
    amountBb, amountKind, rawText, sourceRegion

streetPots
  preflop, flop, turn, river

confidence
  overall, level, fields, recognitionAttempts

warnings[]
  code, severity, field, message, correctable

validation
  valid, blockingIssues, replayIssues, reconciledPots
```

`amountKind` distinguishes displayed increments, street totals, stack totals, and unknown semantics. Recognition preserves the displayed value. Parsing and replay conversion derive the amount required by the existing engine only when the site's convention and current poker state make that conversion deterministic.

The legacy vision result is converted through `legacyAdapter.js` into the same structure. Manual and future text imports can adopt the contract later; migrating manual entry is not part of this implementation.

## Poker Validation

Validation is deterministic and layered:

1. Validate the canonical structure, card tokens, action vocabulary, and required field relationships.
2. Reject impossible street structure and identify duplicate or colliding physical cards.
3. Reconcile action actors with known players and positions.
4. Check street order, legal response types, call matching, raises, all-ins, folded players, and player availability.
5. Replay actions through the existing preflop and postflop models in strict import-validation mode.
6. Compare replayed pots with recognized street-pot labels when both are available.
7. Attach every problem to a specific field or action when possible.

Strict validation does not synthesize folds to skip from the engine's expected actor to the recognized actor. The existing adapter may continue using automatic folds only after validation has accepted the history or explicitly marked the omitted actors as deterministic non-participants.

Pot comparison uses a tolerance of the larger of `0.2 BB` or `2%` of the displayed pot. A mismatch outside that tolerance is a recoverable field warning unless it also makes action replay illegal. Rake, returned bets, and incomplete forced-bet information are recorded as reconciliation limitations.

The current engine's preflop and postflop numeric precision is retained initially. Recognition always preserves the original decimal amount so precision loss is visible and can be addressed without rerunning OCR.

## Confidence and Recovery

Every recognizer emits field confidence plus raw evidence. Overall confidence is the minimum confidence of required fields after validation penalties, not an average that can conceal one unsafe field.

- **High:** at least `0.90`, no blocking validation issue, and strict replay succeeds. Accept immediately.
- **Medium:** `0.65` through `0.899`, or a recoverable validation mismatch. Retry only affected crops with alternate scale, contrast, threshold, or segmentation.
- **Low:** below `0.65`, or a logically impossible value remains after retry. Request targeted AI recovery for the affected crop.

Only one deterministic retry round is performed per field. Only one targeted AI request is performed per unresolved field per import generation. The result must pass the same parser and validator as local recognition; AI output is evidence, not an exemption from poker rules.

If a required field remains unresolved, the engine returns the partial hand. Earlier independent fields and decisions remain usable when replay dependencies permit it. Warnings identify exactly which field requires correction.

## Targeted and Legacy AI Fallback

`POST /api/import/v2/resolve` accepts:

- the small crop;
- a fixed purpose enum: `hero-cards`, `board-card`, `action-text`, `action-amount`, `actor-row`, or `site-metadata`;
- site, street, allowed vocabulary, deterministic candidates, and import identifier.

The server maps the purpose enum to a narrow prompt and response schema. It does not forward an arbitrary browser prompt. Gemini remains the primary targeted provider and OpenRouter the provider fallback. Timeouts, model failover, and abort handling reuse existing LLM clients.

The existing `POST /api/import/screenshot` endpoint and full-image pipeline remain unchanged as the fallback for:

- disabled V2;
- unsupported or low-confidence site detection;
- adapter initialization failure;
- explicit developer rollback.

A known supported site does not silently switch to full-image AI merely because one field is uncertain; it uses targeted recovery or exposes correction. Whole-image fallback for a detected supported site occurs only after a pipeline-level failure that prevents region extraction, and the response records that reason.

## Replay and Decision Integration

After validation, a compatibility projection converts `ParsedPokerHand` into the existing import shape consumed by `public/importBuilderAdapter.js`. The adapter continues producing builder state, unresolved entries, warnings, and the action index.

The existing preflop/postflop models remain authoritative for state, pot and stack arithmetic, legal actions, street transitions, and editing. `public/importDecisionModel.js` continues generating state-before-action snapshots and Hero/opponent ownership. Range analysis, TexasSolver integration, coaching providers, caches, and imported-hand editing do not change semantics.

The compatibility projection and adapter preserve source-region references and field warnings so the UI can connect an unresolved replay action back to its crop and correction control.

## Progress and Partial Results

`public/importProgressModel.js` becomes a stage state machine. Stages are:

```text
site
heroCards
board
preflop
flop
turn
river
validation
reconstruction
decisions
```

Each stage has `pending`, `running`, `complete`, `warning`, or `error`, a human-readable message, and optional field references. Events update a polite live region and the imported-hand workspace.

Recognized values may appear immediately as tentative. They are marked as unvalidated until validation covers them. The active `importSession` is replaced only after the canonical hand reaches a replayable state, preserving the previous successful import if the replacement fails.

An unresolved action blocks that action and dependent later decision snapshots, not unrelated earlier decisions. An unresolved Hero or board card blocks analyses requiring those cards but does not discard recognized action history.

## Feature Gating and Rollout

Configuration adds:

```text
IMPORT_ENGINE_V2_ENABLED=false
IMPORT_ENGINE_V2_SITES=Natural8
IMPORT_ENGINE_V2_DEBUG=false
```

The server health response exposes non-secret V2 capability flags. The browser selects V2 only when enabled and the detected site appears in the configured site list. The initial default is disabled until the annotated fixture suite passes. Development and controlled rollout enable Natural8 first; CoinPoker continues using the legacy importer until a separate adapter is validated.

Debug records contain adapter version, crop coordinates, recognition candidates, confidence, retries, targeted fallback metadata, validation issues, and the final canonical hand. They do not persist original image pixels or crop base64.

## Dependencies

Add `tesseract.js` and serve its browser worker, WASM core, and English trained-data assets locally. No runtime CDN, OpenCV, frontend framework, bundler, or schema library is added.

Canonical runtime validation and confidence calculations remain small project-owned modules to avoid adding a general-purpose dependency for a single contract.

## Test Strategy

### Fixture corpus

Create approved Natural8 fixtures covering:

- multiple source resolutions and device pixel ratios;
- preflop-only through river-complete hands;
- light variations in card/table themes supported by the adapter version;
- red/black suit distinctions and visually similar ranks;
- folds, checks, calls, bets, raises, all-ins, antes, and returned bets;
- showdown overlays and partially obscured Hero cards;
- correct and intentionally corrupted crops for recovery tests.

Fixtures must be legally available for repository use and contain expected crop coordinates, cards, raw row text, parsed actions, pots, confidence outcome, and final canonical hand.

### Automated coverage

- Adapter detection and normalized crop coordinates across resolutions.
- Card rank/suit candidate ordering and confidence margins.
- OCR preprocessing and parsing of spacing, casing, decimal, and character-confusion variants.
- Independent job completion and progress-event ordering.
- Duplicate cards, impossible streets, actor conflicts, illegal ordering, bet/call mismatches, folded-player actions, and pot reconciliation.
- Strict replay that does not conceal missing rows with automatic folds.
- Medium-confidence crop-only retry.
- Low-confidence targeted fallback using mocked provider responses.
- Unsupported layout routing to the legacy endpoint.
- Canonical-to-existing-import conversion and unchanged decision snapshots.
- Partial-hand correction and dependency-scoped blocking.
- Stale import generation rejection and preservation of the prior successful session.
- Existing `npm run check` suite remaining green.

Live provider tests remain opt-in and are not required by the offline suite.

## Implementation Sequence

1. Add the fixture corpus, canonical type, runtime normalizer, and legacy-result converter.
2. Add adapter registry, Natural8 detection, crop extraction, and crop-coordinate tests.
3. Add Natural8 card templates and deterministic card recognition.
4. Add the Tesseract.js worker pool, preprocessing, row segmentation, and action parsing.
5. Add layered validation, strict replay integration, confidence, and pot reconciliation.
6. Add deterministic retry and targeted AI fallback endpoint/client.
7. Add V2 orchestration, progressive stage UI, and partial-field correction states.
8. Connect accepted hands to the existing import adapter and decision flow.
9. Add feature configuration, debug records, and rollback behavior.
10. Run offline regression, fixture accuracy, and manual browser acceptance before enabling Natural8 by default in a later explicit rollout change.

## Risks and Assumptions

- The repository currently lacks a representative Natural8 fixture corpus. Adapter thresholds and templates cannot be considered production-ready until that corpus exists.
- The existing fixture named `coinpoker-river-showdown.png` visually resembles the structured street-column layout, so it cannot by itself establish brand detection rules.
- Browser OCR has worker/WASM initialization cost and may be memory-intensive on low-end devices. Two workers are the fixed initial pool size.
- Card templates are layout/theme-specific and must be versioned. Unsupported skins lower detection or field confidence rather than being forced through a mismatched profile.
- The current poker models are six-max and use finite BB precision. Nine-max layouts and arbitrary chip/currency precision are outside V2's first supported profile.
- Pot labels may reflect rake, returns, or omitted forced bets. Pot mismatch alone is not a hard failure unless action legality also fails.
- The working tree contains existing PokeTerior changes. Implementation must preserve them and avoid broad cleanup or destructive Git operations.

## Non-Goals

- Rewriting the poker state engines, strategy analysis, solver, or coaching system.
- Implementing a CoinPoker adapter in the first V2 release.
- Migrating Manual Builder to `ParsedPokerHand` in the first V2 release.
- Supporting every Natural8 theme, table size, localized language, or screenshot composition immediately.
- Training a machine-learning card classifier.
- Removing the legacy screenshot importer before V2 has fixture-backed accuracy and rollback confidence.
