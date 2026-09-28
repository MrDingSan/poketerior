# Post-flop Manual Builder Design

## Goal

Extend the visual manual hand builder from a completed pre-flop state through Flop, Turn, River, and Results. The experience should resemble a professional poker study terminal: the table remains the primary interaction surface, controls are contextual, and every action updates visible chips, stacks, pot, history, and analysis context.

All changes in this project phase are frontend-only. Existing backend routes, request formats, provider selection, range interpretation, equity calculation, and AI analysis behavior remain unchanged.

## Scope

This phase includes:

- A local post-flop hand-state engine initialized from the existing pre-flop builder.
- Flop, turn, river, and results progression.
- Community-card entry using the existing visual card-picker language.
- Context-aware post-flop actions and pot-relative sizing.
- Pot, stack, actor-order, folded-player, and all-in tracking.
- Street-grouped action history with rewind-and-edit behavior.
- A vertical street navigator.
- Frontend range, board-texture, range-evolution, and equity presentation components.
- Compatibility adapters for the existing analysis requests.
- A complete desktop-first layout with responsive fallback behavior.

Screenshot Import and Quick Entry remain operational and visually unchanged. The current pre-flop analysis flow and backend contracts must not regress.

## Reference Hand

The initial demo and acceptance flow uses:

- Six-max cash, 100 bb starting stacks.
- Hero in the SB with A♥ K♥.
- UTG raises to 2.5 bb.
- SB raises to 9 bb.
- UTG calls.
- The pot entering the flop is 19 bb.
- The flop is Q♥ 7♠ 4♥.
- Hero is first to act with Check and Bet available.
- Hero's remaining stack is 91 bb and SPR is approximately 4.8.

The interface must derive these values from state. They are example inputs, not hardcoded product assumptions.

## Architecture

### Frontend-only boundary

The implementation adds browser-side model and view modules. It does not change server endpoints or LLM/provider code. When analysis is requested, a compatibility adapter translates the structured hand state into the request shape already consumed by `public/app.js` and the existing APIs.

The post-flop builder must continue operating if an analysis request fails. API errors affect analysis panels only and never discard or corrupt hand-entry state.

### State ownership

The current pre-flop model remains the authority for pre-flop entry. A new post-flop model receives a settled snapshot containing:

- Settings and blinds.
- Hero position and ordered hero cards.
- Seat status and remaining stacks.
- Folded and all-in players.
- The pre-flop pot and action history.
- Opponent assumptions.
- Existing range or analysis results when available.

The post-flop model owns serializable state for:

```text
board: { flop: Card[0..3], turn: Card|null, river: Card|null }
street: flop | turn | river | results
players: per-seat stack, folded, all-in, street contribution
pot
currentActor
streetActions
completeActionHistory
opponentProfiles
rangesByStreet
analysisByStreet
```

Post-flop chip values use integer tenths of a big blind. This supports exact display and accounting for values such as 4.8 bb and 6.3 bb without floating-point drift. The adapter converts the existing pre-flop model's half-bb units into tenths when post-flop begins.

Derived values—including current actor, amount to call, effective stack, SPR, legal actions, pot, and completion status—are recalculated from the street's starting snapshot and ordered actions rather than independently mutated.

### Action records

Each post-flop action records enough information for deterministic replay and analysis translation:

```text
street
sequence
actor
type: check | bet | fold | call | raise | allin
incrementAmount
targetStreetContribution
potBefore
potAfter
stackBefore
stackAfter
automatic: boolean
```

Action history is append-only during normal entry. Editing rewinds to the selected action, replaces it through the same legal-action controls, and removes downstream actions and later streets that no longer follow from the new state.

## Betting Rules

### Actor order

Post-flop action starts with the first active seat clockwise from the dealer button. Folded and all-in players are skipped. Heads-up ordering is derived from the same seat traversal rather than handled as a visual special case.

### Legal actions

- With no outstanding wager: Check and Bet.
- Facing a wager: Fold, Call, and Raise when stacks permit.
- Facing an all-in with no legal raise remaining: Fold and Call.
- A player whose stack reaches zero becomes all-in and is skipped on later decisions.

A street completes when all non-folded, non-all-in players have responded and either matched the highest street contribution or checked through. If only one player remains, the hand proceeds directly to Results without requiring unused community cards.

Side-pot settlement is outside this phase. The UI may represent multiple all-in players, but it will not calculate independent side pots.

