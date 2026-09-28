# Unified Manual and Screenshot Builder Design

## Goal

Give Screenshot Import the same visual hand-building and analysis experience as Manual Builder while keeping the two modes completely independent. Screenshot Import builds a complete editable decision path from an uploaded hand-history screenshot; Manual Builder continues to build a different hand action by action.

The two modes share layout, interaction patterns, and reusable view components. They do not share hand state, selected decision points, analysis content, loading state, errors, or cached results.

## Product Model

The input tabs remain Screenshot Import, Quick Entry, and Manual Builder. Quick Entry remains unavailable. Manual Builder keeps its current behavior and hand. Screenshot Import replaces its detached metadata-and-row-list result with a builder-shaped workspace.

Each active hand is a session:

```text
manualSession
  source: manual
  handState
  selectedDecision
  analysisState

importSession
  source: screenshot
  sourceScreenshot
  extractionMetadata
  handState
  selectedDecision
  analysisState
```

The identical field names express a common rendering contract, not shared state. Switching modes restores that mode's session without copying values or analysis results from the other session.

## Screen Structure

### Manual Builder

Manual Builder retains the current visual table, contextual action controls, card pickers, street navigation, editable timeline, and analysis panels. This project may extract reusable view components from it, but it must not intentionally change its behavior.

### Screenshot Import

Screenshot Import uses the same page structure and visual language as Manual Builder. A compact import panel appears above the hand workspace and contains:

- Paste, drop, and file-upload entry points.
- Extraction progress and failure status.
- A collapsible preview of the source screenshot.
- Site, hand identifier, provider, and confidence metadata when available.
- A clear action to import a different screenshot.

Before the first successful extraction, the table workspace shows an empty state explaining that an upload will populate the complete hand. During a new extraction, the previous successful imported session remains intact until the replacement extraction succeeds. A failed replacement therefore does not destroy the existing imported hand.

After extraction, Screenshot Import displays:

- The imported table, players, positions, stacks, folded/all-in states, and Hero identity.
- Hero cards and all extracted community cards.
- A street navigator for every extracted street.
- A street-grouped timeline containing the complete imported action history.
- The same contextual card and action editing controls used by Manual Builder.
- The same metrics, recommendation, calculation, Harrington, and PokerSkill analysis surfaces used by Manual Builder, populated only with results for the imported hand.

The old `Hero Decision Points` row list and its `Analyze Point`/`Review Point` buttons are removed after equivalent decision selection and analysis are available in the new timeline.

## Decision Selection and Analysis

Every meaningful imported action is selectable from the timeline. Selecting an action creates an analysis snapshot representing the hand immediately before that recorded action. The selected row is highlighted and the recorded action is shown as the choice under review.

Examples:

- Selecting `SB call 5 bb` analyzes SB's available decision immediately before the call.
- Selecting `MP bet 8.2 bb` analyzes MP's available decision immediately before the bet.

Analysis is not limited to Hero actions. When an opponent action is selected, that actor becomes the decision owner for the snapshot while the remaining players and prior history provide context. Unsupported or ambiguous actor attribution is reported on that decision point rather than silently assigning the action to Hero.

The complete analysis bundle is scoped to the active session and selected decision:

- Recommendation and recorded-action comparison.
- Equity, pot odds, EV, and confluence metrics where applicable.
- Range and calculation displays.
- Harrington-style analysis.
- PokerSkill analysis.
- Loading, partial, error, and cached states.

Cache identity includes the session source, imported-hand revision, and decision identity. A cached result from Manual Builder can never satisfy a Screenshot Import request, and results from one selected imported action cannot appear for another.

## Import-to-Builder Conversion

A dedicated adapter converts the normalized vision response into builder-compatible state. It maps:

- Player identity and position.
- Starting and remaining stacks where present.
- Hero identity and hole cards.
- Blinds and antes.
- Street-grouped actions with actor, type, amount, and sequence.
- Flop, turn, and river cards in dealt order.
- Folded and all-in state.
- Extraction confidence and validation warnings.

The adapter must preserve the original normalized import as source evidence and produce a separate editable builder representation. Imported values must not be inferred from Manual Builder state.

The existing preflop and postflop models remain responsible for replay, pot and stack arithmetic, actor order, legal actions, street completion, and invalidation. Where imported histories contain supported real-world sequences that the current models cannot replay, model compatibility is extended with tested behavior rather than bypassed with display-only state.

If an import omits a value required for deterministic replay, the adapter marks the relevant field or action unresolved. The interface shows the extracted path as far as it is reliable and asks for correction at the affected location. It does not fabricate a legal value merely to complete replay.

## Editing Imported Hands

Imported cards, Hero identity, player data, and actions use the same editing controls and accessibility behavior as Manual Builder. User changes apply only to `importSession` and are visually marked as corrected values.

Editing an action replays history from the start of its street. Any incompatible later actions, later board cards, later-street histories, and cached analyses are removed. Before applying a change that discards downstream work, the interface shows an inline warning describing the affected streets; it does not use a browser confirmation dialog.

Card corrections enforce uniqueness across Hero cards and the board. Changing Hero identity re-evaluates decision ownership without altering Manual Builder. Corrections increment the imported-hand revision so stale in-flight or cached analyses cannot be displayed.

## State Isolation and Async Safety

`manualSession` and `importSession` are long-lived browser-side objects owned by the application coordinator. Each contains its own hand state, visible street, selected action, edit state, analysis panels, errors, and cache keys.

All asynchronous extraction, prefetch, and foreground-analysis operations carry a session identifier and revision. Completion handlers discard results whose session, revision, or selected decision no longer matches. Switching tabs may allow safe work to finish in the background, but completion must update only the session that originated it.

