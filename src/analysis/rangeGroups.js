import "../../public/rangeNotation.js";

const RANGE_NOTATION = globalThis.PokerCoachRangeNotation;
const RANKS = "23456789TJQKA";
const RANK_VALUE = Object.fromEntries([...RANKS].map((rank, index) => [rank, index + 2]));
const STREET_BOARD_LENGTH = { flop: 3, turn: 4, river: 5 };
const GOOD_KICKER = RANK_VALUE.T;

// Made-hand tiers, strongest first. The order is the order of the group table the model sees.
const MADE_ORDER = [
  "straight flush",
  "quads",
  "full house",
  "flush",
  "straight",
  "set",
  "trips",
  "two pair",
  "overpair",
  "top pair, good kicker",
  "top pair, weak kicker",
  "pocket pair below top card",
  "second pair",
  "weak pair",
  "underpair",
  "two overcards",
  "no pair",
  "plays the board",
];
const DRAW_ORDER = ["combo draw", "nut flush draw", "flush draw", "open-ended straight draw", "gutshot", ""];
const STRONG_MADE = new Set(["straight flush", "quads", "full house", "flush", "straight", "set", "trips", "two pair"]);
const PAIR_MADE = new Set([
  "overpair",
  "top pair, good kicker",
  "top pair, weak kicker",
  "pocket pair below top card",
  "second pair",
  "weak pair",
  "underpair",
]);

export function parseCardList(text) {
  return String(text || "")
    .trim()
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((raw) => {
      const match = raw.match(/^(10|[2-9TJQKA])([cdhs])$/i);
      if (!match) throw new Error(`Invalid card ${raw}.`);
      return `${match[1] === "10" ? "T" : match[1].toUpperCase()}${match[2].toLowerCase()}`;
    });
}

export function boardThroughStreet(boardCards, street) {
  return boardCards.slice(0, STREET_BOARD_LENGTH[street] ?? 0);
}

// ---- five/seven-card evaluation (category * 1e10 + tiebreakers, higher is better) ----

function straightHigh(values) {
  const set = new Set(values);
  if (set.has(14)) set.add(1);
  for (let high = 14; high >= 5; high -= 1) {
    if ([0, 1, 2, 3, 4].every((offset) => set.has(high - offset))) return high;
  }
  return 0;
}

function scoreFive(cards) {
  const values = cards.map((card) => RANK_VALUE[card[0]]).sort((a, b) => b - a);
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = new Set(cards.map((card) => card[1])).size === 1;
  const straight = counts.size === 5 ? straightHigh(values) : 0;
  const score = (category, tiebreakers) => category * 1e10 + tiebreakers.reduce((total, value, index) => total + value * 10 ** (8 - index * 2), 0);
  if (straight && flush) return score(8, [straight]);
  if (groups[0][1] === 4) return score(7, [groups[0][0], groups[1][0]]);
  if (groups[0][1] === 3 && groups[1][1] === 2) return score(6, [groups[0][0], groups[1][0]]);
  if (flush) return score(5, values);
  if (straight) return score(4, [straight]);
  if (groups[0][1] === 3) return score(3, groups.map(([value]) => value));
  if (groups[0][1] === 2 && groups[1][1] === 2) return score(2, groups.map(([value]) => value));
  if (groups[0][1] === 2) return score(1, groups.map(([value]) => value));
  return score(0, values);
}

function bestScore(cards) {
  if (cards.length < 5) return 0;
  let best = 0;
  const pick = (start, chosen) => {
    if (chosen.length === 5) {
      best = Math.max(best, scoreFive(chosen));
      return;
    }
    for (let index = start; index <= cards.length - (5 - chosen.length); index += 1) pick(index + 1, [...chosen, cards[index]]);
  };
  pick(0, []);
  return best;
}

const category = (score) => Math.floor(score / 1e10);

function hasStraight(values) {
  return straightHigh([...new Set(values)]) > 0;
}

// ---- per-combo facts ----

