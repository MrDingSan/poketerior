# Pre-flop Manual Builder Redesign

## Goal

Replace the current dropdown-heavy pre-flop form with a fast, visual hand-building workflow while preserving the existing Poker Coach analysis pipeline and the current post-flop workflow.

The redesigned screen uses the existing dark green, black, and gold identity and follows the supplied desktop references without copying them mechanically. It should feel like a professional analysis terminal: compact, legible, responsive, and focused on the next decision.

## Scope

This phase redesigns the manual pre-flop workflow only. It includes:

- Compact persistent game settings.
- A visual six-seat table.
- Hero seat and card selection.
- A 52-card picker.
- Automatic turn order and legal-action inference.
- Contextual action and sizing controls.
- Automatic pot calculation.
- A compact, editable action timeline.
- Secondary opponent assumptions and a reserved AI/range area.
- Compatibility with the existing pre-flop analysis request.
- Transition into the existing flop workflow.

Screenshot Import remains operational. Quick Entry is visible as a non-primary future mode but does not gain parsing behavior in this phase. The existing flop, turn, and river builders are not redesigned.

## Initial State

The manual builder initially demonstrates:

- 6-max cash.
- 100 bb effective stacks.
- Loose Online opponent profile.
- Hero in the SB with A♥ K♥.
- UTG raises to 2.5 bb.
- SB raises to 9 bb.
- UTG calls.
- Calculated pre-flop pot of 19 bb, including the 0.5 bb small blind and 1 bb big blind.

“New Hand” resets hand-specific data while retaining game settings. The example may be restored as the development/demo default; persisted user settings override only the settings values, not the example action sequence.

## Architecture

### State model

Create a small browser-compatible pre-flop builder model separate from DOM rendering. It owns plain serializable state:

- Game settings: game type, starting stack, global opponent profile.
- Six seats: position, stack, per-seat assumption, folded status, and contribution.
- Hero position and two hole cards.
- Ordered action history.
- Current acting position.
- Derived pot, highest contribution, amount to call, legal actions, and completion status.

The model exposes pure operations for initialization, hero/card changes, adding actions, replacing an action, truncating history, resetting a hand, and converting state into the existing analysis input. Derived values are recalculated from blinds and history rather than stored independently.

This boundary keeps poker sequencing and arithmetic testable without a browser and prevents additional state logic from accumulating in `public/app.js`.

### UI integration

The existing static-borrowed-data problem is avoided by making the model the single source of truth for the redesigned pre-flop surface. DOM event handlers dispatch model operations and then render from the returned state. Existing post-flop controls keep their current data flow.

Before analysis or continuing to the flop, an adapter writes or supplies the normalized values expected by the current analysis code: hero position, hero cards, villain position, pre-flop actions, pot, and amount to call. Existing backend endpoints and strategic analysis logic remain unchanged.

## Interaction Design

### Header and modes

The top bar contains the Poker Coach identity and a prominent New Hand action. Beneath it are Screenshot Import, Quick Entry, and Manual Builder tabs. Manual Builder is active on this screen. Screenshot Import continues to show the existing import workflow. Quick Entry is visibly unavailable and communicates that it is planned rather than behaving like a broken control.

### Game settings

Game Type, Starting Stack, and Opponent Profile appear as compact controls above the table. Settings are persisted locally and survive New Hand. Values are validated before persistence, with 6-Max Cash, 100 bb, and Loose Online as defaults.

### Poker table

The table presents UTG, HJ, CO, BTN, SB, and BB around an oval felt surface. Each seat shows position, stack, and two card backs. Seat buttons are keyboard accessible. Clicking a seat designates Hero and updates the action state consistently. Hero receives a gold outline, star marker, and explicit text so status is not conveyed by color alone.

Hero’s card area shows selected cards or an invitation to choose cards. Clicking it opens the card picker.

### Card picker

The modal presents four suit rows in the order spades, hearts, diamonds, clubs, with ranks A through 2. Hearts and diamonds are red; spades and clubs use dark ink on light cards. Each card has a text-accessible label such as “Ace of hearts.”

Exactly two hero cards may be selected. Selected cards receive a gold visual state and appear in a summary at the top. A card can be deselected before confirmation. Done is disabled until two cards are selected. The modal does not auto-close on the second card because explicit confirmation is more predictable and allows correction. Escape, the close button, and focus management provide accessible dismissal.

The picker accepts a disabled-card set so the same component can later select board cards without collisions. Board-picker integration is deferred to the post-flop redesign.

### Next action

The right-side panel names the inferred actor, using “Hero (SB)” where applicable. It displays only relevant actions:

- Facing no wager: Check or Bet where valid.
- Facing a wager: Fold, Call with the exact amount, and Raise/3-Bet where valid.
- When opening action pre-flop: Fold, Call, or Raise.

Aggressive actions use gold, calls/checks use green, and folds use a neutral surface. Labels and icons accompany color. Selecting an aggressive action reveals common total-bet sizing buttons, a secondary custom-total field, and All-in. Sizing is expressed as the player’s total committed amount for the street.

The first version supports valid common six-max pre-flop sequences, including folds, calls, checks, opens, raises, and all-ins. It is a hand-entry assistant rather than a full betting-rules engine: it validates actor order, positive increments, stack caps, and amount-to-call consistency without attempting side-pot settlement.

### Turn inference

Pre-flop order begins left of the big blind and advances clockwise among active seats. A raise reopens action for remaining active players. A betting round completes when every non-folded, non-all-in player has either matched the highest contribution or checked where no wager exists, and no further response is pending.