### Sizing

Bet and raise selection first reveals preset sizing choices based on the current pot:

- One-quarter pot.
- One-third pot.
- One-half pot.
- Two-thirds pot.
- Full pot.
- Custom amount.
- All-in.

Each preset shows both the fraction and rounded bb amount. Calculations round to the nearest 0.1 bb and never exceed the actor's remaining stack. Raise controls distinguish the additional amount from the target street contribution. Invalid custom amounts produce an inline explanation while preserving the current state.

## Street Progression

### Street navigator

A vertical navigator beside the table displays Pre-flop, Flop, Turn, River, and Results.

- Completed streets use a checkmark.
- The current street uses a gold active marker.
- Future streets remain muted and cannot be entered early.
- Completed streets can be opened for review or editing.

Editing pre-flop returns control to the existing pre-flop builder and invalidates every post-flop card, action, and analysis snapshot. Editing the flop invalidates turn and river. Editing the turn invalidates river. The UI warns through clear downstream-reset copy before applying an edit that discards later work; no browser confirmation dialog is required.

### Board entry

The felt displays five board slots. On the flop, the first three slots are active and the turn/river slots are muted. The board picker:

- Requires exactly three cards for the flop and one card for each later street.
- Uses the same suit/rank presentation as the hero picker.
- Disables hero cards and cards already present on the board.
- Preserves descending rank display only where poker convention calls for ordered hole-card notation; community cards remain in dealt order.

After a street's board card(s) are confirmed, the model starts that street's betting round. When betting closes, the next-street button becomes available. Continuing enables the next board slot and opens its picker. State, pot, stacks, actions, assumptions, and prior analysis snapshots persist.

After river betting closes, the primary action becomes Analyze Full Hand and activates Results.

## Interface Design

### Page structure

The page retains the current Poker Coach header, input-mode controls, compact game settings, dark green/black surfaces, premium gold accent, and restrained professional styling. The manual builder becomes a desktop analysis workspace with:

1. Street navigator on the left.
2. Poker table in the center.
3. Contextual action and assumptions rail on the right.
4. Street-grouped timeline beneath the table.
5. Analysis workspace beneath the main builder.

The table and timeline must remain contained within their grid column and never overlap the right rail.

### Poker table

The six seats retain the current positioning and hero treatment. Each seat shows position, remaining stack, hole cards or card backs, folded/all-in state, and dealer button when applicable. Current street commitments appear as chips physically placed on the felt between the seat and center pot.

The center of the felt contains the board and live pot. Hero hole cards remain highest rank first. Community cards remain in chronological deal order.

### Next Action panel

The right rail identifies the street, actor, pot, effective stack, amount to call when relevant, and SPR. It renders only legal action buttons and reveals sizing controls after Bet or Raise is selected. Neutral actions use dark surfaces, Call uses restrained green, and Bet/Raise use gold.

Opponent Assumptions remains collapsible and secondary. A global Tight, Standard, or Loose preset can update all opponents, while individual overrides remain optional.

### Timeline

The timeline visually groups actions under Pre-flop, Flop, Turn, and River. Completed actions remain bright and editable, the pending actor is highlighted in gold, and future streets show muted placeholders. It scrolls internally on constrained widths and never determines the width of the table column.

## Analysis Workspace

The analysis area provides tabs for Ranges, Equity, AI Analysis, and Breakdown. Ranges is the default initial tab.

### Range matrix

A reusable 13×13 matrix accepts normalized hand-class values from zero to one and optional action-frequency colors. It can display hero or villain ranges without embedding range-generation logic in the component. Red represents aggressive frequency, blue represents call frequency, and dark/grey represents fold, unavailable, or zero weight.

If no real range data is available, the matrix displays an explicit unavailable/awaiting-analysis state. The UI must not invent percentages, frequencies, or combo counts.

### Villain range and evolution

The villain panel consumes the existing pre-flop range result when available. Range snapshots are stored by street with optional metadata:

```text
range weights
percentage
combo count
confidence
reasoning summary
key additions, removals, or discounts
source/provider metadata
```

The Range Evolution component presents prior-to-current snapshots and can later display additional action-level posterior updates. It remains a presentation component; existing backend responses are adapted to its input without changing backend behavior.

### Board texture and equity

Board Texture shows concise deterministic descriptors when safely derivable, such as suit count, pairedness, and broad connectivity. Existing AI text can enrich the panel when returned. Unsupported strategic claims remain absent rather than inferred from visual rules alone.

