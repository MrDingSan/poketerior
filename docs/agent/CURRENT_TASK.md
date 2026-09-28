# Current Task (reconstructed)

> **UPDATE 2026-09-19 (later):** Workstream 3 (Poker Import Engine V2) is now implemented in the working tree and largely committed — see `HANDOFF.md` Handoff #2 for exact state, what is held for user review, and known gaps. The text below is the original reconstruction and is otherwise unchanged.

> Reconstructed by Claude Code on 2026-09-19. Codex left no handoff notes. Everything below is inferred from git, the working tree, plans/specs in `docs/superpowers/`, and test results. Inferences are labeled.

## Objective (inferred)

Three overlapping workstreams sit in the working tree; only the first is clearly "in the diff":

1. **PokeTerior UI refactor + unified Manual/Screenshot builder workspace** (plans `2026-09-14-unified-manual-and-screenshot-builder`, `2026-09-15-poketerior-ui-refactor`, `2026-09-16-poketerior-second-pass`). Goal: one shared table/board/street-navigator/timeline/analysis layout for both input modes, restyled as a dense dark-green "AI inference dashboard".
2. **Analysis latency/robustness hardening** (uncommitted, no plan file found): provider timeouts, `maxTokens`, client-disconnect abort signals, JSON-structured Harrington output, range-interpreter JSON validation with failover, screenshot-import timeouts/JSON validation, upload downscaling (`screenshotUploadModel`), import progress model.
3. **Poker Import Engine V2** (spec + plan committed in `1b06385`, `294d2a1`, 2026-09-17): client-first Natural8 screenshot importer (template card recognition, Tesseract OCR, validation, targeted AI fallback). **Implementation has NOT started** — `public/import-engine/`, `src/import-engine/` and `IMPORT_ENGINE_V2_ENABLED` do not exist.

Codex's last file edit was 2026-09-16 21:53 (`src/analysis/pipeline.js`); last commit was the V2 plan on 2026-09-17 08:58. So the uncommitted work (1 & 2) predates the V2 plan and was never committed; V2 Task 1 is the presumed next step.

## Current state

- Branch `codex/nebius-hackathon`, HEAD `294d2a1`. 27 modified tracked files (+1500/−187), 30+ untracked files/dirs. Nothing staged, no stash, no other worktrees.
- **All automated tests pass** at takeover (2026-09-19): `npm run check` exit 0, `npm run precheck` exit 0, and all 58 `tests/*.test.*` files pass when run individually. `git diff --check` clean.
- App was **not** launched/visually verified by me (server was not running).

## Files involved

Modified (tracked):
- Frontend: `public/app.js` (+417), `public/index.html`, `public/styles.css` (+532), `public/importDecisionModel.js`, `public/llmRangeGuard.js`, `public/{pre,post}flopBuilder{Model,View}.js`
- Backend: `src/analysis/pipeline.js` (+157), `src/analysis/importRepair.js`, `src/server/server.js`, `src/config/env.js`, `src/llm/{nebius,gemini,openRouter}Client.js`
- Config/docs: `package.json`, `.env.example`, `README.md`
- Tests: `importRepair`, `llmRangeGuard`, `llmRangePromptNoRuleBaseline`, `nebiusClient`, `nebiusReasoningProvider`, `postflopBuilderWiring`, `preflopBuilderModel`, `preflopBuilderWiring`

Untracked (new):
- `public/`: `analysisRequestModel.js`, `handSessionModel.js`, `handStagePresentation.js`, `handWorkspaceView.js`, `importBuilderAdapter.js`, `importProgressModel.js`, `rangeDecisionContext.js`, `screenshotUploadModel.js`, `poketerior-dashboard.css`
- `tests/`: matching `*.test.*` for the above plus `harringtonStructuredOutput`, `rangeInterpreterJsonFailover`, `screenshotImportJsonValidation`, `screenshotImportTimeout`, `importBuilderEditing/Wiring`, `importDecisionSnapshot`, `poketeriorShell`, `poketeriorDiagnostics`; `tests/fixtures/coinpoker-river-showdown.png` (1.2 MB real screenshot, mode 600)
- Docs: `docs/superpowers/plans/2026-09-15-…`, `2026-09-16-…` (the two plans are untracked though their specs are committed), `docs/research/` (ToolPoker report .docx + md source)
- Misc: `resources/logo.png` (932 KB), `scripts/build_toolpoker_report.py`, `.superpowers/` (brainstorm scratch)

## What appears completed

- Unified hand session model, import→builder adapter, shared workspace view, import progress model, screenshot upload model, analysis request model, range decision context (each has passing tests).
- Import decisions selectable/editable in the shared workspace; separate manual/import sessions (`manualSession`/`importSession` in `app.js`).
- Provider client timeouts / `maxTokens` / abort-signal plumbing through `pipeline.js`; Harrington output now strict JSON reformatted to markdown; range interpreter validated as JSON; screenshot import output validation and timeouts (12 s full, 6 s focused).
- `shouldVerifyHeroHandWithFocusedVision` narrowed (no longer runs for every CoinPoker/Natural8 import).
- `freezeToPriorStreetRange` handling when Hero acts first on a street.
- Default `GEMINI_IMPORT_MODEL` changed to `gemini-3.1-flash-lite` (config + `.env.example`).
- V2 spec and plan written and committed.

## What remains / unverified

- **Second-pass plan Task 6** (end-to-end functional + visual verification at 1600×900 and 1000 px) — no evidence it was done. Its Step 1 references two tests that do not exist: `tests/importDecisionLaunch.test.cjs`, `tests/poketeriorLayoutContract.test.cjs`. Either they were never written (Tasks 4/5 may be incomplete) or the plan was revised. **Unknown.**
- `public/handStagePresentation.js` is loaded by `index.html` and has a test, but no other `public/*.js` references it — possibly not yet consumed by the UI (plan Tasks 2–3 wiring status **unknown**).
- 6 test files are not in any `package.json` script, so `npm run check` does not run them: `apiClient`, `handStagePresentation`, `importProgressModel`, `screenshotImportJsonValidation`, `screenshotImportTimeout`, `screenshotUploadModel`. They do pass when run directly.
- Nothing has been committed for workstreams 1 and 2; two plan files are untracked.
- Import Engine V2 Tasks 1–N: not started.
- README does not mention the new UI/timeouts; `README`/`.env.example` diffs are small.
- Decide what to do with `.superpowers/`, `docs/research/`, `resources/logo.png`, the 1.2 MB fixture PNG (commit vs. ignore).

## Known failures

- None found by automated tests. No known runtime failures; runtime behavior not exercised at takeover.

## Acceptance criteria (inferred from plans, not stated by the user)

- Second pass: `npm run check && node tests/handStagePresentation.test.cjs && … && git diff --check` all exit 0; at 1600×900 header, selector, table, progress rail, decision panel, timeline, tabs and upper analytics cards visible without scrolling; manual analysis and per-decision import analysis both work; at 1000 px no horizontal overflow.
- V2 (when started): feature-gated (`IMPORT_ENGINE_V2_ENABLED=false` default), Natural8-only, legacy `/api/import/screenshot` remains working fallback, no screenshots/crops persisted in V2 debug records.
- **The user has not yet told me which workstream to prioritize.**