function madeHand(combo, board) {
  const all = [...combo, ...board];
  const score = bestScore(all);
  const cat = category(score);
  if (board.length === 5 && score === bestScore(board)) return "plays the board";
  if (cat === 8) return "straight flush";
  if (cat === 7) return "quads";
  if (cat === 6) return "full house";
  if (cat === 5) return "flush";
  if (cat === 4) return "straight";

  const boardValues = board.map((card) => RANK_VALUE[card[0]]);
  const distinctBoard = [...new Set(boardValues)].sort((a, b) => b - a);
  const [high, low] = combo.map((card) => RANK_VALUE[card[0]]).sort((a, b) => b - a);
  if (high === low) {
    if (boardValues.includes(high)) return "set";
    if (high > distinctBoard[0]) return "overpair";
    if (high > distinctBoard[distinctBoard.length - 1]) return "pocket pair below top card";
    return "underpair";
  }
  const matches = [high, low].filter((value) => boardValues.includes(value));
  if (matches.some((value) => boardValues.filter((boardValue) => boardValue === value).length >= 2)) return "trips";
  if (matches.length === 2) return "two pair";
  if (matches.length === 1) {
    const paired = matches[0];
    const kicker = paired === high ? low : high;
    if (paired === distinctBoard[0]) return kicker >= GOOD_KICKER ? "top pair, good kicker" : "top pair, weak kicker";
    if (paired === distinctBoard[1]) return "second pair";
    return "weak pair";
  }
  if (low > distinctBoard[0]) return "two overcards";
  return "no pair";
}

// Only draws that use a hole card count: a four-flush or open straight sitting on the board alone gives
// every combo the same "draw", which says nothing about villain's hand.
function drawFor(combo, board, made) {
  if (board.length >= 5) return "";
  const all = [...combo, ...board];
  let flushDraw = "";
  if (!["straight flush", "flush", "full house", "quads"].includes(made)) {
    for (const suit of "cdhs") {
      const holeOfSuit = combo.filter((card) => card[1] === suit);
      if (!holeOfSuit.length || all.filter((card) => card[1] === suit).length !== 4) continue;
      const boardRanks = new Set(board.filter((card) => card[1] === suit).map((card) => RANK_VALUE[card[0]]));
      let nutRank = 14;
      while (boardRanks.has(nutRank)) nutRank -= 1;
      flushDraw = holeOfSuit.some((card) => RANK_VALUE[card[0]] === nutRank) ? "nut flush draw" : "flush draw";
    }
  }
  let straightDraw = "";
  if (!STRONG_MADE.has(made) || ["set", "trips", "two pair"].includes(made)) {
    const values = all.map((card) => RANK_VALUE[card[0]]);
    const boardValues = board.map((card) => RANK_VALUE[card[0]]);
    const outs = [];
    for (let value = 2; value <= 14; value += 1) {
      if (values.includes(value)) continue;
      if (hasStraight([...values, value]) && !hasStraight([...boardValues, value])) outs.push(value);
    }
    if (outs.length >= 2) straightDraw = "open-ended straight draw";
    else if (outs.length === 1) straightDraw = "gutshot";
  }
  if (flushDraw && straightDraw) return "combo draw";
  return flushDraw || straightDraw;
}

export function classifyCombo(combo, board) {
  const made = madeHand(combo, board);
  const draw = drawFor(combo, board, made);
  return { made, draw, key: `${made}|${draw}` };
}

function groupLabel(made, draw) {
  if (!draw) return made;
  if (made === "no pair" || made === "two overcards") return `${draw} (${made})`;
  return `${made} + ${draw}`;
}

// Chart bucket for a group, matching the labels the range matrix colors (rangeBucketMatrixView.js).
function groupRole(made, draw) {
  if (STRONG_MADE.has(made)) return "strong value";
  if (draw) return "draws/semi-bluffs";
  if (PAIR_MADE.has(made)) return "thin value/showdown";
  return "air/bluffs";
}

function handClassOf([cardA, cardB]) {
  if (cardA[0] === cardB[0]) return cardA[0] + cardB[0];
  const [high, low] = RANK_VALUE[cardA[0]] >= RANK_VALUE[cardB[0]] ? [cardA, cardB] : [cardB, cardA];
  return `${high[0]}${low[0]}${cardA[1] === cardB[1] ? "s" : "o"}`;
}

function liveClassCounter(deadCards) {
  const dead = new Set(deadCards);
  const cache = new Map();
  return (handClass) => {
    if (!cache.has(handClass)) {
      cache.set(handClass, RANGE_NOTATION.combosForClass(handClass).filter(([a, b]) => !dead.has(a) && !dead.has(b)).length);
    }
    return cache.get(handClass);
  };
}

function combosByClass(combos) {
  const byClass = new Map();
  for (const combo of combos) {
    const handClass = handClassOf(combo);
    if (!byClass.has(handClass)) byClass.set(handClass, []);
    byClass.get(handClass).push(combo);
  }
  return byClass;
}

