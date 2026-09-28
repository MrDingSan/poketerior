const AGGRESSIVE_ACTIONS = new Set(["bet", "raise", "allin"]);
const RESPONSE_ACTIONS = new Set(["call", "fold", "raise", "allin"]);
const FORCED_BET_ACTIONS = new Set(["blind", "ante", "smallblind", "bigblind"]);
const NON_DECISION_ACTIONS = new Set(["return", "refund", "uncalled", "uncalledreturn"]);

function identity(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function actionName(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function normalizedPosition(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

const PREFLOP_SEAT_RANK = { UTG: 0, MP: 1, HJ: 1, CO: 2, BTN: 3, SB: 4, BB: 5 };

export function stripNonDecisionActions(hand = {}) {
  const streets = {};
  for (const [street, data] of Object.entries(hand.streets || {})) {
    streets[street] = {
      ...data,
      actions: (data?.actions || []).filter((action) => !NON_DECISION_ACTIONS.has(actionName(action?.action))),
    };
  }
  return { ...hand, streets };
}

export function validateImportedActionConsistency(hand = {}) {
  const issues = [];
  const playerPositions = new Map((hand.players || [])
    .filter((player) => identity(player?.name))
    .map((player) => [identity(player.name), normalizedPosition(player.position)]));
  const postflopActors = new Set();
  let requiresDistinctActors = false;

  for (const [street, data] of Object.entries(hand.streets || {})) {
    const actions = data?.actions || [];
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index] || {};
      const actor = identity(action.actor);
      if (street !== "preflop" && actor) postflopActors.add(actor);

      const knownPosition = playerPositions.get(actor);
      const actionPosition = normalizedPosition(action.position);
      if (actor && knownPosition && actionPosition && knownPosition !== actionPosition) {
        issues.push({
          code: "ACTOR_POSITION_CONFLICT",
          street,
          actor: action.actor,
          message: `${action.actor} is ${knownPosition} in the player list but ${actionPosition} in this action.`,
        });
      }

      const previous = actions[index - 1];
      if (previous && identity(previous.actor) === actor && actor &&
          AGGRESSIVE_ACTIONS.has(actionName(previous.action)) &&
          RESPONSE_ACTIONS.has(actionName(action.action))) {
        requiresDistinctActors = true;
        issues.push({
          code: "SELF_RESPONSE",
          street,
          actor: action.actor,
          message: `${action.actor} cannot make both ${previous.action} and the following ${action.action}.`,
        });
      }
    }
  }

  // In the first betting orbit seats must act in table order; a decrease means an action was misattributed.
  {
    const seen = new Set();
    let lastRank = -1;
    for (const action of hand.streets?.preflop?.actions || []) {
      if (FORCED_BET_ACTIONS.has(actionName(action?.action))) continue;
      const actor = identity(action?.actor);
      if (actor && seen.has(actor)) break;
      if (actor) seen.add(actor);
      const rank = PREFLOP_SEAT_RANK[normalizedPosition(action?.position || playerPositions.get(actor))];
      if (rank === undefined) continue;
      if (rank < lastRank) {
        issues.push({
          code: "PREFLOP_ORDER_VIOLATION",
          street: "preflop",
          actor: action.actor,
          message: `${action.actor} (${normalizedPosition(action.position)}) acts before an earlier seat in the first pre-flop orbit; an action was likely misattributed or missed.`,
        });
        break;
      }
      lastRank = rank;
    }
  }

  const folded = new Set();
  for (const [street, data] of Object.entries(hand.streets || {})) {
    for (const action of data?.actions || []) {
      const actor = identity(action?.actor);
      if (!actor) continue;
      if (folded.has(actor) && !FORCED_BET_ACTIONS.has(actionName(action.action))) {
        issues.push({
          code: "FOLDED_PLAYER_ACTS",
          street,
          actor: action.actor,
          message: `${action.actor} already folded but acts again on the ${street}; the action was likely misattributed.`,
        });
        folded.clear();
        break;
      }
      if (actionName(action.action) === "fold") folded.add(actor);
    }
    if (issues.some((issue) => issue.code === "FOLDED_PLAYER_ACTS")) break;
  }

  const heroIdentity = identity(hand.heroName);
  const preflopActions = hand.streets?.preflop?.actions || [];
  if (heroIdentity && postflopActors.has(heroIdentity) && preflopActions.length &&
      !preflopActions.some((action) => identity(action?.actor) === heroIdentity)) {
    issues.push({
      code: "HERO_PREFLOP_ACTION_MISSING",
      street: "preflop",
      actor: hand.heroName,
      message: "Hero acts after the flop but has no pre-flop action; Hero's yellow action bubbles were likely attributed to other players.",
    });
  }

  if (requiresDistinctActors && playerPositions.size > 1 && postflopActors.size === 1) {
    issues.push({
      code: "COLLAPSED_POSTFLOP_ACTORS",
      street: "postflop",
      actor: [...postflopActors][0] || null,
      message: "Postflop response actions were collapsed onto one actor despite multiple players.",
    });
  }

  return { safe: issues.length === 0, issues };
}
