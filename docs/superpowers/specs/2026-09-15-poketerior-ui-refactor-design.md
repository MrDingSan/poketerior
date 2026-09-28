# PokeTerior UI Refactor Design

## Goal

Refactor the existing PokerCoach interface into PokeTerior without rewriting the application. Preserve the current manual and screenshot hand builders, poker state and calculations, action legality, street progression, range analysis, AI analysis, TexasSolver integration, API contracts, asynchronous state isolation, and diagnostic capability.

The supplied PokeTerior dashboard mockup is a visual-hierarchy reference rather than a replacement interaction model. The existing oval poker table, positional seats, street navigator, action controls, and hand timeline remain the functional center of the product.

## Existing Architecture

- `public/index.html` owns the application shell, builder containers, dialogs, and shared analysis markup. The root `index.html` only redirects to it.
- `public/styles.css` owns global tokens, layout, component presentation, and responsive behavior.
- `public/preflopBuilderView.js` and `public/postflopBuilderView.js` render the interactive tables, seats, action controls, street navigation, and timelines.
- `public/handWorkspaceView.js` renders the imported-hand workspace using the shared builder vocabulary.
- `public/rangeMatrixView.js` and `public/postflopAnalysisView.js` render compact range and postflop analysis views.
- `public/app.js` coordinates input modes, analysis requests, solver output, range interpretation, AI reasoning, errors, and diagnostics.
- Builder models, analysis modules, solver adapters, and backend routes remain the source of truth for behavior and calculations.

## Brand System

The product name becomes PokeTerior throughout the user-facing interface. The supplied wordmark is authoritative: “Poke” uses a light neutral on the dark application header, “Terior” uses emerald, and a small spade sits above the “i.” The logo is presented as a wordmark without a separate oversized poker symbol.

The visual tokens use:

- Near-black and deep forest page backgrounds.
- Charcoal-green panels with restrained separation.
- Emerald for selected, recommended, complete, and primary-action states.
- Warm off-white primary text and card faces.
- Muted gray-green secondary text.
- Subtle borders and shadows with minimal glow.

Gold, ornamental casino styling, heavy gradients, and unnecessary visual effects are removed. Existing system fonts are retained.

## Application Shell

The desktop shell contains:

1. A compact header with the PokeTerior wordmark, the subtitle “Posterior reasoning for better poker decisions,” and an outlined emerald New Hand action.
2. A quiet three-segment input selector for Screenshot Import, Quick Entry, and Manual Builder. Manual Builder uses the emerald active state; disabled Quick Entry remains visibly unavailable.
3. The existing hand-builder composition, with street progression on the left, the poker table and timeline in the center, and the current-decision rail on the right.
4. A structured analysis workspace below the builder.

The existing preflop setup remains available but is visually compressed so the hand itself has priority.

## Hand Builder

The oval table remains the primary visualization. It receives deep muted felt, a restrained rim, compact seat cards, readable community cards, a clean pot badge, and subtle emerald emphasis for Hero and the current actor. It should read as an analytical state visualization rather than a game client.

Street navigation keeps Pre-flop, Flop, Turn, River, and Results. Completed streets use a small green completion state, the current street uses emerald emphasis, and future streets remain subdued.

The decision rail leads with “Your Decision” and presents legal actions as neutral dark controls. Selected or recommended actions use emerald. Opponent assumptions become compact contextual information. Analyze Street or Analyze Pre-flop is the dominant emerald action.

The horizontal hand timeline remains visible beneath the table. Previous actions, street transitions, and the current decision have distinct restrained states; the current node uses an emerald outline instead of gold or dashed emphasis.

## Analysis Workspace

The analysis surface uses the tabs Ranges, Equity, AI Analysis, and Breakdown as a visual organization layer while preserving all existing output.

The first summary row contains:

- Estimated Range: opponent label, live combination count, compact 13×13 range matrix when parseable, and value/bluff/mixed grouping when available.
- Board Texture: concise structural labels and only the most relevant observations.
- Range Evolution: prior range through each available street posterior, emphasizing how observed actions update the distribution.

The AI summary leads with the recommended action, then compact equity, required equity or pot odds, EV, and evidence/confidence metrics when the current analysis supplies them. A concise explanation follows.

Detailed content remains available under expandable sections for Why, Range Reasoning, Action Comparison, Full AI Reasoning, Skill-Grounded Analysis, and Developer Details/Diagnostics. This is progressive disclosure only; detailed output and fallback analysis are not deleted.

## Errors and Diagnostics

Normal users see compact statuses such as “AI range analysis unavailable” with a Retry action. Raw URLs, local paths, provider/model identifiers, analysis IDs, prompt diagnostics, formulas, solver status, and full error traces appear only inside collapsed Developer Details or Diagnostics sections.

Independent analysis panels may still succeed or fail separately. Existing retry behavior, cached results, fallback reasoning, and stale-response guards remain intact.

## Responsive Behavior

Desktop is the primary target. At narrower widths:

- The street navigator becomes horizontal.
- The poker table remains first and retains horizontal breathing room.
- The decision rail moves below the table.
- Timeline content scrolls or wraps without hiding actions.
- Analysis summaries stack vertically.

No separate mobile application or framework migration is introduced.

## Implementation Boundaries

Primary changes are limited to `public/index.html`, `public/styles.css`, and presentation renderers that require semantic classes or compact summary markup. Existing DOM IDs and event hooks are retained wherever possible. Poker calculations, state transitions, API contracts, and solver logic are out of scope.

The supplied logo attachment replaces the invalid placeholder currently stored at `resources/logo.png`. If a dark-background raster treatment is unsuitable, the header may reproduce the same approved wordmark in accessible HTML/CSS while keeping the supplied file as the source asset.

## Verification

Automated work will add or update structural rendering assertions before implementation and run the complete `npm run check` suite afterward. Manual browser verification covers:

1. Manual preflop entry, action selection, and analysis.
2. Flop/turn/river progression and board-card entry.
3. Screenshot import and imported decision selection.
4. Range matrix and range-evolution rendering.
5. AI recommendation, fallback, retry, and collapsed diagnostics.
6. New Hand behavior and state isolation between input modes.
7. Desktop and narrow responsive layouts.

## Non-goals

- Rewriting the application or migrating frameworks.
- Implementing Quick Entry.
- Changing poker calculations, strategic semantics, or API contracts.
- Removing detailed analysis, fallback output, or diagnostics.
- Replacing the poker table with the concept mockup’s card-entry layout.