// Whole classes where every live combo is present, exact combos (AhKh) otherwise, so the text re-parses to
// exactly these combos under the same dead cards.
export function rangeTextFromCombos(combos, deadCards = []) {
  const liveCount = liveClassCounter(deadCards);
  const tokens = [];
  for (const [handClass, classCombos] of combosByClass(combos)) {
    if (classCombos.length >= liveCount(handClass)) tokens.push(handClass);
    else tokens.push(...classCombos.map((combo) => combo.join("")));
  }
  return tokens.join(",");
}

// "88, T9s (Tc9c Td9d)": whole classes by name, partial ones with their exact combos.
export function describeCombos(combos, deadCards = [], maxClasses = 12) {
  const liveCount = liveClassCounter(deadCards);
  const parts = [...combosByClass(combos)].map(([handClass, classCombos]) =>
    classCombos.length >= liveCount(handClass) ? handClass : `${handClass} (${classCombos.map((combo) => combo.join("")).join(" ")})`,
  );
  const shown = parts.slice(0, maxClasses).join(", ");
  return parts.length > maxClasses ? `${shown}, +${parts.length - maxClasses} more` : shown;
}

export function parseRangeCombos(rangeText, deadCards = []) {
  return RANGE_NOTATION.parseRange(rangeText || "", deadCards).combos;
}

// Step 1: every combo villain can hold entering the street, grouped by what it actually is on this board.
export function groupRangeByBoard(combos, board) {
  const byKey = new Map();
  for (const combo of combos) {
    const facts = classifyCombo(combo, board);
    if (!byKey.has(facts.key)) byKey.set(facts.key, { made: facts.made, draw: facts.draw, combos: [] });
    byKey.get(facts.key).combos.push(combo);
  }
  const groups = [...byKey.values()].sort(
    (a, b) => MADE_ORDER.indexOf(a.made) - MADE_ORDER.indexOf(b.made) || DRAW_ORDER.indexOf(a.draw) - DRAW_ORDER.indexOf(b.draw),
  );
  return groups.map((group, index) => ({
    id: `G${index + 1}`,
    made: group.made,
    draw: group.draw,
    label: groupLabel(group.made, group.draw),
    role: groupRole(group.made, group.draw),
    combos: group.combos,
  }));
}

export function formatGroupTable(groups, deadCards = []) {
  return groups
    .map((group) => `${group.id} | ${group.label} | ${group.combos.length} combo${group.combos.length === 1 ? "" : "s"} | ${describeCombos(group.combos, deadCards, 16)}`)
    .join("\n");
}

const comboKey = (combo) => combo.join("");

// Step 2 result -> range. A group with no decision is kept (the action gave no stated reason to remove it)
// and reported as such.
export function applyGroupDecisions(groups, decisions = []) {
  const byId = new Map();
  for (const item of decisions) {
    if (item?.group && !byId.has(item.group)) byId.set(item.group, item);
  }
  const kept = [];
  const dropped = [];
  const undecided = [];
  for (const group of groups) {
    const decision = byId.get(group.id);
    const why = String(decision?.why || "").trim();
    if (!decision) {
      undecided.push(group);
      kept.push({ ...group, why: "No decision returned for this group; kept by default." });
    } else if (String(decision.decision).toLowerCase() === "drop") dropped.push({ ...group, why });
    else kept.push({ ...group, why });
  }
  return { kept, dropped, undecided };
}

function groupLine(group, deadCards, showWhy) {
  const head = `${group.label} – ${describeCombos(group.combos, deadCards)} (${group.combos.length} combo${group.combos.length === 1 ? "" : "s"})`;
  return showWhy && group.why ? `${head}: ${group.why}` : head;
}

// One row per group for the UI: what it is, how many combos, the model's reason, and the exact hands.
function groupDetails(list, deadCards) {
  return list.map((group) => ({
    label: group.label,
    role: group.role,
    combos: group.combos.length,
    hands: describeCombos(group.combos, deadCards, Infinity),
    why: group.why || "",
  }));
}

// Kept/Removed as structured rows (keptGroups/removedGroups) plus the same content as plain text for
// older renderers and the log.
export function narrowingLists({ kept, dropped }, deadCards, { showWhy = true } = {}) {
  return {
    kept: kept.length ? kept.map((group) => groupLine(group, deadCards, showWhy)).join("; ") : "Nothing.",
    removed: dropped.length ? dropped.map((group) => groupLine(group, deadCards, showWhy)).join("; ") : "Nothing.",
    keptGroups: groupDetails(kept, deadCards),
    removedGroups: groupDetails(dropped, deadCards),
  };
}