The Equity panel uses existing calculation output. It displays hero/villain percentages, progress bars, and a details action. Without a valid calculation it shows a clean placeholder.

### AI analysis

The UI can display the existing reasoning chain as baseline range → observed action and size → board context → opponent profile → updated range. It accepts confidence, reasoning, key range changes, likely value hands, likely bluffs, and discounted hands when the backend supplies them. No new LLM request type or provider behavior is introduced in this phase.

## Components and Files

The existing project uses browser globals rather than a component framework. Reusable components therefore remain small rendering/model modules rather than introducing React or another dependency.

Expected responsibilities:

- `public/postflopBuilderModel.js`: pure hand-state initialization, replay, legal actions, betting arithmetic, street completion, board validation, rewind behavior, and analysis adapter.
- `public/postflopBuilderView.js`: composition and event wiring for street navigation, board picker, contextual actions, sizing, table updates, and timeline.
- `public/rangeMatrixView.js`: reusable 13×13 range rendering.
- `public/postflopAnalysisView.js`: range evolution, board texture, equity, and analysis tabs.
- `public/preflopBuilderView.js`: narrow handoff integration only.
- `public/app.js`: mode orchestration and calls into existing analysis functions.
- `public/index.html`: semantic shells for the post-flop workspace.
- `public/styles.css`: desktop and responsive layouts and component states.
- New focused tests for model behavior, adapters, rendering contracts, and the complete flow.

Exact file splits may change if implementation inspection reveals a clearer boundary, but model logic must remain independent from DOM rendering and backend code must remain unchanged.

## Responsive Behavior

Desktop uses the full three-zone workspace. At narrower laptop widths, the street navigator becomes a horizontal progress row and the right rail moves below the table. Analysis panels stack as needed. The poker table retains a readable minimum size and uses an internal horizontal viewport rather than shrinking cards and seats below usable dimensions.

The interface must avoid page-level horizontal scrolling. Interactive targets remain at least 44 px, focus states are visible, statuses are not conveyed by color alone, and reduced-motion preferences are respected.

## Error Handling

- Prevent duplicate hero/board cards before committing picker changes.
- Reject actions with invalid order, insufficient stack, invalid call totals, or illegal raise sizes.
- Preserve valid hand state after a rejected action or failed analysis request.
- Explain custom-size errors inline and retain the entered value for correction.
- Disable future street navigation until board and betting requirements are satisfied.
- Detect invalid imported/pre-flop handoffs and return the user to the relevant editable state with an actionable message.
- Clear downstream state deterministically after an earlier-street edit.

## Testing and Acceptance

Implementation follows test-driven development. Automated tests cover:

- Conversion from the existing completed pre-flop state.
- Tenths-of-bb arithmetic and preset rounding.
- Post-flop actor order and folded/all-in skipping.
- Check-through, bet/call, bet/fold, raise/call, and all-in paths.
- Pot and stack values before and after every action.
- Flop, turn, river, and results transitions.
- Board-card counts and duplicate-card prevention.
- Editing and downstream invalidation.
- Analysis payload compatibility without backend modifications.
- Range-matrix weighted rendering contracts and unavailable states.
- Responsive containment and accessibility hooks.

Manual acceptance follows this sequence:

1. Start a new six-max 100 bb hand.
2. Select Hero SB and A♥ K♥.
3. Enter UTG raise to 2.5 bb, SB raise to 9 bb, and UTG call.
4. Confirm the 19 bb pot and 91 bb hero stack.
5. Continue to flop and select Q♥ 7♠ 4♥.
6. Confirm Hero receives Check and Bet controls with correct preset sizes.
7. Enter a bet, confirm automatic actor advancement, and complete flop action.
8. Continue to turn, select one valid card, and complete turn action.
9. Continue to river, select one valid card, and complete river action.
10. Reach Results and invoke existing full-hand analysis behavior.

The walkthrough also verifies live chips, stack/pot continuity, timeline editing, disabled duplicate cards, range/equity placeholders, successful existing analysis calls, and no regression in Screenshot Import or pre-flop analysis.

## Non-goals

- Backend endpoint or provider changes.
- New LLM prompts or inference logic.
- New solver functionality or fabricated GTO frequencies.
- Side-pot calculation.
- Custom range editing.
- Quick Entry implementation.
- A new frontend framework or large dependency.
- Mobile-first optimization.
