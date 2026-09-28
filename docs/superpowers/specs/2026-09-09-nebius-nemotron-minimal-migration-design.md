# Minimal Nebius Token Factory and NVIDIA Nemotron Migration

**Date:** 2026-09-09  
**Status:** Approved design, pending implementation-plan approval

## Objective

Migrate PokerCoach's central strategic coaching path to an NVIDIA open model served by Nebius Token Factory. This is the smallest substantive change that satisfies the Nebius x NVIDIA Global AI Hackathon runtime requirement while preserving the application's existing vision import, poker calculations, knowledge retrieval, solver integration, and local development workflow.

The hosted platform is intentionally outside this design. The migration will be implemented and verified locally before a separate deployment decision.

## Hackathon Fit

PokerCoach will enter the **Best Apps and Agents** track. The hackathon requires a working application that makes a runtime call to Nebius Token Factory or runs on Nebius AI Cloud and uses at least one NVIDIA open-source model.

The qualifying runtime call will be central to the product rather than decorative: NVIDIA Nemotron will generate the primary strategic poker recommendation shown to the user.

Official sources:

- https://nebiusglobalaihackathon.devpost.com/
- https://docs.tokenfactory.nebius.com/api-reference/introduction

## Scope

### Included

- Add a server-side Nebius Token Factory client using its OpenAI-compatible chat-completions API.
- Add configuration for the Token Factory API key, base URL, primary model, and optional fallback model list.
- Use `nvidia/nemotron-3-super-120b-a12b` as the default strategic reasoning model.
- Route text-based strategic analysis through Nebius first.
- Retain Gemini and OpenRouter as operational fallbacks when the Nebius call fails or returns invalid strategic output.
- Preserve the existing strategic-output validation layer.
- Return accurate provider and model attribution from analysis endpoints.
- Display visible Nebius and NVIDIA attribution with successfully generated Nemotron advice.
- Expose non-secret Nebius configuration and availability information through the health endpoint.
- Add tests covering request construction, provider priority, failover, validation, and UI attribution.
- Update the public setup documentation and environment-variable template.
- Document the work as a significant hackathon-period update to the pre-existing project.

### Excluded

- Replacing Gemini-based screenshot recognition.
- Replacing OpenRouter.
- Rewriting prompts or strategic validation except where compatibility with Nemotron requires a narrowly targeted change.
- Changing local poker math, ranges, RAG content, or knowledge retrieval.
- Replacing or containerizing TexasSolver.
- Adding persistent databases, user accounts, analytics, billing, or new poker features.
- Selecting or configuring a public hosting provider.
- Creating the Devpost submission or demo video.

## Architecture

The existing browser and HTTP API remain intact. Only the server-side reasoning-provider layer changes.

```text
Browser UI
    |
    v
Existing PokerCoach API and analysis pipeline
    |
    +--> Existing poker math and retrieved coaching context
    |
    v
Nebius Token Factory (primary)
    |
    v
NVIDIA Nemotron 3 Super
    |
    v
Existing strategic-output validation
    |
    +--> valid: return advice with Nebius/NVIDIA attribution
    |
    +--> invalid/error: existing Gemini, then OpenRouter fallback path
```

Screenshot import remains on its existing provider path. This separation keeps the migration small and avoids unnecessary changes to a working vision workflow.

## Components

### Nebius client

A new `src/llm/nebiusClient.js` module will own Token Factory HTTP details. It will:

- Send `POST {NEBIUS_BASE_URL}/chat/completions`.
- Authenticate with `Authorization: Bearer {NEBIUS_API_KEY}`.
- Translate the existing system instruction and prompt into OpenAI-compatible messages.
- Accept text requests only in this migration.
- Normalize response text, completion metadata, model identity, and usage metadata into the shape expected by the analysis pipeline.
- Throw sanitized errors that never include credentials or request authorization headers.

The default base URL will be `https://api.tokenfactory.nebius.com/v1`.

### Configuration

`src/config/env.js` will add:

- `nebiusApiKey` from `NEBIUS_API_KEY`
- `nebiusBaseUrl` from `NEBIUS_BASE_URL`
- `nebiusModel` from `NEBIUS_MODEL`
- `nebiusFallbackModels` from `NEBIUS_FALLBACK_MODELS`

Defaults:

```text
NEBIUS_BASE_URL=https://api.tokenfactory.nebius.com/v1
NEBIUS_MODEL=nvidia/nemotron-3-super-120b-a12b
NEBIUS_FALLBACK_MODELS=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B
```

Secrets remain server-side in `.env`. The browser will never receive the API key.

### Provider orchestration

The analysis pipeline will introduce a provider-neutral strategic reasoning function. Its order will be:

1. Nebius primary model.
2. Nebius fallback models, when configured.
3. Existing Gemini failover path.
4. Existing OpenRouter failover path.

Each successful response must pass existing strategic-output validation before it is accepted. A transport success with malformed or strategically invalid output counts as a failed attempt and advances to the next configured model/provider.