// A floor (a later point on this street, already analyzed) proves villain still holds those combos here:
// move any the decisions dropped back into kept, as their own rows with that reason.
export function keepFloorCombos({ kept, dropped }, floorCombos) {
  if (!floorCombos?.length) return { kept, dropped };
  const floor = new Set(floorCombos.map(comboKey));
  const restored = [];
  const stillDropped = [];
  for (const group of dropped) {
    const back = group.combos.filter((combo) => floor.has(comboKey(combo)));
    const rest = group.combos.filter((combo) => !floor.has(comboKey(combo)));
    if (back.length) restored.push({ ...group, combos: back, why: "Still in villain's range at a later point on this street that was already analyzed." });
    if (rest.length) stillDropped.push({ ...group, combos: rest });
  }
  return { kept: [...kept, ...restored], dropped: stillDropped };
}

// A street whose range came from elsewhere (a lock from an earlier analysis): split each group into the
// combos that are in that range and the ones that are not, so Kept/Removed still match it exactly.
export function splitGroupsByRange(groups, combos) {
  const inRange = new Set(combos.map(comboKey));
  const kept = [];
  const dropped = [];
  for (const group of groups) {
    const keep = group.combos.filter((combo) => inRange.has(comboKey(combo)));
    const drop = group.combos.filter((combo) => !inRange.has(comboKey(combo)));
    if (keep.length) kept.push({ ...group, combos: keep });
    if (drop.length) dropped.push({ ...group, combos: drop });
  }
  return { kept, dropped };
}

// The action-bucket chart for the final street, from the same groups that define the range.
export function weightedGroupsFromKept(kept, deadCards) {
  return ["strong value", "thin value/showdown", "draws/semi-bluffs", "air/bluffs"].map((role) => {
    const groups = kept.filter((group) => group.role === role);
    const combos = groups.flatMap((group) => group.combos);
    return {
      label: role,
      rangeText: combos.length ? rangeTextFromCombos(combos, deadCards) : "",
      reasoning: groups.length ? groups.map((group) => group.label).join(", ") : "No combos in this bucket.",
    };
  });
}

export function intersectCombos(combos, otherCombos) {
  const keep = new Set(otherCombos.map(comboKey));
  return combos.filter((combo) => keep.has(comboKey(combo)));
}

// ---- guardrails on the model's decisions ----

// Villain's line on one street, from the recorded actions: any raise wins, then a call (check-call or
// call), then a bet, then a check. A check as the street's first action is "check-first": out of
// position nearly the whole range checks, so it says almost nothing (unlike checking behind, "check").
// "none" when villain has not acted or cannot be identified.
export function villainLine(rows, villainPosition) {
  if (!villainPosition || !Array.isArray(rows)) return "none";
  const actions = rows.filter((row) => row?.actor === villainPosition).map((row) => String(row.action || "").toLowerCase());
  if (!actions.length) return "none";
  if (actions.some((action) => /raise|3-?bet|4-?bet/.test(action))) return "raise";
  if (actions.some((action) => /call/.test(action))) return "call";
  if (actions.some((action) => /bet|all.?in|shove/.test(action))) return "bet";
  return rows[0]?.actor === villainPosition ? "check-first" : "check";
}

const RAISE_MUST_KEEP = new Set(["straight flush", "quads", "full house", "flush", "straight", "set"]);
// A reason only contradicts a no-draw group when it says the hand IS or HAS a draw ("Flush draws have
// equity...", "top pair with a flush draw"); draws in the other player's range ("charge the draws",
// "protection against the spade draw") are fine.
const DRAW_TERM = "(?:nut\\s+)?(?:flush|straight|combo)\\s+draws?|open[-\u2011\\s]ended(?:\\s+straight\\s+draws?)?|gutshots?|oesds?";
const DRAW_AS_SUBJECT = new RegExp(`^\\W*(?:\\w+\\W+){0,2}?(?:${DRAW_TERM})\\b`, "i");
const DRAW_POSSESSED = new RegExp(`\\b(?:with|plus|has|have|holding|holds|picks?\\s+up|adds?)\\s+(?:an?\\s+|the\\s+|some\\s+)?(?:strong\\s+|big\\s+|real\\s+)?(?:${DRAW_TERM})\\b`, "i");
const claimsDraw = (why) => DRAW_AS_SUBJECT.test(why) || DRAW_POSSESSED.test(why);

