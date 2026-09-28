# Active Opponent Resolution Design

## Problem

Imported Hero-action reviews currently derive `primaryVillainPosition` only from actions already present on the target street. When Hero acts first postflop, no opponent has acted on that street yet, so the value becomes `null` even when the complete hand history identifies one or more active opponents. Validation then incorrectly rejects an otherwise valid poker spot.

In the reported hand, Hero `dingsanpro` is SB and `GordonCole` is CO. Every other player folded preflop. Hero's first flop check therefore has one known active opponent, CO, but the current-street-only lookup reports no villain.

## Required Behavior

- Determine active postflop players from the complete chronological hand history, not only the current street.
- Begin with seated players and eliminate players after their fold action.
- Preserve all non-folded opponents so genuine multiway pots remain multiway.
- For an imported Hero-action review, resolve the primary villain in this order:
  1. the most recent active opponent aggressor before the target action;
  2. the sole remaining active opponent;
  3. in a multiway pot, the most recent preflop aggressor who remains active;
  4. otherwise a deterministic active opponent, while retaining the full active-opponent list in context.
- For an imported opponent action, the target actor remains the primary villain when that actor is active and has a supported position.
- Do not invent opponent actions. Resolution supplies analysis context only.
- Reject a node only when no active opponent with a supported position can be resolved.

## Data Model

Extend imported decision context with:

- `activeOpponents`: ordered objects containing `name`, normalized `position`, and display position;
- `primaryVillainName`;
- existing `primaryVillainPosition`, derived using the rules above.

The current analyzer may continue using the primary villain position, while prompts/debug data can distinguish it from the complete active-opponent set.

## Validation

Hero-action reviews require at least one resolvable active opponent, not a prior same-street opponent action. Opponent-action nodes still require the clicked target to resolve to a distinct supported position. Hero and primary villain positions must remain different.

## Testing

- Reproduce the reported hand: all other players fold preflop, Hero SB checks first on the flop, and CO resolves as the sole active villain.
- Confirm the later CO flop check remains a valid opponent-action node.
- Cover a genuine multiway flop where Hero acts first and `activeOpponents` contains every non-folded opponent.
- Confirm folded players never appear as active opponents.
- Confirm a hand with no resolvable opponent position still fails validation.

## Scope

This change fixes imported decision-context opponent resolution. It does not change vision extraction, card validation, action ordering, or general strategy calculations.
