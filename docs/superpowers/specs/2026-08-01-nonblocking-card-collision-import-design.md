# Nonblocking Card-Collision Import Design

## Goal

Allow screenshot imports to reach the editable review screen even when vision returns duplicate physical cards, without running mathematically invalid analysis.

## Behavior

The server continues to validate card syntax and street structure. Unambiguous CoinPoker heart/diamond collision repair remains enabled and is recorded in normalization notes. Any unresolved Hero/board or board/board collision becomes a structured validation warning instead of an HTTP error.

The browser renders the imported hand, actions, players, and stacks normally. It displays unresolved card warnings prominently and disables imported decision-analysis buttons while the card setup is invalid. Editing Hero, flop, turn, or river cards recomputes validity immediately; once all physical cards are unique and street counts are valid, the warning clears and decision buttons become available.

The core analyzer retains its strict duplicate-card checks. It must never calculate equity, blockers, or ranges from an impossible deck state.

## Debugging

Raw vision output, parsed output, automatic repairs, unresolved validation warnings, and the final returned hand remain recorded in vision-import logs.

## Testing

Server regression tests cover unresolved collisions returning warnings, CoinPoker deterministic repair, and genuine malformed street structures. Browser regression tests cover disabled decision buttons for invalid imports and re-enabling after manual correction.
