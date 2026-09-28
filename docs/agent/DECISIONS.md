# Decisions

> Only decisions clearly evidenced by code, tests, commits, or docs. Source cited for each. Reconstructed 2026-09-19 by Claude Code; nothing here is speculation about rationale beyond what the source states.

## D1. Nemotron via Nebius Token Factory is the primary text-reasoning provider
Fallback chain: Nebius fallback model(s) -> Gemini -> OpenRouter, with validation-aware failover (invalid output moves to the next model).
Source: `README.md`, `LLM_ARCHITECTURE.md`, `src/analysis/pipeline.js` (`callReasoningProvider`), `docs/superpowers/specs/2026-09-09-nebius-nemotron-minimal-migration-design.md`, tests `nebiusReasoningProvider`, `reasoningFailoverValidation`.

## D2. Screenshot import stays on Gemini/OpenRouter vision, not Nebius
Source: `README.md` ("Screenshot import is unchanged"), `LLM_ARCHITECTURE.md`.

## D3. API keys only on the server (`.env`), never in browser code
Source: `README.md`, `LLM_ARCHITECTURE.md`, `.gitignore`.

## D4. Manual and imported hands share one UI but keep separate sessions
Manual Builder and Screenshot Import use the same table/timeline/analysis layout but separate hand/result state; import corrections never touch the manual hand.
Source: `README.md`; `public/app.js` (`manualSession`, `importSession`); `public/handSessionModel.js`; spec `2026-09-14-unified-manual-and-screenshot-builder-design.md`.

## D5. Analysis is of the state before the selected action
Source: README ("analyze the state immediately before it"); `public/importDecisionModel.js`; tests `importDecisionSnapshot`, `importDecisionModel`.

## D6. No local rule-based baseline is fed to the range LLM / Harrington prompt
Harrington prompt states local equity/EV/baseline recommendation are intentionally omitted ("Independence rule"); `rangeHistory` added to the omitted keys.
Source: `src/analysis/pipeline.js`; `tests/llmRangePromptNoRuleBaseline.test.mjs`.

## D7. Range LLM output must be valid JSON; invalid output fails over to the next model
Source: `validateRangeInterpreterOutput` in `src/analysis/pipeline.js`; `tests/rangeInterpreterJsonFailover.test.mjs`. (Uncommitted.)

## D8. Harrington output is structured JSON rendered to markdown, with token/time caps
`maxTokens: 700`, `timeoutMs: 30000`, theory limit 4, style examples 1; range interpreter `maxTokens: 1400`, `timeoutMs: 30000`.
Source: `src/analysis/pipeline.js`; `tests/harringtonStructuredOutput.test.mjs`. (Uncommitted.)

## D9. Timeouts are treated as retryable for model failover; client disconnect aborts in-flight LLM calls
Source: `shouldTryNextModel` regex now includes `timed out|timeout`; `clientAbortSignal` in `src/server/server.js`; `AbortSignal` plumbed through the three clients. (Uncommitted.)

## D10. Screenshot import has hard provider timeouts and a required-field JSON check
12 s full import, 6 s focused hero/action verification; required fields `site, heroHand, board, players, streets`; uploads are downscaled via `screenshotUploadModel`.
Source: `src/analysis/pipeline.js`, `public/screenshotUploadModel.js`; tests `screenshotImportTimeout`, `screenshotImportJsonValidation`, `screenshotUploadModel`. (Uncommitted.)

## D11. Focused hero-card vision verification is now conditional
Runs only when action issues exist, duplicate hero cards, low-confidence notes, or hero-name mismatch — no longer for every CoinPoker/Natural8 import.
Source: `src/analysis/importRepair.js` diff; `tests/importRepair.test.mjs`. (Uncommitted.)

## D12. When Hero acts first on a street, villain range is frozen to the prior street's range
Source: pipeline prompt rule for `spot.freezeToPriorStreetRange`; `public/rangeDecisionContext.js`; `tests/rangeDecisionContext.test.cjs`. (Uncommitted.)

## D13. Default Gemini import model is `gemini-3.1-flash-lite` (fallbacks `gemini-2.5-flash,gemini-3.5-flash`)
Source: `src/config/env.js`, `.env.example` diffs. Rationale **not recorded** (presumably latency; unverified).

## D14. PokeTerior visual system: near-black green, emerald-only accent; no gold/yellow states; 1600×900 no-scroll target
Source: `docs/superpowers/specs/2026-09-16-poketerior-second-pass-design.md` (committed); CSS in `public/poketerior-dashboard.css`.

## D15. Import Engine V2 is planned as feature-gated, Natural8-only, client-first, with legacy pipeline as fallback
No OpenCV/framework/bundler; Tesseract.js pinned; confidence thresholds 0.90 / 0.65; pot tolerance `max(0.2 BB, 2%)`; no persisted screenshots in debug records.
Source: `docs/superpowers/plans/2026-09-17-poker-import-engine-v2.md` and its spec (committed). **Not implemented.**

## D16. Features are delivered spec -> plan -> tasks, with separate `docs:` commits
Source: git log (`docs: design …` then `docs: plan …` pairs).

## D17–D24 (added 2026-09-19 with V2 implementation; each is evidenced by code + tests in this repo)
- **D17. V2 tests live in `npm run test:import-v2`, appended to `check`** — keeps V2 hunks out of the tests block Codex edited; the `check` tail hunk overlaps Codex's line and must be committed with it.
- **D18. Strict replay never synthesizes folds** (`importBuilderAdapter` `options.strict`); a missing middle actor becomes an unresolved field. Non-strict behaviour unchanged. (`tests/importEngineValidation.test.cjs`)
- **D19. Unknown player stacks are omitted/unknown, never 0 bb** (`knownStack` in the adapter; `toLegacy` omits null stacks).
- **D20. The builder engines stay the only source of legality rules;** the validator maps their errors to codes and only adds card/actor/amount-consistency and pot reconciliation. Pot tolerance `max(0.2 bb, 2%)`; confidence caps 0.64 (any error) / 0.89 (warnings).
- **D21. Targeted recovery is purpose-locked:** fixed server-side prompts, sanitized context, per-purpose answer validation, one request per unresolved field per import, provider order Gemini → OpenRouter, 6 s timeout.
- **D22. Debug records remove (not mask) pixel-bearing keys and data-URL/opaque base64 values.**
- **D23. A V2 replacement import commits atomically:** the session is only replaced after conversion succeeds; a failed/non-replayable/stale V2 attempt leaves the previous session untouched and falls back to the whole-image importer.
- **D24. Decisions that depend on an unresolved replay entry are disabled; the unresolved action itself stays selectable** so it can be corrected (board problem blocks its whole street).

