# Strategic LLM Grounding and Output Validation

## Problem

Analysis `pc_20260803142529_4dd008f4` exposed two related reliability gaps. Gemini incorrectly classified `Ah Jh` on `Tc 9c 4s` as a gutshot, entered a self-correction repetition loop, and returned a response ending mid-sentence. Poker Coach accepted and displayed that non-empty response without validating its factual grounding or completion.

The recent removal of unstable local range and equity conclusions made the first gap more visible: strategic modules now reason more independently, but they were not given a deterministic replacement for basic hero hand and draw facts.

## Goals

- Keep Harrington and PokerSkill recommendations independent from local equity, EV, confluence, combo counts, and baseline recommendations.
- Give both modules deterministic facts for Hero's current made hand and draw structure.
- Prevent repetitive, truncated, or structurally incomplete strategic responses from reaching the UI.
- Retry another configured model when a response is invalid.
- Preserve enough raw provider metadata to diagnose generation failures.

## Non-goals

- Restore the removed local recommendation or range conclusion as strategic evidence.
- Build a full solver or replace the existing range interpreter.
- Change the visual design of the analysis panels beyond displaying the existing unavailable/error state when every model fails.

## Design

### Deterministic hand facts

Add a server-side, independently testable hand-fact module. Given Hero's two cards and the visible board through the current street, it returns compact facts including:

- made-hand category;
- overcards to the board;
- direct flush draw status;
- direct straight draw status;
- backdoor flush and straight possibilities where applicable.

For `Ah Jh` on `Tc 9c 4s`, it must report ace-high, two overcards, no direct straight draw, no direct flush draw, no backdoor flush draw, and backdoor straight possibilities only. The prompt will state that these supplied facts are authoritative and must not be recalculated or contradicted.

These facts will be included in both Harrington and PokerSkill prompts. They will not be treated as an action recommendation.

### Strategic payload cleanup

The independent strategic payload will retain stable action constraints and context: legal actions, facing-all-in status, pot, call price, Hero class, villain action label, villain filter label, and board texture.

It will omit nested `rangeHistory`, because that structure currently leaks local combo snapshots and action buckets even though equivalent top-level local range fields are deliberately removed. This makes the independence boundary internally consistent.

### Provider response metadata

The Gemini client will expose compact generation metadata from the selected candidate, including `finishReason`, safety information when present, and usage/token metadata. Raw provider data need not be returned to the browser, but the diagnostic log will retain the compact metadata.

### Output validation and failover

Strategic prose responses will be validated before being accepted. Validation will reject:

- repeated phrases or sentence fragments above a conservative threshold;
- output ending in an obviously incomplete fragment;
- a non-success Gemini finish reason;
- Harrington output missing the required Situation, Key Evidence, Candidate Actions, Recommendation, or Caveats sections.

Validation failure is treated like a model failure. The existing configured model sequence is tried in order. Each failed attempt records the model and validation reason. If Gemini models are exhausted, the existing OpenRouter fallback remains available. Only a validated response is returned to the UI.

The validator will be conservative to avoid rejecting legitimate repeated poker terms or short concise answers. Structural section requirements apply specifically to Harrington output; generic provider validation remains format-neutral.

### Failure behavior

If all configured models fail generation or validation, the endpoint returns its existing error response. The current client then displays the existing Harrington-unavailable warning instead of malformed prose.

## Data flow

1. Browser submits the stable spot and local math payload.
2. Server sanitizes the strategic payload.
3. Server derives deterministic Hero hand facts.
4. Prompt includes stable spot facts, sanitized strategic context, deterministic hand facts, and focused Harrington retrieval context.
5. Provider generates a candidate response and returns compact completion metadata.
6. Validator checks completion, repetition, and Harrington structure.
7. Invalid candidates trigger configured model failover and are recorded as model failures.
8. Only validated prose reaches the browser.

## Testing

Tests will be written before production changes and will cover:

- `Ah Jh` on `Tc 9c 4s` has no direct straight or flush draw;
- representative genuine gutshot, open-ended, and flush-draw hands remain correctly classified;
- sanitized strategic payload excludes nested `rangeHistory`;
- Harrington prompts contain authoritative deterministic hand facts;
- the exact repeated `If a Q comes...` pattern is rejected;
- normal poker prose containing occasional repeated terminology is accepted;
- incomplete and structurally incomplete Harrington responses are rejected;
- invalid first-model output triggers the next configured model;
- compact Gemini completion metadata is preserved in debug output;
- the full existing regression suite remains green.

## Deployment verification

After implementation, run the complete project check, restart the detached `pokercoach4175` server, verify `/api/health`, verify the changed browser asset/API behavior is served, and confirm the listener is the newly deployed process.
