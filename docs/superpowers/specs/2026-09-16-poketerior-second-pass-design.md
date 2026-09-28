# PokeTerior UI Refactor — Second-Pass Design

## Objective

Rebuild the PokeTerior presentation as a dense AI poker inference dashboard that closely matches the approved visual companion mockup. Preserve poker state, calculations, imported-hand conversion, API behavior, solver integration, and analysis logic while replacing the current fragmented layout.

The desktop priority is a 1440–1600px viewport. At 1600×900, the header, input selector, full table, hand progress, decision rail, timeline, analysis tabs, and upper analysis cards must appear without scrolling.

## Approved Visual Direction

The approved mockup uses:

- a compact 58px product header with restrained navigation and New Hand CTA;
- a 46–52px three-way input-mode selector;
- a strict `170px minmax(0, 1fr) 360px` hand-stage grid;
- a 330–390px combined center workspace, with a wide poker table and compact timeline;
- a populated, information-dense decision rail;
- analysis tabs followed immediately by a three-column analytics dashboard;
- near-black green surfaces, subtle borders, and emerald-only state emphasis.

The design is an analytical visualization, not a casino client. Typography, shadows, and glow remain restrained.

## Design Tokens

The stylesheet will establish a single semantic token layer:

- `--bg: #07110e`
- `--surface: rgba(11, 26, 22, .88)`
- `--surface-raised: rgba(14, 31, 26, .92)`
- `--border: rgba(87, 145, 119, .22)`
- `--text: #f3f6f4`
- `--text-secondary: #9daaa5`
- `--muted: #65736d`
- `--accent: #28e69a`
- `--accent-soft`: translucent emerald derived from the accent
- `--danger`: accessible muted red
- radius and 4/8px spacing tokens

Mustard, gold, tan, and yellow state styling will be removed. Emerald glow is limited to active mode, active street, current decision, recommended action, and primary CTA.

## Unified Page Composition

### Header and mode selector

The header contains the compact PokeTerior wordmark, primary navigation, user/search affordances, and New Hand. The existing custom wordmark retains the spade as the dot of the lowercase `i`.

The mode selector remains immediately beneath the header. Screenshot Import, Quick Entry, and Manual Builder use equal-width segments and preserve their existing mode-switch behavior.

### Hand stage

Manual preflop, manual postflop, and imported-hand views will render into a coherent hand-stage composition with three regions:

1. **Hand Progress** — a 170px rail with Pre-flop, Flop, Turn, River, and Results. Completed, current, and pending states include text and shape indicators rather than color alone.
2. **Table and timeline** — a wide 330–390px table area with compact seats around the perimeter, centered board/pot, hero outline, and current-actor indicator. A 90–120px horizontally flowing timeline sits directly beneath it.
3. **Your Decision** — a 360px rail containing node context, legal actions, recommendation, confidence, range assumptions, and the primary Analyze Street action. Empty vertical filler is prohibited.

The existing mode-specific models remain unchanged. View renderers adapt their state into this shared composition.

### Timeline

The timeline presents chronological actions as compact horizontal nodes. Street changes become small emerald separators. The active or selected decision receives an emerald border and explicit current-state label.

Imported actions remain selectable and editable. The large per-street stacked timeline is replaced by the same compact timeline language used by manual mode.

## Imported Decision Analysis

Every valid imported decision point remains selectable. Selecting a point will:

1. update the selected decision in `HandSessionModel`;
2. prepare the historical state immediately before or after the recorded action according to existing import decision semantics;
3. populate the table, progress rail, timeline, legal actions, and context in the shared hand-stage shell;
4. load an existing cached analysis if one is already available;
5. otherwise wait for an explicit **Analyze Street** action rather than silently launching foreground analysis.

Analyze Street calls the same central `analyze()` pipeline used by Manual Builder. Validation failures stay near the decision control with a clear recovery instruction. Unsafe action attribution continues to disable analysis.

Background preparation may retain non-visible computation only where it does not contradict the explicit launch interaction. The UI must never imply that analysis ran when it only loaded a decision node.

## Analysis Dashboard

The shared analysis surface begins immediately below the hand stage:

- tabs: Ranges, Equity, AI Analysis, Breakdown;
- columns: `1.05fr .95fr 1.15fr`;
- left: estimated range and 13×13 matrix;
- middle: board texture and range evolution;
- right: AI recommendation, equity, price/EV, fold/value/bluff measures, and confidence.

Range Evolution explains the brand concept with Prior → After Preflop Action → Street Posterior. Developer diagnostics remain collapsed under Developer Details. Harrington and skill-grounded analysis remain accessible through progressive disclosure.

## Responsive Behavior

At widths below approximately 1050px:

- Hand Progress becomes horizontal;
- the decision rail moves below the table/timeline;
- analytics cards stack;
- all core controls remain at least 44px high;
- no horizontal page overflow is permitted.

Desktop hackathon presentation remains the primary optimization target.

## Implementation Boundaries

Functionality that remains intact:

- preflop and postflop builder models;
- card, stack, player, board, pot, and street state;
- screenshot extraction and import normalization;
- imported action editing and attribution validation;
- historical decision snapshots and analysis cache;
- range/equity calculations and LLM range interpretation;
- TexasSolver and provider integrations;
- diagnostic data and disclosure behavior.

Primary presentation changes belong in `public/index.html`, `public/styles.css`, `public/preflopBuilderView.js`, `public/postflopBuilderView.js`, and `public/handWorkspaceView.js`. `public/app.js` changes are limited to adapting imported decision selection to explicit analysis launch and wiring the shared presentation state.

## Error and Loading States

- Screenshot extraction retains elapsed progress and bounded provider failover.
- Analysis buttons expose loading and disabled states without layout shift.
- Errors identify the failed action and the next recovery step.
- Empty states are compact and actionable, never large blank panels.
- Dynamic status text uses existing live-region semantics.

## Verification

Automated coverage will protect:

- shared layout landmarks and responsive structure;
- compact table/timeline sizing contracts;
- imported decision selection without automatic foreground analysis;
- explicit Analyze Street launching the correct imported node;
- preservation of manual analysis wiring;
- existing poker, import, solver, and provider regressions.

Manual visual verification will render the live application near 1600×900 and below 1050px. It must confirm no clipped seats, overlaps, floating controls, oversized empty areas, gold styling, or analysis content pushed unnecessarily below the first viewport.