The orchestration applies to text-based strategic recommendations. Screenshot extraction retains its existing provider order.

### Attribution

Analysis responses already carry provider and model metadata. Successful Nemotron responses will use:

```json
{
  "provider": "nebius",
  "model": "nvidia/nemotron-3-super-120b-a12b"
}
```

The results UI will render a compact attribution only when the returned provider is `nebius`, for example:

```text
Powered by NVIDIA Nemotron via Nebius Token Factory
```

The displayed model identifier may be included in a details or debug view. The UI must not claim Nemotron produced an answer when a fallback provider actually produced it.

### Health reporting

`GET /api/health` will report non-secret configuration state, including whether a Nebius key is configured and the selected model. It will not make a paid inference request during ordinary health checks.

Live Token Factory connectivity will be established by the analysis integration tests or a separate explicit diagnostic action, not every health request.

## Data Flow

1. The browser submits the existing analysis payload.
2. The server computes or accepts the existing poker facts and mathematical context.
3. The knowledge retriever supplies the existing relevant coaching context.
4. The analysis pipeline builds the existing strategic prompt.
5. The provider orchestrator calls Nemotron through Token Factory.
6. The response passes through the existing strategic-output validator.
7. If valid, the server returns the recommendation with `provider: "nebius"` and the actual model ID.
8. If invalid or unavailable, the orchestrator records a sanitized failure and attempts the configured fallback path.
9. The browser renders the recommendation and accurate provider attribution.

## Error Handling and Security

- Missing `NEBIUS_API_KEY`: skip Nebius and continue through the existing fallback providers during local development; health output marks Nebius as unconfigured.
- Authentication or quota errors: record only status and sanitized service message, then use the next provider.
- Timeout, network error, or empty response: treat as a failed model attempt and continue failover.
- Invalid strategic output: retain validator reasons in server-side diagnostics and continue failover.
- Total provider failure: preserve the current user-facing failure behavior.
- Never log API keys, authorization headers, or complete environment values.
- `.env` remains ignored by Git; `.env.example` contains names and safe defaults only.

For hackathon demonstration and acceptance testing, Nebius must be configured and the recorded demo analysis must report `provider: "nebius"`. A fallback-produced answer does not demonstrate compliance by itself.

## Testing

### Unit tests

- Nebius client builds the correct endpoint, authorization header, model, messages, and temperature.
- Nebius client normalizes successful Token Factory responses.
- Nebius client sanitizes HTTP and empty-response failures.
- Configuration loads safe defaults and comma-separated fallback models.
- Provider orchestration tries Nebius before Gemini and OpenRouter.
- Invalid Nemotron output advances to the next attempt.
- Missing Nebius configuration preserves existing fallback behavior.
- Provider and model attribution reflect the provider that actually succeeded.
- UI attribution appears only for a Nebius result.

### Regression tests

- Existing screenshot-import tests remain unchanged and pass.
- Existing strategic validation and fallback tests pass.
- Existing UI, poker-engine, action-policy, and solver tests pass.
- JavaScript syntax checks include the new client.

### Live smoke test

With a locally configured Token Factory key, submit one deterministic sample poker spot and verify:

- Token Factory returns a non-empty response.
- The response passes strategic validation.
- The API reports `provider: "nebius"` and an NVIDIA Nemotron model.
- The UI displays the Nebius/NVIDIA attribution.

The automated test suite must not require a live API key or consume Token Factory credits.

## Documentation and Submission Evidence

The README will explain:

- Why Nemotron is the primary strategic reasoning model.
- How Token Factory is called at runtime.
- Which functionality remains outside the migration.
- Local setup using `NEBIUS_API_KEY` without exposing it.
- How to run tests and the live smoke check.
- A dated “Hackathon update” section distinguishing the new Nebius/NVIDIA integration from the pre-existing PokerCoach project.

The eventual demo must visibly show an analysis generated by Nebius, and its narration must state that the recommendation came from NVIDIA Nemotron through Nebius Token Factory.

## Acceptance Criteria

The migration is complete when all of the following are true:

1. A normal strategic-analysis request calls Nebius Token Factory first.
2. The default requested model is an NVIDIA Nemotron model available to the project.
3. A valid Nemotron response is returned to the browser with accurate provider and model attribution.
4. Existing Gemini and OpenRouter fallbacks continue working.
5. Screenshot import and TexasSolver behavior are unchanged.
6. The complete local test suite passes without requiring live credentials.
7. A credentialed live smoke test succeeds and visibly reports Nebius/Nemotron.
8. No secret appears in committed files, logs, browser responses, or test fixtures.
9. The README clearly documents the required technologies and significant hackathon-period changes.

## Future Work

After this migration is verified locally, deployment will be designed separately. The initial candidate is GCP Cloud Run calling Nebius Token Factory, which satisfies the runtime-call requirement without requiring the application server itself to run on Nebius AI Cloud. Cloud deployment must account for the current macOS-only local TexasSolver binary.