// Only clear-cut poker logic is enforced: nobody folds a set or better out of their raising range, and a
// hand with no pair and no draw does not call a bet. Reasons must also match the group they are shown on.
// Each violation says how code would fix it if the model does not ("keep"/"drop", or null for text only).
export function checkGroupDecisions(groups, decisions = [], line = "none") {
  const byId = new Map((decisions || []).filter((item) => item?.group).map((item) => [item.group, item]));
  const violations = [];
  for (const group of groups) {
    const decision = byId.get(group.id);
    if (!decision) continue;
    const choice = String(decision.decision || "").toLowerCase();
    const why = String(decision.why || "");
    if (line === "raise" && choice === "drop" && RAISE_MUST_KEEP.has(group.made)) {
      violations.push({ group: group.id, fix: "keep", message: `${group.id} (${group.label}): villain raised, and a ${group.made} is a hand villain raises for value, so it cannot be dropped.` });
    } else if (line === "check" && choice === "drop" && RAISE_MUST_KEEP.has(group.made)) {
      violations.push({ group: group.id, fix: "keep", message: `${group.id} (${group.label}): villain only checked, and strong hands like a ${group.made} are often checked to trap or check-raise, so it cannot be dropped.` });
    } else if (line === "call" && choice === "keep" && group.made === "no pair" && !group.draw) {
      violations.push({ group: group.id, fix: "drop", message: `${group.id} (${group.label}): no pair and no draw cannot profitably call a bet, so it cannot be kept.` });
    }
    if (!group.draw && claimsDraw(why)) {
      violations.push({ group: group.id, fix: null, message: `${group.id} (${group.label}): the reason talks about a draw, but this group has no draw.` });
    }
  }
  return violations;
}

// Last resort after a retry: force the rule's decision and say so in the row, and withhold a reason that
// contradicts the group's own hand.
export function applyGuardrailFixes(decisions = [], violations = []) {
  const byGroup = new Map();
  for (const violation of violations) {
    if (!byGroup.has(violation.group)) byGroup.set(violation.group, []);
    byGroup.get(violation.group).push(violation);
  }
  return decisions.map((item) => {
    const found = byGroup.get(item?.group);
    if (!found) return item;
    const forced = found.find((violation) => violation.fix);
    if (forced) {
      const rule = forced.fix === "drop"
        ? "with no pair and no draw these fold to a bet"
        : /only checked/.test(forced.message)
          ? "strong hands are often checked to trap or check-raise"
          : "villain raises these for value";
      return { ...item, decision: forced.fix, why: `${forced.fix === "keep" ? "Kept" : "Removed"} by rule: ${rule}. (The model had ${forced.fix === "keep" ? "removed" : "kept"} them.)` };
    }
    return { ...item, why: `${String(item.decision).toLowerCase() === "drop" ? "Removed" : "Kept"} by the model; its reason described a draw this group does not have, so it is not shown.` };
  });
}

// ---- one-to-two sentence summaries of each list ----

// Hand types a summary can name, longest first so "flush draw" is not also read as "flush".
const SUMMARY_TERMS = [
  "straight flush", "full house", "nut flush draw", "combo draw", "flush draw", "open-ended", "two pair", "top pair",
  "second pair", "weak pair", "pocket pair", "no pair", "overpair", "underpair", "overcard", "gutshot", "quads",
  "flush", "straight", "set", "trips",
].sort((a, b) => b.length - a.length);

function termsIn(text) {
  let rest = ` ${String(text || "").toLowerCase()} `;
  const found = new Set();
  for (const term of SUMMARY_TERMS) {
    const pattern = new RegExp(`\\b${term.replace(/[-\s]/g, "[-\\s]")}(?:e?s)?\\b`, "g");
    if (pattern.test(rest)) {
      found.add(term);
      rest = rest.replace(pattern, " ");
    }
  }
  return found;
}

// A summary may only name hand types that appear in its own list (checked against group labels), never
// ones that only appear in the other list.
export function checkListSummary(summary, ownGroups, otherGroups, listName) {
  const own = new Set(ownGroups.flatMap((group) => [...termsIn(group.label)]));
  const other = new Set(otherGroups.flatMap((group) => [...termsIn(group.label)]));
  const wrong = [...termsIn(summary)].filter((term) => !own.has(term) && other.has(term));
  return wrong.length ? [`${listName}Summary names ${wrong.join(", ")}, but those groups are not in the ${listName} list.`] : [];
}

// Fallback summary written by code: the biggest groups by combos.
export function codeListSummary(groups, verb) {
  if (!groups.length) return "";
  const total = groups.reduce((sum, group) => sum + group.combos.length, 0);
  const labels = [...groups].sort((a, b) => b.combos.length - a.combos.length).map((group) => group.label);
  const shown = labels.slice(0, 4);
  const list = shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}` : shown[0];
  return `${verb} ${list}${labels.length > shown.length ? `, plus ${labels.length - shown.length} smaller group${labels.length - shown.length === 1 ? "" : "s"}` : ""} (${total} combos).`;
}
