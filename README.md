# PokeTerior — Poker Coach

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![Node 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![NVIDIA Nemotron](https://img.shields.io/badge/NVIDIA-Nemotron%203%20Super-76B900)
![Nebius Token Factory](https://img.shields.io/badge/Nebius-Token%20Factory-3A2EFF)

PokeTerior is a street-by-street coach for no-limit hold'em. You enter a hand, either action by action or from a screenshot of a hand history. The app then works out villain ranges and combos, equity, pot odds and the legal actions at every decision. **NVIDIA Nemotron 3 Super, served through Nebius Token Factory**, uses that computed evidence to write the coaching recommendation you see.

Built for the [Nebius x NVIDIA Global AI Hackathon 2026](https://nebiusglobalaihackathon.devpost.com/).

---

## Contents

- [How NVIDIA Nemotron is used](#how-nvidia-nemotron-is-used)
- [How Nebius Token Factory accelerated the work](#how-nebius-token-factory-accelerated-the-work)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Using the app](#using-the-app)
- [Testing](#testing)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [License and third-party content](#license-and-third-party-content)

---

## How NVIDIA Nemotron is used

Nemotron handles every piece of strategic reasoning in the product. No other model runs first. Deterministic code computes the facts, and Nemotron reasons over them.

| Feature | Endpoint | What Nemotron does |
| --- | --- | --- |
| **Coaching recommendation** | `POST /api/analyze` | Reads the hand state, pot odds, equity vs. range and retrieved study notes. Returns a recommended action (fold / call / raise sizing) and explains it. |
| **Villain range interpretation** | `POST /api/range/interpret` | Narrows villain's range street by street from the betting line and board texture, and returns structured JSON that the range matrix displays. |
| **Harrington-style analysis** | `POST /api/analyze/harrington` | Writes a second, book-style breakdown of the same spot in a structured format. |
| **Poker-skill analysis** | `POST /api/analyze/pokerskill` | Picks the relevant concepts for the spot (for example SPR, blockers or board texture) and explains how they apply. |

**Models**

- Primary: `nvidia/nemotron-3-super-120b-a12b`, a 120B-parameter hybrid MoE model with about 12B active parameters, called with `reasoning_effort: "low"` to keep answers fast.
- Optional same-provider fallback: `NEBIUS_FALLBACK_MODELS`, for example `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`. This is off by default because Nano used its whole token budget reasoning on the long range prompt and returned no content.

**Safeguards on the model's output.** Every Nemotron response goes through `src/analysis/strategicOutputValidation.js` before the UI shows it. A response is rejected if it:

- recommends an illegal action, such as "bet" when Hero faces an all-in;
- contradicts the computed hand facts;
- comes back truncated or empty.

When a response is rejected, the next model in the chain is tried. The UI shows the provider and model that actually produced the answer ("Powered by NVIDIA Nemotron via Nebius Token Factory", see `public/providerAttribution.js`). It never shows a hard-coded label.

Key files:

```text
src/llm/nebiusClient.js              # Token Factory chat-completions client (no SDK, plain fetch)
src/analysis/pipeline.js             # callNebiusWithFailover / callReasoningProvider and all prompts
src/analysis/strategicOutputValidation.js
scripts/nebius_smoke.mjs             # live connectivity check
tests/nebiusClient.test.mjs          # offline contract tests
tests/nebiusReasoningProvider.test.mjs
```

## How Nebius Token Factory accelerated the work

- **Drop-in, OpenAI-compatible API.** The whole integration is about 80 lines of `fetch` in `src/llm/nebiusClient.js`. There's no SDK and no extra dependency. Adding Nemotron as the primary reasoning model didn't require changing any prompt or validator.
- **No GPU setup.** Serving a 120B MoE model ourselves would have meant provisioning multi-GPU inference. With Token Factory, the setup was one API key.
- **Model swaps by config.** `NEBIUS_MODEL` and `NEBIUS_FALLBACK_MODELS` are environment variables. We compared Nemotron 3 Super with Nemotron 3 Nano on our real range prompts without changing code, and that comparison is how we found Nano's empty-content problem and chose Super as the default.
- **`reasoning_effort` control.** Setting it to `low` kept the coaching loop interactive while keeping Super's reasoning quality.
- **Usage metadata.** Every completion returns token usage, which is saved in the local analysis logs. This let us watch prompt sizes as we added retrieved context.

Other services: screenshot import (vision) uses Google Gemini, with OpenRouter as an optional fallback. Both of those, plus Gemini and OpenRouter as text fallbacks, are only used when Nebius is unavailable or its answer fails validation.

## Quick start

**Requirements:** Node.js 20 or newer (tested on 25), npm, and a [Nebius Token Factory](https://tokenfactory.nebius.com/) API key.

```bash
git clone https://github.com/MrDingSan/poketerior.git
cd poketerior
npm install
cp .env.example .env
```

Open `.env` and set your key:

```text
NEBIUS_API_KEY=your-nebius-token-factory-key
```

Optionally, confirm the key and model work. This makes one small, billed request:

```bash
npm run smoke:nebius
```

Start the app:

```bash
npm run dev
```

Then open **http://localhost:4175**.

`npm install` also copies the local Tesseract OCR assets into `public/vendor/tesseract/`. Nothing is loaded from a CDN.

## Configuration

All settings live in `.env`, which is git-ignored. API keys stay on the server and are never sent to the browser.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NEBIUS_API_KEY` | **yes** | — | Token Factory key for Nemotron reasoning |
| `NEBIUS_BASE_URL` | no | `https://api.tokenfactory.nebius.com/v1` | Token Factory endpoint |
| `NEBIUS_MODEL` | no | `nvidia/nemotron-3-super-120b-a12b` | Primary reasoning model |
| `NEBIUS_FALLBACK_MODELS` | no | *(empty)* | Comma-separated extra Nebius models |
| `GEMINI_API_KEY` | for screenshot import | — | Vision import, plus a text fallback |
| `OPENROUTER_API_KEY` | no | — | Additional fallback |
| `PORT` | no | `4175` | Server port |
| `TEXAS_SOLVER_BINARY` / `TEXAS_SOLVER_RESOURCES` | no | *(empty)* | Paths to a [TexasSolver](https://github.com/bupticybee/TexasSolver) console build for the optional solver check |
| `IMPORT_ENGINE_V2_ENABLED` | no | `false` | Experimental in-browser OCR importer |

To use only the Nebius key, leave the rest empty. Manual hand building and all Nemotron analysis work without the other keys. Screenshot import needs `GEMINI_API_KEY` or `OPENROUTER_API_KEY`.

## Using the app

1. **Manual Builder.** Choose positions and stacks, deal Hero's cards, then record actions one at a time through preflop, flop, turn and river.
2. **Screenshot Import.** Upload a hand-history screenshot. The whole hand is extracted, and you can pick any action on the timeline to analyze the spot just before it. You can correct imported actions from the decision panel.
3. **Analysis.** For the selected decision, the workspace shows:
   - the villain range matrix, locked street by street;
   - equity, pot odds and the legal actions;
   - Nemotron's recommendation and explanation, with the model that produced it.

   The Harrington-style and poker-skill tabs give further breakdowns of the same spot.

Server endpoints:

```text
GET  /api/health                 # which providers/models are configured
POST /api/analyze                # Nemotron coaching recommendation
POST /api/range/interpret        # Nemotron villain range narrowing
POST /api/analyze/harrington     # Nemotron book-style analysis
POST /api/analyze/pokerskill     # Nemotron concept-driven analysis
POST /api/import/screenshot      # vision import (Gemini / OpenRouter)
POST /api/solver/recommend       # optional TexasSolver check
```

## Testing

All test suites run offline and use no model credits:

```bash
npm run check      # core, providers, Nebius client, validation, import V2
npm run precheck   # hand builder, range matrix, layout and design tokens
```

`npm run smoke:nebius` is the only command that calls Token Factory. It prints the provider, model, reply and token usage, and never prints the key.

## Architecture

```text
Browser (public/)
  │  hand state, selected decision
  ▼
Node server (src/server/server.js)          ← API keys live here only
  │
  ├─ deterministic poker math               equity, pot odds, legal actions, hand facts
  ├─ range model + preflop charts           resources/ranges/
  ├─ knowledge retrieval                    knowledge-base/ (keyword-scored chunks)
  │
  ▼
Nebius Token Factory  ──►  NVIDIA Nemotron 3 Super
  │
  ▼
strategic-output validation  ──(rejects)──►  next model in chain
  │
  ▼
recommendation + provider attribution  →  Browser
```

Reasoning provider order: Nebius primary Nemotron → Nebius fallback models → Gemini → OpenRouter. A later provider is only tried if the earlier one errors or its answer fails validation. See [LLM_ARCHITECTURE.md](LLM_ARCHITECTURE.md) for details.

## Project structure

```text
public/                 browser app (vanilla JS, no build step)
  import-engine/        experimental in-browser OCR import (V2)
src/
  server/server.js      HTTP server and API routes
  llm/                  Nebius, Gemini and OpenRouter clients
  analysis/             prompts, pipeline, validation, hand facts
  knowledge/            local retrieval over knowledge-base/
  solver/               TexasSolver adapter
knowledge-base/         notes and examples used as retrieval context
resources/ranges/       6-max preflop ranges (MIT, see below)
scripts/                smoke test and asset helpers
tests/                  offline test suites
```

### Import Engine V2 (experimental, off by default)

This is an in-browser importer that reads Natural8 screenshots with local Tesseract OCR and card-template matching. Only a crop it can't read is sent to a model, through `POST /api/import/v2/resolve`. It stays disabled until a labeled corpus validates it, and the default whole-image importer is unaffected. Its known gaps are recorded in the source under `public/import-engine/`.

## Hackathon changes

PokeTerior existed before the hackathon. During the submission period we added:

- the Nebius Token Factory client and Nemotron 3 Super as the primary reasoning model;
- validation-aware failover and truthful provider/model attribution in the UI;
- Nemotron-driven villain range interpretation with street-by-street range locking;
- the tabbed analysis workspace and the redesigned hand stage;
- offline contract tests and an opt-in live smoke test.

## License and third-party content

- The project is released under the [MIT License](LICENSE).
- `resources/ranges/6max/tyloo-poker-range-analyzer/` comes from Poker Range Analyzer by Julien "Tyloo" Bonvarlet, under the MIT License. Its license file is included in that directory.
- Copyrighted book text is **not** included. The Harrington-style endpoint can optionally retrieve context from your own notes at `data/harrington/harrington_theory.md` and `data/harrington/harrington_hands.md`, which are git-ignored. Without them the endpoint still works, and Nemotron simply receives no retrieved excerpts.
