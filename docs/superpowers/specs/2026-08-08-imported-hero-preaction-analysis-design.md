# Imported Hero Pre-Action Analysis Design

## Problem

The importer labels completed Hero rows as “Review Point.” The analysis pipeline currently turns that UI concept into a terminal poker node with `legalActions: ["Review"]`. PokerSkill and the other analysis lenses then receive “Review” as a hard legal action and cannot compare Hero's recorded action against the real alternatives.

In the reported flop, Hero checked before Villain acted. The decision immediately before that check was Check versus Bet. “Review” describes why the user opened the point; it is not a poker action.

## Required Behavior

- Keep “Review Point” and “Review Hero Action” as importer UI labels if desired.
- Treat a click on a completed Hero row as analysis of the decision state immediately before that action.
- Store the completed action separately as `recordedHeroAction` and `recordedHeroAmount`.
- Exclude the recorded Hero action from the action rows used to calculate pot state, outstanding call amount, and action order.
- Never expose `Review` as a legal poker action or recommendation for an imported Hero decision.
- Derive real legal actions from the pre-action state:
  - no outstanding bet: Check, Bet;
  - facing a bet: Fold, Call, Raise;
  - facing an all-in: Fold, Call.
- PokerSkill must recommend among real legal actions and compare the recommendation with `recordedHeroAction`.
- Harrington and the base analysis must use the same corrected shared decision facts to avoid contradictory output.

## Decision Context

For a Hero target, `actionsThroughTarget` contains only actions before the target. The context also contains:

- `targetIsHero: true`;
- `recordedHeroAction`;
- `recordedHeroAmount`;
- active opponents and primary villain from the full-history resolver.

For an opponent target, existing behavior remains: the clicked opponent action is included because Hero's unresolved decision occurs after it.

## Decision Node

A Hero target produces a non-terminal decision node. Its title and description explain that the application is evaluating the decision before Hero's recorded action. `facingBet` and `facingAllIn` come from the preceding action state, not from the recorded Hero response.

The recorded action is evidence for comparison, not a candidate action constraint.

## Prompt and Output Contract

Shared facts sent to the analysis endpoints include the recorded action and real legal actions. PokerSkill is instructed to:

1. recommend one legal poker action;
2. state whether that recommendation agrees with the recorded Hero action;
3. explain the strategic difference when it disagrees.

No prompt or output validator may accept “Review” as a recommendation for this node.

## Testing

- Hero checks first on the flop: prior action rows are empty and legal actions are Check/Bet.
- Hero bets after an opponent checks: prior rows include the opponent check and legal actions are Check/Bet.
- Hero calls a normal bet: prior rows include the bet and legal actions are Fold/Call/Raise.
- Hero calls an all-in: legal actions are Fold/Call.
- Context preserves the recorded Hero action without including it in pot-state rows.
- PokerSkill prompt/facts contain real legal actions plus the recorded action and never constrain the model to Review.
- Existing opponent-action and multiway decision behavior remains unchanged.

## Scope

This change corrects imported completed-Hero decision semantics across shared analysis facts and PokerSkill comparison output. It does not remove the importer’s Review Point UI label or change manual-mode terminal sequence review behavior.
