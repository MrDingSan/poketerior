# Nebius Nemotron + RAG Architecture

Poker Coach uses NVIDIA Nemotron through Nebius Token Factory as its primary text-based strategic reasoning layer. Existing Gemini and OpenRouter integrations remain available as fallbacks.

## Where The API Key Goes

Create a local `.env` file at the project root:

```text
NEBIUS_API_KEY=your-nebius-token-factory-key
NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1
NEBIUS_MODEL=nvidia/nemotron-3-super-120b-a12b
NEBIUS_FALLBACK_MODELS=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B
GEMINI_API_KEY=your_google_ai_studio_key
GEMINI_MODEL=gemini-2.5-flash
PORT=4175
```

Do not commit `.env`. It is ignored by git.

## Runtime Flow

```text
Browser UI
  -> local server /api/analyze
  -> poker calculation payload
  -> knowledge retrieval from knowledge-base
  -> NVIDIA Nemotron through Nebius Token Factory
  -> existing strategic-output validation
  -> expert natural-language analysis
  -> browser UI
```

Text reasoning provider order:

1. Nebius Token Factory primary Nemotron model.
2. Configured Nebius fallback models.
3. Existing Gemini model failover.
4. Existing OpenRouter model failover.

Screenshot import is deliberately unchanged and continues to use the existing Gemini/OpenRouter vision provider path.

## Key Files

```text
src/server/server.js       # local server, static files, /api/analyze
src/analysis/pipeline.js   # combines spot + math + retrieved context
src/llm/nebiusClient.js    # Token Factory chat-completions caller
src/llm/geminiClient.js    # Existing Gemini fallback and vision caller
src/llm/openRouterClient.js # Existing OpenRouter fallback caller
src/knowledge/retrieve.js  # local note/example retrieval
knowledge-base/notes/      # Harrington and other concept notes
knowledge-base/examples/   # sample analyses / preferred style
```

## Why A Local Server

API keys must not be placed in browser JavaScript. The browser calls the local server, and the server calls Token Factory with `NEBIUS_API_KEY` or the configured fallback provider.

## Verification

`npm run check` runs offline and never consumes model credits. `npm run smoke:nebius` is an explicit live request that verifies the configured Token Factory model and reports token usage without printing the key.

## Official Token Factory Details

Token Factory exposes an OpenAI-compatible endpoint:

```text
POST https://api.tokenfactory.nebius.com/v1/chat/completions
Header: Authorization: Bearer $NEBIUS_API_KEY
```

See:

- https://docs.tokenfactory.nebius.com/api-reference/introduction
- https://nebiusglobalaihackathon.devpost.com/
