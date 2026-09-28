# CoinPoker Hero Card Attribution Design

## Problem

CoinPoker screenshot import can confuse exposed opponent cards with the bottom-seat player's cards. A focused verification pass currently cannot repair a wrong rank because it accepts a correction only when both ranks match the broad extraction. The browser then contains a collision-repair heuristic that can change both black suits to diamonds, creating cards that no vision model actually observed.

The regression in analysis `pc_20260804190607_ebb50f2f` demonstrates the complete failure:

- The screenshot shows bottom-seat player `dingsanpro` holding `2d Kh`.
- Opponent `MauroG27129` shows `Js Ks`.
- The broad extraction attributed the opponent's cards to the hero.
- The focused pass remained anchored to those ranks.
- The browser converted the colliding black cards into fabricated diamond cards.

## Goals

- Reliably extract the two cards belonging to the bottom-center CoinPoker seat.
- Allow the focused verification pass to correct both ranks and suits.
- Never invent replacement cards to resolve a collision.
- Preserve uncertain imports so the user can edit them manually.
- Prevent selecting a different player from silently reusing another player's cards.
- Retain raw broad and focused vision output for debugging.

## Non-goals

- Extract every opponent's hidden cards.
- Build a general-purpose computer-vision seat detector for every poker client.
- Automatically resolve every ambiguous or obscured card.
- Change strategic analysis behavior unrelated to imported hand identity.

## Design

### 1. Separate structural extraction from hero-card verification

The broad vision pass remains responsible for the board, players, positions, stacks, and action history. Its `heroHand` result is provisional for supported screenshot sites.

For CoinPoker, a second pass independently inspects the bottom-center seat. Its prompt must not include the broad pass's predicted cards. This avoids anchoring the verifier to an incorrect rank or suit.

Where the image layout permits it, the verifier receives a crop containing the table and bottom-center player, excluding exposed cards at other seats and most of the hand-history panel. The full image may also be retained in debug logs, but the verification decision is based on the focused view.

The focused result has this conceptual shape:

```json
{
  "seat": "bottom-center",
  "playerName": "dingsanpro",
  "heroHand": ["2d", "Kh"],
  "confidence": "high",
  "evidence": "left card is a red 2 with a diamond pip; right card is a red K with a heart pip"
}
```

### 2. Apply focused results using seat evidence, not rank equality

The current same-rank requirement is removed. A focused result may replace both ranks and suits when all of the following hold:

- Exactly two valid, distinct card tokens are returned.
- The result identifies the bottom-center seat.
- The returned player name matches the bottom player found by structural extraction when both names are available.
- Confidence is high, or equivalent explicit visual evidence is present.

If these requirements are not met, the import keeps the provisional cards and adds an uncertainty warning. The import does not fail.

The repair metadata records the original cards, focused cards, seat identity, confidence, and whether the correction was accepted.

### 3. Eliminate fabricated collision repair

Remove the client-side heuristic that maps colliding black hero cards to diamonds. Card collisions remain validation warnings and never trigger guessed substitutions.

The server and browser may normalize card notation, but they must not change a valid rank or suit without an explicit vision result or user edit.

### 4. Bind known cards to a player identity

Imported hole cards carry the player identity from which they were read. The default selected hero for CoinPoker is the verified bottom-center player.

When the user selects another player:

- Reuse the known cards only if they are associated with that same player.
- Otherwise clear the hero-card fields and show that the selected player's cards are unknown.
- Allow the user to enter the selected player's cards manually.

This prevents a player's position and actions from being combined with another player's exposed cards.

### 5. Nonblocking validation and analysis safety

Import succeeds even if vision reports duplicate cards, uncertain cards, or a disagreement between the broad and focused passes. The UI displays actionable warnings and permits manual correction.

Strategic analysis remains unavailable while the currently selected hand contains invalid tokens, duplicate hole cards, or a collision with the community board. Once the user corrects the fields, analysis becomes available without requiring another import.

### 6. Debug records

Every screenshot import records:

- Raw broad-extraction model output.
- Raw focused-verification model output.
- Model names and failures/failovers.
- Normalized broad and focused cards.
- Seat/player attribution evidence.
- Whether the focused correction was accepted and why.
- Final imported cards and validation warnings.

Sensitive image content is handled according to the existing vision-debug storage behavior; this change does not introduce a new retention policy.

## Error handling

- If cropping fails, run the independent focused prompt against the original image and record the crop failure.
- If focused verification fails or returns malformed JSON, preserve the broad result as provisional and warn the user.
- If player names differ only by case or harmless OCR spacing, compare normalized names.
- If the focused player conflicts with the structural bottom player, do not silently overwrite; preserve the provisional result and warn.
- No ambiguity or collision should return HTTP 500 unless the request itself cannot be processed.

## Testing

### Unit tests

- Accept a focused correction when ranks change from `Js Ks` to `2d Kh` and seat evidence is valid.
- Reject malformed, duplicate, low-confidence, or wrong-seat focused results without failing import.
- Confirm no collision repair converts black cards to diamonds.
- Confirm selecting a different player does not reuse cards bound to the original player.
- Confirm name normalization handles case and whitespace without conflating different players.

### Regression test

Model the exact reported failure:

- Broad result: `MauroG27129`, `Js Ks`.
- Focused result: bottom-center `dingsanpro`, `2d Kh`, high confidence.
- Board: `Jc 5c 9c Qh 2s`.
- Expected selected hero: `dingsanpro`.
- Expected hand: `2d Kh`.
- Forbidden result: `Jd Kd`.

### Integration checks

- Screenshot import returns success with warnings for unresolved collisions.
- Corrected card inputs enable analysis without re-import.
- Raw outputs from both vision passes appear in the corresponding debug record.
- Existing supported-site imports continue to load their board and action structure.

## Success criteria

- The reported screenshot imports the bottom player's `2d Kh`, not the opponent's `Js Ks`.
- No code path fabricates `Jd Kd` or other replacement cards based solely on a collision.
- A correct focused pass can replace incorrect ranks from the broad pass.
- Hero selection never combines one player's cards with another player's position or actions.
- Ambiguous imports remain editable and debuggable instead of failing with HTTP 500.