Reset behavior is mode-specific:

- `New Hand` in Manual Builder resets only the manual hand while retaining its persisted settings.
- `New Import` or a successful replacement upload resets only the imported session.
- Neither action clears or mutates the other session.

## Component Boundaries

Expected implementation responsibilities are:

- `public/handSessionModel.js`: session creation, revisioning, selected-decision identity, analysis-state isolation, and stale-result guards.
- `public/importBuilderAdapter.js`: normalized import to replayable builder state, unresolved-field reporting, warning association, and source-evidence preservation.
- `public/handWorkspaceView.js`: reusable workspace shell and shared table, timeline, street-navigation, card-editing, and action-editing presentation used by both modes.
- `public/preflopBuilderView.js` and `public/postflopBuilderView.js`: retain poker-specific interaction rendering and expose reusable hooks needed by the shared workspace rather than duplicating whole views.
- `public/preflopBuilderModel.js` and `public/postflopBuilderModel.js`: remain the poker-state authorities and gain only compatibility required to replay valid imported histories.
- `public/importDecisionModel.js`: retain decision-attribution and state-before-action logic that remains useful; remove dependencies on the old detached decision list.
- `public/app.js`: coordinate tabs, two sessions, screenshot extraction, analysis dispatch, async ownership, and incremental migration from hidden legacy analyzer fields.
- `public/index.html`: provide same-layout manual and screenshot containers plus the compact import controls.
- `public/styles.css`: style shared workspace components, import confidence/correction states, source preview, and responsive behavior.

Exact extraction may reveal that a smaller shared renderer is safer than one top-level `handWorkspaceView.js`. The invariant is that the two modes reuse component behavior without sharing runtime state or duplicating complete workspace markup and event logic.

## Error and Confidence Handling

- Extraction failure preserves the last successful imported hand and offers retry.
- Low-confidence values remain visible and editable, with warnings attached to their fields or timeline actions.
- Duplicate, incomplete, or invalid cards disable analysis for affected decisions and link the user to the relevant picker.
- Unsafe identity or action attribution disables only decisions that cannot be attributed safely when isolation is possible.
- A history that becomes invalid after correction stops replay at the first invalid action and explains the required correction.
- Analysis failure preserves the imported hand, selected point, and any completed independent analysis panels.
- Late extraction or analysis responses cannot mutate a different mode, revision, or decision.

## Responsive and Accessible Behavior

Both modes follow the existing desktop-first manual layout and its responsive collapse order. The import panel remains compact and moves above the table at every width. The screenshot preview is collapsed by default after successful extraction on small screens.

Selectable timeline actions are buttons with accessible labels describing actor, action, amount, street, and whether they are currently selected. Confidence is never communicated by color alone. Import and analysis progress use polite live regions. Shared dialogs retain focus trapping, Escape dismissal, visible focus, and focus return to their trigger.

## Testing and Acceptance

Automated coverage includes:

- Conversion of representative normalized imports into complete preflop and postflop builder state.
- Exact replay of blinds, antes, pots, stacks, calls, raises, folds, and all-ins.
- Preservation and association of confidence warnings and unresolved values.
- State-before-action snapshots for Hero and opponent decisions on every street.
- Independent manual and imported hand state across repeated tab switches.
- Independent visible street, selected action, edit state, and all analysis content.
- Cache keys containing session source, revision, and decision identity.
- Rejection of stale extraction, prefetch, and foreground-analysis responses.
- Imported edits invalidating only downstream imported history and analysis.
- Failed replacement extraction preserving the last successful imported session.
- Same structural workspace components being used by Manual Builder and Screenshot Import.
- Removal of the detached imported decision-list dependency.
- Continued passage of existing manual-builder, import-validation, attribution, cache, prefetch, request-model, and analysis tests.

Manual browser acceptance covers:

1. Build and analyze a manual hand, switch modes, and confirm it remains unchanged.
2. Upload a screenshot and verify that all extracted streets populate the screenshot workspace.
3. Select Hero and opponent actions across preflop, flop, turn, and river and verify each state-before-action analysis.
4. Confirm that Harrington, PokerSkill, metrics, recommendation, and calculation content belong to the selected imported decision.
5. Correct cards and an early action, verify downstream invalidation, and confirm the manual hand is untouched.
6. Switch repeatedly between both modes and confirm each restores its own hand, selection, and results.
7. Trigger replacement-extraction and analysis failures and confirm usable prior state is preserved.
8. Verify keyboard operation, focus behavior, warning announcements, and mobile layout.

## Migration Strategy

The change is delivered incrementally:

1. Introduce session isolation and prove that current manual and import analyses cannot cross-contaminate.
2. Add and test the import-to-builder adapter without changing the visible import UI.
3. Extract reusable workspace behavior while retaining Manual Builder parity.
4. Render imported hands in the new screenshot workspace and connect timeline decision selection.
5. Add imported-hand correction, invalidation, and confidence states.
6. Route all imported analyses and result panels through the imported session.
7. Remove the old decision-row interface and obsolete hidden-field bridging after parity tests pass.

This sequence keeps each stage testable and avoids a single cutover that simultaneously changes parsing, state ownership, rendering, and analysis.

## Non-goals

- Combining or synchronizing the manual and imported hands.
- Copying an imported hand into Manual Builder.
- Changing backend vision extraction or strategic-analysis semantics except where an explicit decision-owner field is required to analyze opponent actions safely.
- Redesigning the analysis content or visual identity.
- Implementing Quick Entry.
- Side-pot settlement beyond the builder models' existing supported behavior.
- Persisting full hand sessions across browser restarts unless already supported.