The initial example is heads-up in meaningful action but still represents six seated players. To reproduce UTG → SB directly, HJ, CO, BTN, and BB are represented as folded actions in state. The compact timeline may collapse consecutive automatic/non-focus folds to reduce noise while preserving correct sequencing and pot math.

### Timeline and editing

The bottom timeline shows numbered action chips, arrows, and the derived pot. The current pending action is highlighted. Each completed action is a button.

Clicking an action enters edit mode at that point. The state is replayed through the selected action, then any incompatible later actions are removed. The user confirms a replacement through the same contextual controls. This rewind-and-replay model avoids silently retaining an illegal future sequence.

### Opponent assumptions and AI area

Opponent Assumptions is secondary and collapsible. Each non-Hero seat inherits the global profile and can be overridden with Tight, Standard, Loose, or Custom. Custom is recorded as a distinct assumption in this phase; detailed custom-range editing is deferred.

A compact Range / AI Intelligence panel reserves space for future prior → context-adjusted → posterior range output. In this phase it shows a restrained informational summary derived from the selected profile and does not make new model requests.

### Analysis and post-flop transition

Analyze Pre-flop is enabled only when Hero, two unique hero cards, and a valid completed or actionable pre-flop state exist. It invokes the existing analysis path through the compatibility adapter.

Continue to Flop remains available according to current progression rules and opens the existing flop interface. Hero cards and pre-flop history are carried forward in the formats existing post-flop logic expects.

## Pot Calculation

The pre-flop pot starts with blinds of 0.5 bb and 1 bb. Every action records a total target contribution, while the pot adds only the incremental difference between that target and the actor’s existing contribution.

For the example:

- Blinds: 1.5 bb.
- UTG raise to 2.5 bb: +2.5 bb.
- SB raise from 0.5 bb to 9 bb: +8.5 bb.
- UTG call from 2.5 bb to 9 bb: +6.5 bb.
- BB folds, leaving its posted 1 bb in the pot.
- Total: 19 bb.

Amounts use integer half-bb units internally where practical to avoid floating-point display errors, and are formatted as bb at the UI boundary.

## Responsive Layout

Desktop uses a two-column analysis-terminal layout: settings and table on the left, contextual controls on the right, with the timeline spanning the primary workspace. At narrower desktop/tablet widths, the action panel moves below the table. On mobile, the order is settings, table, next action, timeline, analysis CTA, then collapsed secondary panels.

The table may scale proportionally but seat controls retain at least 44 px targets. The card picker becomes a full-width sheet with horizontally compact cards and no page-level horizontal scrolling. Secondary content collapses before primary controls are compressed.

## Visual System and Accessibility

The implementation extends existing CSS variables into semantic surface, border, accent, success, danger, and focus tokens. It uses restrained shadows, consistent radii, tabular numbers for chip amounts, and one icon language using lightweight inline SVG rather than emoji or a new icon dependency.

Interactive elements receive visible hover, pressed, disabled, and `:focus-visible` states. Buttons carry accessible names, dialogs expose correct roles and labels, focus returns to the card trigger after dismissal, and status changes use a polite live region where useful. Motion is limited to short opacity/transform transitions and respects reduced-motion preferences.

## Files and Responsibilities

Expected implementation boundaries:

- `public/preflopBuilderModel.js`: pure state transitions, sequencing, validation, pot derivation, and analysis adapter.
- `public/preflopBuilderView.js`: DOM rendering and interaction wiring for table, controls, timeline, and modal.
- `public/index.html`: semantic shell and redesigned pre-flop markup.
- `public/styles.css`: responsive visual system and component states.
- `public/app.js`: mode integration, analysis invocation, post-flop handoff, and removal of superseded pre-flop form wiring.
- `tests/preflopBuilderModel.test.cjs`: state and rules tests.
- `tests/preflopBuilderWiring.test.cjs`: static integration/compatibility assertions where browser automation is unavailable.

Exact splits may change if inspection during implementation reveals a clearer existing boundary, but the pure model must remain independent of DOM rendering.

## Error Handling

- Prevent duplicate cards and explain the conflict in the picker.
- Disable actions whose totals exceed the actor’s stack or fail minimum progression rules.
- Reject invalid custom sizing with an inline cause-and-recovery message.
- Disable analysis when required data is missing or state replay detects an invalid sequence.
- Preserve user selections when a recoverable validation error occurs.
- If analysis fails, retain the complete hand state and use the existing analysis error presentation.

## Testing and Verification

Implementation follows test-driven development for the model and adapters. Automated coverage includes:

- Blind initialization and 19 bb example-pot calculation.
- Six-max pre-flop actor order and skipping folded/all-in players.
- Legal actions when unopened, facing a bet, and facing a raise.
- Raise sizing, stack caps, calls, folds, and round completion.
- Hero reassignment and card uniqueness.
- Timeline rewind/replacement and invalid-future truncation.
- New Hand retaining persisted settings while resetting hand state.
- Conversion to the existing analysis payload.
- Presence of required controls, accessibility hooks, and script integration.

Verification also includes the existing test suite and syntax checks, followed by a manual browser walkthrough covering New Hand, Hero selection, card selection, the example sequence, action editing, responsive layout, Analyze Pre-flop, and Continue to Flop.

## Non-goals

- Quick Entry natural-language parsing.
- Redesigning flop, turn, river, or analysis results.
- Side pots or multi-stack all-in settlement.
- A full GTO range matrix implementation.
- Detailed Custom opponent-range editing.
- New UI frameworks or third-party dependencies.
