# Multiway Imported Decision Attribution Design

## Problem

Imported hand analysis correctly labels actions by their real players, but loading a decision converts the action sequence into a heads-up manual analyzer. That analyzer infers Hero and Villain from action order rather than the action row's actor.

In analysis `pc_20260805123754_10c7ac6d`, the imported river was:

- SB checks.
- BB bets 7.35bb.
- Hero UTG+1 has the next decision.

The importer correctly labeled the BB bet as a villain action. After the user clicked Analyze Point, the adapter selected SB as the single villain and loaded `SB check -> BB bet`. The heads-up analyzer then assumed the second actor was Hero and generated `Hero bet after Villain check`, `legalActions: ["Review"]`, and `call: 0`.

UTG+1 also is not a supported value in the manual analyzer's six-max position selector, so assigning it leaves the internal hero position empty and makes the role inference less reliable.

## Goals

- Analyze the selected hero's next unresolved decision after a clicked opponent action.
- Preserve the actual actor of every imported action in multiway pots.
- Use the clicked aggressor as the primary opponent when hero is facing that aggression.
- Support imported UTG+1 positions in the six-max analyzer through an explicit internal mapping.
- Keep existing heads-up imported-hand behavior working.
- Prevent internally contradictory prompts such as a non-hero bet paired with a Hero Review node.

## Non-goals

- Calculate separate equity ranges for every opponent in a multiway pot.
- Redesign the complete manual action-entry UI.
- Change screenshot vision extraction.
- Analyze decisions after the selected hero has already folded.

## Design

### 1. Create an actor-aware imported decision context

The import adapter builds a decision context before populating the manual analyzer. It receives the imported hand, target street, clicked action index, and selected hero name.

The context contains:

```json
{
  "heroName": "dingsanpro",
  "heroPosition": "MP",
  "displayHeroPosition": "UTG+1",
  "targetActor": "GordonCole",
  "targetPosition": "BB",
  "targetIsHero": false,
  "actionsThroughTarget": [
    { "actorName": "dofamin", "actor": "SB", "action": "check", "amount": "" },
    { "actorName": "GordonCole", "actor": "BB", "action": "bet", "amount": 7.35 }
  ],
  "heroHasResponded": false,
  "primaryVillainPosition": "BB"
}
```

Actor identity is retained as `actorName`; normalized position remains available as `actor` for the existing pot and range machinery.

### 2. Normalize imported positions explicitly

For the six-max internal analyzer:

- `UTG+1` maps to `MP`.
- `HJ` continues to map to `MP`.
- Existing `UTG`, `MP`, `CO`, `BTN`, `SB`, and `BB` values remain unchanged.

The original imported position remains available for display and debugging. Position normalization must never produce an empty selector value for a recognized imported six-max position.

### 3. Select the opponent from the clicked decision pressure

When the clicked target is a non-hero bet, raise, or all-in, its actor becomes the primary villain. For a passive clicked action, choose the most recent non-hero aggressor through the target; if no aggressor exists, use the clicked non-hero actor.

Do not choose an earlier checker merely because that action appears immediately before the target. For the reported river, BB—not SB—is the primary villain.

### 4. Derive the node from actor identity

The imported decision context determines the node before analysis:

- If the clicked action belongs to Hero, load it as a review of Hero's completed action.
- If the clicked action belongs to an opponent and Hero has not acted afterward, analyze Hero's next pending decision.
- If the last included action is an opponent bet, raise, or all-in, Hero is facing aggression regardless of whether one or more other opponents checked first.
- If the last included action is an opponent check and action reaches Hero, analyze Hero's check/bet decision.

For the reported river, the authoritative result is:

```json
{
  "decisionNode": "River Node: Hero facing BB bet",
  "facingBet": true,
  "call": 7.35,
  "legalActions": ["Fold", "Call", "Raise"]
}
```

Legal actions remain subject to existing all-in restrictions.

### 5. Keep future actions out of the decision

For an opponent target, include actions through the clicked action and exclude subsequent actions, including Hero's recorded response. Thus the historical Hero fold in the reported hand is not included when analyzing the decision before that fold.

For a Hero target, exclude the target action from the sequence used to calculate the pending state, but mark the node as a review of that completed Hero action through explicit target metadata. This preserves existing Review Point behavior without relying on sequence order.

### 6. Add a consistency guard

Before analysis payload creation, validate these invariants:

- A Review node must have an explicit Hero target.
- An unresolved non-hero aggressive target cannot produce `legalActions: ["Review"]`.
- If the last included action is a non-hero bet/raise/all-in and Hero has not responded, `facingBet` must be true.
- Hero and primary villain positions must both be supported and different.

If an invariant fails, stop analysis and show a clear local error rather than sending contradictory facts to the LLM.

## Components

### `public/importDecisionModel.js`

- Normalize imported positions.
- Build the actor-aware decision context.
- Select the target-pressure opponent.
- Preserve actor names in analysis rows.
- Expose pure functions for regression tests.

### `public/app.js`

- Use the decision context while loading an imported point.
- Set supported internal hero and villain positions.
- Pass explicit imported-target metadata into node derivation.
- Validate node consistency before calculations and LLM requests.

### Tests

- Extend the import decision model tests for multiway actor attribution.
- Add an exact regression for `pc_20260805123754_10c7ac6d`.
- Retain heads-up check/bet and Hero action-review coverage.

## Error handling

- Unknown imported positions produce an actionable import-analysis error rather than an empty position.
- A missing clicked actor or player record prevents analysis and identifies the missing field.
- Contradictory target and node state prevents LLM calls.
- Existing imported cards and action history remain editable and are not discarded.

## Testing

### Exact multiway regression

Given Hero `dingsanpro` at UTG+1 and river actions:

```text
SB check
BB bet 7.35
Hero fold
SB fold
```

Clicking Analyze Point on the BB bet must produce:

- Internal Hero position `MP`, displayed imported position `UTG+1`.
- Primary villain `BB`.
- Included river actions `SB check -> BB bet`.
- Hero has not responded.
- Node `Hero facing BB bet`.
- Call amount 7.35bb.
- Legal actions Fold, Call, and Raise unless stack state restricts them.
- No `Review` action.

### Heads-up regressions

- Villain checks and Hero action is pending: produce Hero check/bet decision.
- Villain bets and Hero action is pending: produce Hero facing-bet decision.
- Clicking an existing Hero bet: preserve Review Point behavior.
- Villain check, Hero bet, Villain raise: preserve Hero facing-raise behavior.

### Consistency regressions

- Reject Review without an explicit Hero target.
- Reject a non-hero aggressive target that produces `facingBet: false`.
- Reject unsupported or identical Hero/Villain positions.

## Success criteria

- Re-analyzing the reported BB river bet never describes it as Hero's bet.
- Every LLM lens receives the same actor-correct decision node and legal actions.
- The raw action history and derived node no longer contradict each other.
- Heads-up imported decisions continue passing their existing tests.
