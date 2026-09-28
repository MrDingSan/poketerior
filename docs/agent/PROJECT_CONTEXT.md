# Project Context

> Reconstructed by Claude Code on 2026-09-19 from the repository (git + code + docs). Only stable facts are recorded here. Anything unverified is marked **Unknown**.

## Purpose

"Poker Coach" (UI brand: **PokeTerior**) is a street-by-street no-limit hold'em analysis prototype. It builds a hand from preflop through river, estimates villain ranges/combos, computes equity and price, and produces a coaching-style recommendation. Source: `README.md`, `LLM_ARCHITECTURE.md`.

Two ways to enter a hand:
- **Manual Builder** – actions recorded one at a time (preflop + postflop builders).
- **Screenshot Import** – a vision LLM extracts a full hand from a CoinPoker/Natural8-style screenshot; the user picks any timeline action to analyze the state immediately before it, and can correct imported actions. Manual and Import sessions are kept separate.

The repo is also a submission for the **2026 Nebius x NVIDIA Hackathon** (README section "2026 Nebius x NVIDIA Hackathon Update"): NVIDIA Nemotron via Nebius Token Factory is the primary strategic-reasoning model.

## Technology stack

- Node.js ES modules (`"type": "module"`), no framework, no bundler. Dev environment observed: Node v25.5.0.
- Single runtime dependency: `sharp` (image cropping).
- Frontend: vanilla browser JS in `public/` (IIFE modules attached to `window`/`globalThis`, a large `app.js`, `index.html`, `styles.css`, `poketerior-dashboard.css`). Many `public/*.js` files are also `require`d by CJS tests.
- Local Node HTTP server: `src/server/server.js` (serves static files + API). Default port `4175` (`PORT`).
- LLM providers: Nebius (OpenAI-compatible), Gemini, OpenRouter. Optional TexasSolver console binary for postflop solving.
- Tests: plain `node tests/<name>.test.{cjs,mjs}` assertion scripts (no test runner).

## Architecture

```text
Browser (public/)
  -> Node server (src/server/server.js)
  -> src/analysis/pipeline.js  (spot + math payload + retrieved knowledge + prompts + validation)
  -> src/llm/{nebius,gemini,openRouter}Client.js
```

Text reasoning provider order (`callReasoningProvider` in `src/analysis/pipeline.js`): Nebius primary model -> Nebius fallback models -> Gemini failover -> OpenRouter failover, with validation-aware failover (an invalid response triggers the next model).
Screenshot import uses the Gemini/OpenRouter vision path (not Nebius).

API endpoints (README + server.js): `GET /api/health`, `POST /api/analyze`, `/api/analyze/harrington`, `/api/range/interpret`, `POST /api/import/screenshot`, `POST /api/solver/recommend`, plus analysis-log endpoints.

## Important directories

| Path | Contents |
|---|---|
| `public/` | Browser app. `*Model.js` = pure logic; `*View.js` = DOM rendering; `app.js` = wiring. |
| `src/analysis/` | `pipeline.js` (LLM orchestration), `handFacts.js`, `strategicOutputValidation.js`, `importRepair.js`, `importValidation.js`, `importActionConsistency.js`, `heroCardCrop.js`, `visionDebug.js`, `pokerSkill.js` |
| `src/llm/` | Provider clients |
| `src/config/env.js` | `.env` loading and defaults |
| `src/solver/` | TexasSolver adapter |
| `src/knowledge/` | Retrieval over `knowledge-base/` and `data/harrington/` |
| `knowledge-base/` | Notes/examples for RAG (`raw/`, `index/` git-ignored) |
| `resources/ranges`, `docs/preflop-ranges` | Preflop range data/docs |
| `tests/` | ~58 test scripts, `tests/fixtures/` |
| `docs/superpowers/specs`, `docs/superpowers/plans` | Design specs and implementation plans (the project's planning record; dated filenames) |
| `docs/research/` | Product analysis reports (ToolPoker comparison) |
| `logs/`, `tmp/`, `.worktrees/` | Git-ignored runtime output |
| `src/app`, `src/poker-engine` | READMEs only ("future" modules) |

## Conventions (observed)

- Tests are wired into `npm run check` (offline full suite) and `npm run precheck` (unified builder + postflop). `check` starts with `node --check` on each module, then runs test scripts. New tests must be added to the `package.json` script by hand — some currently are not (see CURRENT_TASK.md).
- Tests frequently include "wiring" tests that grep source files (e.g. `index.html`, `app.js`) for expected identifiers, so renaming things can break them.
- Model/view separation in `public/`; pure models are unit-tested without a DOM.
- Commit style: Conventional Commits (`feat:`, `fix:`, `docs:`), one design commit and one plan commit per feature (`docs: design ...`, `docs: plan ...`).
- Feature work follows superpowers-style spec -> plan -> implementation with checkbox plans in `docs/superpowers/plans/`.
- `README` states: API keys live only in local `.env`, never in browser code. `.env` is git-ignored.

## Persistent constraints

- Never expose or commit API keys; do not read/print `.env`.
- Screenshot import must keep working through the Gemini/OpenRouter vision path (README, import-engine-v2 plan "keep `/api/import/screenshot` operational as fallback").
- Imported-hand edits must never overwrite the Manual Builder hand (README).
- Analysis is of the state **before** the selected action ("state-before-action").
- `npm run check` must stay offline (no model credits consumed); `npm run smoke:nebius` is the only intentional live call.
- Preserve pre-existing uncommitted work; stage only files owned by the active task (import-engine-v2 plan, Global Constraints).

## Unknown

- Whether `npm run dev` currently starts and renders correctly in a browser (not verified at takeover).
- Hackathon deadline / submission status.
- Whether the tracked `.superpowers/` brainstorm dir should be committed (it is untracked; contains only a `server-stopped` marker as far as observed).
