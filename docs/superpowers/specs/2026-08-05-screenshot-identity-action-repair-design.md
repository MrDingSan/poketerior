# Screenshot Identity and Action Repair Design

## Problem

Screenshot import can accept structurally valid JSON whose poker identities and actions are internally impossible. In the reported hand, Gemini exhausted its quota and `openrouter/free` returned `site: Unknown`, selected the right-side showdown player as the bottom-seat hero, omitted the actual bottom player, and assigned both a flop bet and its matching call to the same actor. Because focused hero verification currently requires a recognized CoinPoker or Natural8 site and card validation does not inspect actions, the UI presented every extracted action as a Hero review point.

## Required Behavior

- A missing or incorrect site label must not prevent bottom-seat verification when the screenshot/extraction otherwise uses the supported bottom-seat hand-history format.
- Imported actions must be checked for identity and sequence contradictions before decision points are built.
- A targeted repair pass should re-read bottom-seat identity/cards, player positions, and chronological action rows when the broad extraction is suspicious.
- Repaired data must pass the same identity/action checks before it is trusted.
- If repair is unavailable or remains inconsistent, the import should remain visible and editable, but inconsistent decision points must be suppressed and a clear warning shown. The import must not be rejected solely for this condition.
- Raw broad output, targeted repair output, repair decision, warnings, and final hand must be retained in the vision debug record.

## Detection

Create a pure action-consistency validator. It reports suspicious extraction when any of these occur:

- the same actor performs both the initiating aggressive action and its matching response on one street, such as `bet 8.7` followed by `call 8.7`;
- every postflop decision is assigned to one actor despite response actions requiring another participant;
- an action actor conflicts with the known position for the same named player;
- a non-decision row such as `return` survives normalization;
- the declared hero cannot be reconciled with the bottom-seat verification result or player list.

Warnings are structured so the server and UI can distinguish unsafe decision attribution from ordinary non-blocking card warnings.

## Repair Flow

1. Perform the existing broad screenshot extraction.
2. Normalize board/card tokens without discarding the raw result.
3. Run bottom-seat verification for recognized sites and also for supported tall hand-history screenshots when the site is unknown or identity checks are suspicious.
4. If identity/action checks fail, run a targeted structured extraction over the screenshot. Its prompt focuses only on player names/positions, bottom-seat identity/cards, and chronological decision actions; it explicitly excludes return/refund rows.
5. Merge targeted identity/action fields into the broad hand while preserving reliable metadata and board cards.
6. Revalidate the merged hand.
7. If valid, build normal Hero and Villain decision points. If still unsafe, return the editable hand with an unsafe-attribution warning and no decision points derived from the inconsistent actions.

The repair pass must use configured provider failover. A provider or quota failure is non-fatal and leads to the safe fallback.

## UI Behavior

The importer displays a prominent warning when decision attribution is unsafe. Cards, board, players, and other editable fields remain available. The decision-point section explains that action analysis is disabled until the screenshot is re-imported or the extraction is repaired; it must not render false `Review Hero Action` buttons.

## Debugging Data

Extend the existing per-import vision record with the targeted action-repair raw output, parsed output, provider/model, detected consistency issues, repair acceptance decision, and final unsafe-attribution status. Existing broad and focused-hero fields remain unchanged.

## Testing

- Unit tests reproduce the reported `xoixo68` corruption and prove it is classified unsafe.
- Unit tests prove normal repeated actions by one player on different streets remain valid.
- Pipeline tests prove unknown-site imports trigger focused verification when identity/action anomalies exist.
- Repair tests prove valid targeted output replaces corrupted actors and removes `return` rows.
- Failure tests prove unavailable/invalid repair preserves an editable import but suppresses decision points.
- UI tests prove unsafe attribution never renders actions as Hero review points.
- Vision logging tests cover all new repair/debug fields.

## Scope

This change repairs and gates screenshot-import identity/action attribution. It does not redesign manual hand entry, change poker strategy analysis, or guarantee recovery from an unreadable screenshot.
