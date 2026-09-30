const RANKS = "23456789TJQKA";
const SUITS = "cdhs";
const RANK_VALUE = Object.fromEntries([...RANKS].map((rank, index) => [rank, index + 2]));
const CLIENT_BUILD_ID = "solver-allin-legal-actions-20260805";
const ACTION_POLICY = typeof window !== "undefined" ? window.PokerCoachActionPolicy : null;
const ACTION_ROW_PRESENTATION = typeof window !== "undefined" ? window.PokerCoachActionRowPresentation : null;
const IMPORT_ANALYSIS_CACHE_MODEL = typeof window !== "undefined" ? window.PokerCoachImportAnalysisCacheModel : null;
const IMPORT_ANALYSIS_PREFETCH_MODEL = typeof window !== "undefined" ? window.PokerCoachImportAnalysisPrefetchModel : null;
const ANALYSIS_REQUEST_MODEL = typeof window !== "undefined" ? window.PokerCoachAnalysisRequestModel : null;
const IMPORT_PROGRESS_MODEL = typeof window !== "undefined" ? window.PokeTeriorImportProgress : null;
const SCREENSHOT_UPLOAD_MODEL = typeof window !== "undefined" ? window.PokerCoachScreenshotUploadModel : null;
const HAND_SESSION_MODEL = typeof window !== "undefined" ? window.PokerCoachHandSessionModel : null;
const IMPORT_BUILDER_ADAPTER = typeof window !== "undefined" ? window.PokerCoachImportBuilderAdapter : null;
const IMPORT_DECISION_MODEL = typeof window !== "undefined" ? window.PokerCoachImportDecisionModel : null;
const IMPORT_DISPATCH = typeof window !== "undefined" ? window.PokerCoachImportDispatch : null;
const IMPORT_PROGRESS_VIEW = typeof window !== "undefined" ? window.PokerCoachImportProgressView : null;
const RANGE_DECISION_CONTEXT = typeof window !== "undefined" ? window.PokerCoachRangeDecisionContext : null;
const LLM_RANGE_GUARD = typeof window !== "undefined" ? window.PokerCoachLLMRangeGuard : null;
const PREFLOP_SPOT_MODEL = typeof window !== "undefined" ? window.PokerCoachPreflopSpotModel : null;
const IMPORT_CARD_VALIDITY = typeof window !== "undefined" ? window.PokerCoachImportCardValidity : null;
const IMPORT_HERO_CARD_MODEL = typeof window !== "undefined" ? window.PokerCoachImportHeroCards : null;
const PROVIDER_ATTRIBUTION = typeof window !== "undefined"
  ? window.PokerCoachProviderAttribution
  : null;
const API_CLIENT = typeof window !== "undefined" ? window.PokerCoachApiClient : null;
const ANALYSIS_PRESENTATION = typeof window !== "undefined" ? window.PokerCoachAnalysisPresentation : null;
const RANGE_BUCKET_MATRIX_VIEW = typeof window !== "undefined" ? window.PokerCoachRangeBucketMatrixView : null;
const POSTFLOP_COMPATIBILITY = typeof window !== "undefined" ? window.PokerCoachPostflopCompatibility : null;

const HAND_CATEGORY = [
  "high card",
  "one pair",
  "two pair",
  "set/trips",
  "straight",
  "flush",
  "full house",
  "quads",
  "straight flush",
];

const POSTFLOP_ORDER = { SB: 0, BB: 1, UTG: 2, MP: 3, HJ: 3, CO: 4, BTN: 5 };
const POSITIONS = ["UTG", "MP", "CO", "BTN", "SB", "BB"];
const ACTIONS = [
  ["open", "Open"],
  ["check", "Check"],
  ["bet", "Bet"],
  ["call", "Call"],
  ["raise", "Raise"],
  ["allin", "All-in"],
  ["fold", "Fold"],
];

const $ = (id) => document.getElementById(id);

function appendDeveloperDiagnostic(label, detail) {
  const target = $("developerDiagnostics");
  if (!target || !detail) return;
  const entry = document.createElement("div");
  entry.className = "diagnostic-entry";
  entry.innerHTML = `<strong>${escapeHtml(label)}</strong><pre>${escapeHtml(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2))}</pre>`;
  target.append(entry);
}
let visibleStreet = "preflop";
let analysisRequestId = 0;
const analysisRequestCoordinator = ANALYSIS_REQUEST_MODEL?.createAnalysisRequestCoordinator?.() || null;
let currentMode = "manual";
let importedHand = null;
let manualSession = HAND_SESSION_MODEL?.createSession("manual") || null;
let importSession = HAND_SESSION_MODEL?.createSession("screenshot") || null;
let importWorkspace = null;
let preflopBuilder = null;
let postflopBuilder = null;
let postflopAnalysisView = null;
let analysisTabs = null;
// The imported-hand review card (cards, hero seat, notes) is out of the way unless something needs correcting.
let importCardReviewRequested = false;
const PREFLOP_RANGE_LOCK = typeof window !== "undefined" && window.PokerCoachPreflopRangeLock
  ? window.PokerCoachPreflopRangeLock.createPreflopRangeLock({ storage: (() => { try { return window.sessionStorage; } catch { return null; } })() })
  : null;
// Flop/turn equivalent of PREFLOP_RANGE_LOCK: once a street's range is computed, remember it so
// re-analyzing a later street in the same hand reuses it instead of letting the LLM re-roll it.
const STREET_RANGE_LOCK = typeof window !== "undefined" && window.PokerCoachStreetRangeLock
  ? window.PokerCoachStreetRangeLock.createStreetRangeLock({ storage: (() => { try { return window.sessionStorage; } catch { return null; } })() })
  : null;
let verdictState = { ai: null, skill: null, solver: null, solverConfidence: null, node: "" };
let currentVisionImportId = null;
let screenshotImportGeneration = 0;
let currentRangeViews = { llm: null };
// Populated by renderLLMRangeTimeline so the Range Evolution steps stay clickable after the initial
// render: {interpretation, byStreet: Map<street, {rangeText, reasoning, combos}>, selectedStreet}.
let activeRangeEvolution = null;
const importedAnalysisCache = IMPORT_ANALYSIS_CACHE_MODEL?.createImportAnalysisCache?.() || null;
let importedPrefetchGeneration = 0;
let activeImportedPrefetchKey = null;
let activeImportedPrefetchMode = "background";
const importedAnalysisPrefetchQueue = IMPORT_ANALYSIS_PREFETCH_MODEL?.createImportAnalysisPrefetchQueue?.({
  worker: (entry) => runImportedPrefetchEntry(entry),
  onStatusChange: ({ key, status }) => renderImportedPrefetchStatus(key, status),
}) || null;

function setVisibleStreet(street) {
  visibleStreet = street;
  $("flopSection").classList.toggle("is-hidden", street === "preflop");
  $("turnSection").classList.toggle("is-hidden", !["turn", "river"].includes(street));
  $("riverSection").classList.toggle("is-hidden", street !== "river");
  updateProgressiveControls();
}

function showManualBuilderStage(stage) {
  const postflop = stage === "postflop";
  $("preflopBuilder").classList.toggle("is-hidden", postflop);
  $("postflopBuilder").classList.toggle("is-hidden", !postflop);
  if (postflop) for (const id of ["flopSection", "turnSection", "riverSection"]) $(id).classList.add("is-hidden");
}

function isStreetVisible(street) {
  if (street === "preflop") return true;
  if (street === "flop") return ["flop", "turn", "river"].includes(visibleStreet);
  if (street === "turn") return ["turn", "river"].includes(visibleStreet);
  if (street === "river") return visibleStreet === "river";
  return false;
}

function optionsHtml(options, selected) {
  return options
    .map((option) => {
      const value = Array.isArray(option) ? option[0] : option;
      const label = Array.isArray(option) ? option[1] : option;
      return `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`;
    })
    .join("");
}

function addActionRow(street, defaults = {}) {
  const target = $(`${street}Actions`);
  const row = document.createElement("div");
  row.className = "action-row";
  row.dataset.street = street;
  row.innerHTML = `
    <span class="action-row-index"></span>
    <div class="action-row-fields">
      <select class="action-actor" aria-label="Actor">${optionsHtml(POSITIONS, defaults.actor || "HJ")}</select>
      <select class="action-type" aria-label="Action">${optionsHtml(ACTIONS, defaults.action || "open")}</select>
      <input class="action-amount" type="number" min="0" step="0.5" placeholder="bb" value="${defaults.amount || ""}" aria-label="Amount" />
    </div>
    <button class="icon-btn remove-action" type="button" aria-label="Remove action">x</button>
  `;
  target.appendChild(row);
  refreshActionRows(street);
  updateProgressiveControls();
}

function refreshActionRows(street) {
  [...$(`${street}Actions`).querySelectorAll(".action-row")].forEach((row, index) => {
    row.querySelector(".action-row-index").textContent = index + 1;
  });
  refreshHeroActionRows(street);
}

function refreshHeroActionRows(street = null) {
  const heroPosition = $("heroPosition").value;
  const selector = street ? `#${street}Actions .action-row` : ".action-sequence .action-row";
  document.querySelectorAll(selector).forEach((row) => {
    const actor = row.querySelector(".action-actor")?.value || "";
    const isHero = ACTION_ROW_PRESENTATION?.isHeroActor(actor, heroPosition) ?? actor === heroPosition;
    row.classList.toggle("is-hero-action", isHero);
    if (isHero) row.dataset.actionOwner = "hero";
    else delete row.dataset.actionOwner;
  });
}

function getActionSequence(street) {
  return [...$(`${street}Actions`).querySelectorAll(".action-row")].map((row) => ({
    actor: row.querySelector(".action-actor").value,
    action: row.querySelector(".action-type").value,
    amount: Number(row.querySelector(".action-amount").value || 0),
  }));
}

// The villain is whoever hero is actually still up against, not whoever happened to act first. A
// multiway pot can have several non-hero actors, and an earlier one (e.g. BB) can fold after a later
// one (e.g. UTG) raises behind them - at that point UTG, not BB, is the live opponent hero must read.
// So this walks the action sequence in order and tracks the most recent non-hero actor who has not
// folded, rather than stopping at the first non-hero row.
function resolveVillainPosition(defaultPosition, heroPosition, primaryRows = [], fallbackRows = []) {
  const rows = [...primaryRows, ...fallbackRows];
  let lastActiveVillain = null;
  for (const row of rows) {
    if (!row.actor || row.actor === heroPosition || !POSITIONS.includes(row.actor)) continue;
    if (row.action === "fold") continue;
    lastActiveVillain = row.actor;
  }
  return lastActiveVillain || defaultPosition;
}

function currentPostflopVillainPosition(heroPosition, defaultPosition = $("villainPosition").value) {
  const rows = ["flop", "turn", "river"].flatMap((street) => getActionSequence(street));
  return resolveVillainPosition(defaultPosition, heroPosition, rows);
}

function setupActionSequence(street) {
  const addButton = $(`add${street[0].toUpperCase()}${street.slice(1)}ActionBtn`);
  if (!addButton) return;
  addButton.addEventListener("click", () =>
    addActionRow(street, defaultActionForNextRow(street)),
  );
  $(`${street}Actions`).addEventListener("click", (event) => {
    if (!event.target.classList.contains("remove-action")) return;
    event.target.closest(".action-row").remove();
    refreshActionRows(street);
    updateProgressiveControls();
  });
  $(`${street}Actions`).addEventListener("input", updateProgressiveControls);
  $(`${street}Actions`).addEventListener("change", updateProgressiveControls);
  $(`${street}Actions`).addEventListener("change", (event) => {
    if (event.target.classList.contains("action-type") || event.target.classList.contains("action-actor")) {
      updateCallAmounts(street);
      updateProgressiveControls();
      refreshHeroActionRows(street);
    }
  });
}

function defaultActionForNextRow(street) {
  const heroPosition = $("heroPosition").value;
  const rows = getActionSequence(street);
  const villainPosition =
    street === "preflop"
      ? $("villainPosition").value
      : currentPostflopVillainPosition(heroPosition, $("villainPosition").value);
  if (street === "preflop") {
    const defaults = [
      { actor: villainPosition, action: "open", amount: 2.5 },
      { actor: heroPosition, action: "raise", amount: 9 },
      { actor: villainPosition, action: "call", amount: 9 },
    ];
    return defaults[rows.length] || { actor: rows.length % 2 === 0 ? villainPosition : heroPosition, action: "call" };
  }
  const order = postflopOrder(heroPosition, villainPosition);
  return {
    actor: rows.length % 2 === 0 ? (order.heroFirst ? heroPosition : villainPosition) : order.heroFirst ? villainPosition : heroPosition,
    action: rows.length === 0 ? "check" : "bet",
  };
}

function deck() {
  return [...RANKS].flatMap((rank) => [...SUITS].map((suit) => rank + suit));
}

function normalizeCard(raw) {
  const card = raw.trim().toUpperCase();
  if (!card) return null;
  const match = card.match(/^(10|[2-9TJQKA])([CDHS])$/);
  const rank = match?.[1] === "10" ? "T" : match?.[1];
  const suit = match?.[2]?.toLowerCase();
  if (!RANKS.includes(rank) || !SUITS.includes(suit)) {
    throw new Error(`Invalid card "${raw}". Use formats like Ah, 10h, Th, Ks, Qd.`);
  }
  return rank + suit;
}

function parseCards(text, expectedCount) {
  const cards = text
    .replaceAll(",", " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(normalizeCard);
  const unique = new Set(cards);
  if (unique.size !== cards.length) throw new Error("Duplicate cards found in the hand setup.");
  if (expectedCount && cards.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} cards.`);
  }
  return cards;
}

function handClass(cardA, cardB) {
  const [rankA, suitA] = cardA;
  const [rankB, suitB] = cardB;
  if (rankA === rankB) return rankA + rankB;
  const ordered = [rankA, rankB].sort((a, b) => RANK_VALUE[b] - RANK_VALUE[a]);
  return ordered.join("") + (suitA === suitB ? "s" : "o");
}

const RANGE_NOTATION = typeof window !== "undefined" ? window.PokerCoachRangeNotation : null;
const HAND_EQUITY = typeof window !== "undefined" ? window.PokerCoachHandEquity : null;
const ANALYSIS_STREET_HISTORY = typeof window !== "undefined" ? window.PokerCoachAnalysisStreetHistory : null;
const analysisStreetHistory = ANALYSIS_STREET_HISTORY?.createStreetHistory() || null;

function parseRange(rangeText, blockers) {
  return RANGE_NOTATION.parseRange(rangeText, blockers);
}

function evaluateFive(cards) {
  const counts = new Map();
  const suits = new Map();
  const values = cards.map((card) => RANK_VALUE[card[0]]).sort((a, b) => b - a);
  for (const card of cards) {
    counts.set(RANK_VALUE[card[0]], (counts.get(RANK_VALUE[card[0]]) || 0) + 1);
    suits.set(card[1], (suits.get(card[1]) || 0) + 1);
  }
  const unique = [...new Set(values)].sort((a, b) => b - a);
  const straightHigh = getStraightHigh(unique);
  const flush = [...suits.values()].some((count) => count === 5);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  if (straightHigh && flush) return score(8, [straightHigh]);
  if (groups[0][1] === 4) return score(7, [groups[0][0], kicker(values, [groups[0][0]])[0]]);
  if (groups[0][1] === 3 && groups[1][1] === 2) return score(6, [groups[0][0], groups[1][0]]);
  if (flush) return score(5, values);
  if (straightHigh) return score(4, [straightHigh]);
  if (groups[0][1] === 3) return score(3, [groups[0][0], ...kicker(values, [groups[0][0]])]);
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = groups.filter((group) => group[1] === 2).map((group) => group[0]);
    return score(2, [...pairs, kicker(values, pairs)[0]]);
  }
  if (groups[0][1] === 2) return score(1, [groups[0][0], ...kicker(values, [groups[0][0]])]);
  return score(0, values);
}

function getStraightHigh(uniqueValues) {
  const wheel = [14, 5, 4, 3, 2];
  if (wheel.every((value) => uniqueValues.includes(value))) return 5;
  for (let high = 14; high >= 6; high -= 1) {
    if ([0, 1, 2, 3, 4].every((offset) => uniqueValues.includes(high - offset))) return high;
  }
  return null;
}

function kicker(values, excluded) {
  return values.filter((value) => !excluded.includes(value));
}

function score(category, tiebreakers) {
  return category * 1e10 + tiebreakers.reduce((total, value, index) => total + value * 10 ** (8 - index * 2), 0);
}

function scoreCategory(value) {
  return Math.floor(value / 1e10);
}

function bestSeven(cards) {
  let best = 0;
  for (let a = 0; a < cards.length - 4; a += 1) {
    for (let b = a + 1; b < cards.length - 3; b += 1) {
      for (let c = b + 1; c < cards.length - 2; c += 1) {
        for (let d = c + 1; d < cards.length - 1; d += 1) {
          for (let e = d + 1; e < cards.length; e += 1) {
            best = Math.max(best, evaluateFive([cards[a], cards[b], cards[c], cards[d], cards[e]]));
          }
        }
      }
    }
  }
  return best;
}

function hasFlushDraw(cards) {
  const suitCounts = new Map();
  for (const card of cards) suitCounts.set(card[1], (suitCounts.get(card[1]) || 0) + 1);
  return [...suitCounts.values()].some((count) => count === 4);
}

function straightDrawType(cards) {
  const values = [...new Set(cards.map((card) => RANK_VALUE[card[0]]))];
  if (values.includes(14)) values.push(1);
  const unique = [...new Set(values)].sort((a, b) => a - b);
  const windows = [
    [1, 2, 3, 4, 5],
    [2, 3, 4, 5, 6],
    [3, 4, 5, 6, 7],
    [4, 5, 6, 7, 8],
    [5, 6, 7, 8, 9],
    [6, 7, 8, 9, 10],
    [7, 8, 9, 10, 11],
    [8, 9, 10, 11, 12],
    [9, 10, 11, 12, 13],
    [10, 11, 12, 13, 14],
  ];
  for (const window of windows) {
    const present = window.filter((value) => unique.includes(value));
    if (present.length !== 4) continue;
    const missing = window.find((value) => !unique.includes(value));
    if (missing === window[0] || missing === window[4]) return "open-ended straight draw";
    return "gutshot straight draw";
  }
  return "";
}

function madeHandFeatures(combo, boardCards) {
  const boardRanks = boardCards.map((card) => RANK_VALUE[card[0]]);
  const topBoard = Math.max(...boardRanks);
  const comboRanks = combo.map((card) => RANK_VALUE[card[0]]);
  const category = scoreCategory(bestSeven([...combo, ...boardCards]));
  const pairRank = comboRanks[0] === comboRanks[1] ? comboRanks[0] : null;
  const overpair = pairRank && pairRank > topBoard;
  const topPair = comboRanks.includes(topBoard) && category === 1;
  const pairedBoard = comboRanks.some((rank) => boardRanks.includes(rank));
  const twoOvercards = comboRanks.every((rank) => rank > topBoard);
  return { category, overpair, topPair, pairedBoard, twoOvercards };
}

function analyzeFlopCombo(combo, boardCards) {
  const cards = [...combo, ...boardCards];
  const made = madeHandFeatures(combo, boardCards);
  const flushDraw = hasFlushDraw(cards);
  const straightDraw = straightDrawType(cards);
  const strongMade = made.category >= 2 || made.overpair;
  const value = made.category >= 2 || made.overpair || made.topPair;
  const draw = flushDraw || Boolean(straightDraw);
  const showdown = made.category === 1 && !made.topPair && !made.overpair;
  const air = !value && !draw && !showdown;
  const labels = [];
  if (made.overpair) labels.push("overpair");
  else if (made.topPair) labels.push("top pair");
  else labels.push(HAND_CATEGORY[made.category]);
  if (flushDraw) labels.push("flush draw");
  if (straightDraw) labels.push(straightDraw);
  if (made.twoOvercards && made.category === 0) labels.push("two overcards");
  return {
    combo,
    category: value ? "Value" : draw ? "Draw" : showdown ? "Showdown" : "Air",
    madeCategory: made.category,
    strongMade,
    value,
    draw,
    showdown,
    air,
    flushDraw,
    straightDraw,
    topPair: made.topPair,
    overpair: made.overpair,
    twoOvercards: made.twoOvercards,
    label: labels.join(", "),
  };
}

function postflopOrder(heroPosition, villainPosition) {
  const heroFirst = POSTFLOP_ORDER[heroPosition] < POSTFLOP_ORDER[villainPosition];
  return {
    heroFirst,
    firstActor: heroFirst ? "Hero" : "Villain",
    secondActor: heroFirst ? "Villain" : "Hero",
  };
}

function sequenceFromRows(rows, heroPosition, villainPosition, hasFlop, label = "Flop") {
  const order = postflopOrder(heroPosition, villainPosition);
  const first = rows[0];
  const second = rows[1];
  const third = rows[2];
  const lastHeroAction = [...rows].reverse().find((row) => row.actor === heroPosition);
  return {
    ...order,
    hasFlop,
    streetLabel: label,
    rows,
    rawAction1: first?.action || "none",
    rawAction2: second?.action || "none",
    rawAction3: third?.action || "none",
    rawHeroResponse: lastHeroAction?.action || "none",
    action1: first ? normalizeStreetAction(first.action) : "none",
    action2: second ? normalizeStreetAction(second.action) : "none",
    action3: third ? normalizeStreetAction(third.action) : "none",
    heroResponse: lastHeroAction ? normalizeStreetAction(lastHeroAction.action) : "none",
  };
}

function normalizeStreetAction(action) {
  if (action === "allin") return "raise";
  return action;
}

function isAllInRaw(action) {
  return ACTION_POLICY?.isAllInAction(action) || false;
}

function isBetLikeAction(action, rawAction) {
  return action?.startsWith("bet") || isAllInRaw(rawAction);
}

function isRaiseLikeAction(action, rawAction) {
  return action?.startsWith("raise") || isAllInRaw(rawAction);
}

function currentDecisionNode(sequence) {
  const street = sequence.streetLabel || "Flop";
  const {
    heroFirst,
    action1,
    action2,
    action3,
    heroResponse,
    firstActor,
    secondActor,
    rawAction1,
    rawAction2,
    rawAction3,
  } = sequence;
  if (!sequence.hasFlop) {
    return {
      street,
      title: `${street} Node`,
      facingBet: true,
      facingAllIn: false,
      description: "Recommendation is tied to the preflop decision.",
    };
  }
  if (heroFirst) {
    if (action1 === "none") {
      return {
        street,
        title: `${street} Node: ${firstActor} first to act`,
        facingBet: false,
        facingAllIn: false,
        description: `${firstActor} acts before ${secondActor}. Recommendation is for hero's first ${street.toLowerCase()} action.`,
      };
    }
    if (action1 === "check" && isBetLikeAction(action2, rawAction2)) {
      const facingAllIn = ACTION_POLICY?.isAllInAction(rawAction2) || false;
      return {
        street,
        title: `${street} Node: Hero facing ${secondActor} ${facingAllIn ? "all-in" : "bet"}`,
        facingBet: true,
        facingAllIn,
        description: facingAllIn
          ? `Hero checked, ${secondActor} moved all-in, so the only unresolved hero response is call or fold.`
          : `Hero checked, ${secondActor} bet, so the recommendation is for hero's response to that bet.`,
      };
    }
    if (isBetLikeAction(action1, rawAction1) && isRaiseLikeAction(action2, rawAction2)) {
      const facingAllIn = ACTION_POLICY?.isAllInAction(rawAction2) || false;
      return {
        street,
        title: `${street} Node: Hero facing ${secondActor} ${facingAllIn ? "all-in" : "raise"}`,
        facingBet: true,
        facingAllIn,
        description: facingAllIn
          ? `Hero bet and ${secondActor} moved all-in, so the only unresolved hero response is call or fold.`
          : `Hero bet, ${secondActor} raised, so the recommendation is for hero's response to the raise.`,
      };
    }
    return {
      street,
      title: `${street} Node: sequence review`,
      facingBet: false,
      facingAllIn: false,
      terminal: heroResponse !== "none" || action2 === "call" || action2 === "fold" || action2 === "check",
      description: "No unresolved hero facing-bet decision is currently entered; calculations describe the range at this sequence node.",
    };
  }
  if (isBetLikeAction(action1, rawAction1)) {
    const facingAllIn = ACTION_POLICY?.isAllInAction(rawAction1) || false;
    return {
      street,
      title: `${street} Node: Hero facing ${firstActor} ${facingAllIn ? "all-in" : "bet"}`,
      facingBet: true,
      facingAllIn,
      description: facingAllIn
        ? `${firstActor} acts first and moved all-in, so the only unresolved hero response is call or fold.`
        : `${firstActor} acts first and bet, so the recommendation is for hero's response.`,
    };
  }
  if (action1 === "check") {
    if (isBetLikeAction(action2, rawAction2) && isRaiseLikeAction(action3, rawAction3)) {
      const facingAllIn = ACTION_POLICY?.isAllInAction(rawAction3) || false;
      return {
        street,
        title: `${street} Node: Hero facing ${firstActor} ${facingAllIn ? "check-shove" : "check-raise"}`,
        facingBet: true,
        facingAllIn,
        description: facingAllIn
          ? `${firstActor} checked, Hero bet, and ${firstActor} moved all-in, so the only unresolved hero response is call or fold.`
          : `${firstActor} checked, Hero bet, and ${firstActor} raised, so the recommendation is for hero's response to the check-raise.`,
      };
    }
    if (isBetLikeAction(action2, rawAction2)) {
      return {
        street,
        title: `${street} Node: Hero bet after ${firstActor} check`,
        facingBet: false,
        facingAllIn: false,
        terminal: true,
        description: `${firstActor} checked and Hero bet. Add a third action if ${firstActor} responds.`,
      };
    }
    return {
      street,
      title: `${street} Node: Hero after villain check`,
      facingBet: false,
      facingAllIn: false,
      description: `${firstActor} checked to hero, so the recommendation is for hero's betting/checking decision.`,
    };
  }
  return {
    street,
    title: `${street} Node: ${firstActor} first to act`,
    facingBet: false,
    facingAllIn: false,
    description: `${firstActor} acts first. Enter action 1 to move the sequence forward.`,
  };
}

function shouldShowSecondFlopAction(action1) {
  return action1 !== "none";
}

function shouldShowHeroFlopResponse(sequence) {
  if (!sequence.hasFlop) return false;
  if (sequence.heroFirst) {
    return (sequence.action1 === "check" && sequence.action2.startsWith("bet")) || sequence.action2.startsWith("raise");
  }
  return sequence.action1.startsWith("bet");
}

function updateProgressiveControls() {
  const heroPosition = $("heroPosition").value;
  const villainPosition = currentPostflopVillainPosition(heroPosition, $("villainPosition").value);
  if ($("villainPosition").value !== villainPosition) $("villainPosition").value = villainPosition;
  const order = postflopOrder(heroPosition, villainPosition);
  const boardCards = parseVisibleBoardLenient();

  if (isStreetVisible("flop")) {
    $("flopOrderText").textContent = `Postflop order: ${order.firstActor} acts first, then ${order.secondActor}. Enter the next action only after it happens.`;
  }
  if (isStreetVisible("turn")) {
    $("turnOrderText").textContent = `Postflop order: ${order.firstActor} acts first, then ${order.secondActor}. Add turn actions one by one.`;
  }
  if (isStreetVisible("river")) {
    $("riverOrderText").textContent = `Postflop order: ${order.firstActor} acts first, then ${order.secondActor}. Add river actions one by one.`;
  }
  for (const street of ["flop", "turn", "river"]) {
    const rows = isStreetVisible(street) ? getActionSequence(street) : [];
    const sequence = sequenceFromRows(rows, heroPosition, villainPosition, boardCards.length >= requiredBoardCount(street), streetLabel(street));
    const node = currentDecisionNode(sequence);
    const field = $(`${street}CallField`);
    if (field) field.classList.toggle("is-hidden", !isStreetVisible(street) || !node.facingBet);
  }
  updatePotReadouts();
  updateCardVisualization();
}

function updatePotReadouts() {
  const heroPosition = $("heroPosition").value;
  for (const street of ["preflop", "flop", "turn", "river"]) {
    if (street !== "preflop" && !isStreetVisible(street)) continue;
    const state = combinedPotState(street, heroPosition);
    const potInput = $(`${street}PotSize`);
    const callInput = $(`${street}CallAmount`);
    const callField = $(`${street}CallField`);
    if (potInput) potInput.value = formatNumber(state.pot);
    if (callInput) callInput.value = formatNumber(state.amountToCall);
    if (callField) callField.classList.toggle("is-hidden", !state.facingBet);
  }
}

function parseCardsLenient(text) {
  try {
    return parseCards(text);
  } catch {
    return [];
  }
}

function parseVisibleBoardLenient() {
  try {
    return parseVisibleBoard();
  } catch {
    return [];
  }
}

function parseVisibleBoard() {
  const cards = isStreetVisible("flop") ? parseCards($("boardCards").value) : [];
  if (isStreetVisible("turn") && $("turnCard").value.trim()) cards.push(...parseCards($("turnCard").value, 1));
  if (isStreetVisible("river") && $("riverCard").value.trim()) cards.push(...parseCards($("riverCard").value, 1));
  return cards;
}

function activeStreet() {
  if (visibleStreet === "river") return "river";
  if (visibleStreet === "turn") return "turn";
  if (visibleStreet === "flop") return "flop";
  return "preflop";
}

function streetLabel(street) {
  return { preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River" }[street];
}

function requiredBoardCount(street) {
  return { flop: 3, turn: 4, river: 5 }[street] || 0;
}

function streetOrderIndex(street) {
  return { preflop: 0, flop: 1, turn: 2, river: 3 }[street] || 0;
}

function boardThroughStreet(boardCards, street) {
  const count = requiredBoardCount(street);
  return count ? boardCards.slice(0, count) : [];
}

function knownCardsThroughStreet(heroCards, boardCards, street) {
  return [...heroCards, ...boardThroughStreet(boardCards, street)];
}

function rangeSnapshot(range) {
  return {
    combos: range.combos.length,
    handClasses: (range.breakdown || [])
      .filter((item) => item.liveCount > 0)
      .map((item) => ({
        handClass: item.handClass,
        liveCount: item.liveCount,
        combos: item.combos.map(comboLabel),
      })),
  };
}

function sample(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function estimateEquity(heroCards, villainCombos, boardCards, iterations = 2200) {
  const known = new Set([...heroCards, ...boardCards]);
  const legalVillainCombos = villainCombos.filter((combo) => combo.every((card) => !known.has(card)));
  if (legalVillainCombos.length === 0) return 0;
  let wins = 0;
  let ties = 0;
  for (let i = 0; i < iterations; i += 1) {
    const villain = sample(legalVillainCombos);
    const used = new Set([...heroCards, ...villain, ...boardCards]);
    const remaining = deck().filter((card) => !used.has(card));
    const runout = [...boardCards];
    while (runout.length < 5) {
      const card = remaining.splice(Math.floor(Math.random() * remaining.length), 1)[0];
      runout.push(card);
    }
    const heroScore = bestSeven([...heroCards, ...runout]);
    const villainScore = bestSeven([...villain, ...runout]);
    if (heroScore > villainScore) wins += 1;
    if (heroScore === villainScore) ties += 1;
  }
  return (wins + ties / 2) / iterations;
}

// Hero's equity against each villain combo (exact from the flop on, see handEquity.js), bucketed as ahead /
// near flip / behind but drawing live / drawing thin or dead. `behind` counts both behind buckets, and
// `equity` is the mean over combos, so the headline number and the buckets always agree.
function classifyCombos(heroCards, villainCombos, boardCards, { potOdds = null } = {}) {
  if (HAND_EQUITY) {
    const matchups = HAND_EQUITY.rangeMatchups(heroCards, villainCombos, boardCards, { potOdds });
    const { ahead, close, live, thin } = matchups.buckets;
    return {
      ahead: ahead.length,
      behind: live.length + thin.length,
      close: close.length,
      live: live.length,
      thin: thin.length,
      equity: matchups.equity,
      exact: matchups.exact,
      averages: matchups.averages,
      potOdds: matchups.potOdds,
      priced: matchups.priced,
      total: matchups.total,
      buckets: matchups.buckets,
    };
  }
  const usable = villainCombos;
  if (usable.length === 0) return { ahead: 0, behind: 0, close: 0 };
  const result = { ahead: [], behind: [], close: [] };
  for (const combo of usable) {
    const equity = estimateEquity(heroCards, [combo], boardCards, 90);
    const item = { combo, equity };
    if (equity >= 0.525) result.ahead.push(item);
    else if (equity <= 0.475) result.behind.push(item);
    else result.close.push(item);
  }
  return {
    ahead: result.ahead.length,
    behind: result.behind.length,
    close: result.close.length,
    buckets: result,
  };
}

function rangePositionKey(position) {
  return position === "MP" ? "HJ" : position;
}

function inferPreflopSpot(actions, heroPosition, villainPosition) {
  if (PREFLOP_SPOT_MODEL) return PREFLOP_SPOT_MODEL.inferPreflopSpot(actions, heroPosition, villainPosition);
  return { action: "open", description: `${villainPosition} opened preflop` };
}

function blindBaseline(street) {
  if (street !== "preflop") return {};
  return { SB: 0.5, BB: 1 };
}

function calculateStreetPot(actions, heroPosition, street = "preflop") {
  const contributions = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  Object.assign(contributions, { ...contributions, ...blindBaseline(street) });
  let currentBet = Math.max(...Object.values(contributions));
  let lastAggressor = null;
  let lastActor = null;

  for (const item of actions) {
    const amount = Number(item.amount || 0);
    lastActor = item.actor;
    if (item.action === "open" || item.action === "bet" || item.action === "allin") {
      const add = Math.max(0, amount - contributions[item.actor]);
      contributions[item.actor] += add;
      currentBet = Math.max(currentBet, amount);
      lastAggressor = item.actor;
    } else if (item.action === "raise") {
      const add = Math.max(0, amount - contributions[item.actor]);
      contributions[item.actor] += add;
      currentBet = Math.max(currentBet, amount);
      lastAggressor = item.actor;
    } else if (item.action === "call") {
      const callAmount = Math.max(0, currentBet - contributions[item.actor]);
      contributions[item.actor] += callAmount || amount;
    }
  }

  const pot = Object.values(contributions).reduce((total, value) => total + value, 0);
  const amountToCall = Math.max(0, currentBet - contributions[heroPosition]);
  const facingBet = amountToCall > 0 && lastAggressor && lastAggressor !== heroPosition && lastActor !== heroPosition;
  return { pot, amountToCall: facingBet ? amountToCall : 0, facingBet, currentBet, lastAggressor };
}

function combinedPotState(street, heroPosition) {
  const preflop = calculateStreetPot(getActionSequence("preflop"), heroPosition, "preflop");
  if (street === "preflop") return preflop;
  let total = preflop.pot;
  let current = { pot: total, amountToCall: 0, facingBet: false };
  for (const nextStreet of ["flop", "turn", "river"]) {
    if (!isStreetVisible(nextStreet)) break;
    const streetPot = calculateStreetPot(getActionSequence(nextStreet), heroPosition, nextStreet);
    total += streetPot.pot;
    current = { ...streetPot, pot: total };
    if (nextStreet === street) return current;
  }
  return current;
}

function updateCallAmounts(street) {
  const rows = [...$(`${street}Actions`).querySelectorAll(".action-row")];
  const contributions = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
  Object.assign(contributions, { ...contributions, ...blindBaseline(street) });
  let currentBet = Math.max(...Object.values(contributions));

  for (const row of rows) {
    const actor = row.querySelector(".action-actor").value;
    const action = row.querySelector(".action-type").value;
    const amountInput = row.querySelector(".action-amount");
    if (action === "call") {
      const owed = Math.max(0, currentBet - contributions[actor]);
      amountInput.value = owed ? formatNumber(owed) : "";
      contributions[actor] += owed;
      continue;
    }
    const amount = Number(amountInput.value || 0);
    if (action === "open" || action === "bet" || action === "raise" || action === "allin") {
      const add = Math.max(0, amount - contributions[actor]);
      contributions[actor] += add;
      currentBet = Math.max(currentBet, amount);
    }
  }
}

function formatNumber(value) {
  return Number(value || 0).toFixed(2).replace(/\.?0+$/, "");
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function signed(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function bb(value) {
  return formatNumber(value);
}

function renderRows(target, rows) {
  target.innerHTML = rows
    .map(([label, value]) => `<div class="calc-row"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function renderRangeBreakdown(target, range, comboClass) {
  const staticRows = [
    ["Pocket pairs", range.combos.filter((combo) => combo[0][0] === combo[1][0]).length],
    ["Suited non-pairs", range.combos.filter((combo) => combo[0][0] !== combo[1][0] && combo[0][1] === combo[1][1]).length],
    ["Offsuit non-pairs", range.combos.filter((combo) => combo[0][0] !== combo[1][0] && combo[0][1] !== combo[1][1]).length],
  ];
  target.innerHTML = staticRows
    .map(([label, value]) => `<div class="calc-row"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
  renderEquityBuckets($("equityBuckets"), comboClass);
}

function renderEquityBuckets(target, comboClass) {
  if (!target) return;
  if (!comboClass.buckets.live) {
    const { ahead, behind, close } = comboClass.buckets;
    const total = Math.max(ahead.length + behind.length + close.length, 1);
    const share = (items) => `${((items.length / total) * 100).toFixed(1)}%`;
    target.innerHTML = `
      <div class="equity-bar" role="img" aria-label="${ahead.length} ahead, ${close.length} near flip, ${behind.length} behind">
        <span class="is-ahead" style="width:${share(ahead)}"></span>
        <span class="is-close" style="width:${share(close)}"></span>
        <span class="is-behind" style="width:${share(behind)}"></span>
      </div>
      <div class="combo-buckets">
        ${renderComboBucket("Hero is ahead of", ahead, "ahead")}
        ${renderComboBucket("Hero is behind", behind, "behind")}
        ${renderComboBucket("Near-flip region", close, "close")}
      </div>
    `;
    return;
  }
  const { ahead, close, live, thin } = comboClass.buckets;
  const total = Math.max(ahead.length + close.length + live.length + thin.length, 1);
  const share = (items) => `${((items.length / total) * 100).toFixed(1)}%`;
  const priceLine = Number.isFinite(comboClass.priced) && comboClass.potOdds
    ? `<p class="equity-price">You need ${pct(comboClass.potOdds)} equity to call, and have it against <strong>${comboClass.priced} of ${comboClass.total}</strong> villain combos.</p>`
    : "";
  target.innerHTML = `
    <div class="equity-bar" role="img" aria-label="${ahead.length} ahead, ${close.length} near flip, ${live.length} behind but live, ${thin.length} drawing thin or dead">
      <span class="is-ahead" style="width:${share(ahead)}"></span>
      <span class="is-close" style="width:${share(close)}"></span>
      <span class="is-behind" style="width:${share(live)}"></span>
      <span class="is-thin" style="width:${share(thin)}"></span>
    </div>
    ${priceLine}
    <div class="combo-buckets">
      ${renderComboBucket("Ahead", ahead, "ahead")}
      ${renderComboBucket("Near flip", close, "close")}
      ${renderComboBucket("Behind, live", live, "behind")}
      ${renderComboBucket("Thin or dead", thin, "thin")}
    </div>
    <p class="equity-method">Hero's equity against each combo: ahead 55%+, near flip 45–55%, behind but live 10–45%, thin or dead under 10%. ${comboClass.exact ? "Counted exactly over every remaining runout." : "Preflop: estimated from sampled runouts."}</p>
  `;
}

function renderComboBucket(label, items, tone = "", averageEquity = null) {
  const list =
    items.length > 0
      ? items
          .map(
            (item) =>
              `<li>${comboLabel(item.combo)} <span class="combo-note">${pct(item.equity)} hero equity</span></li>`,
          )
          .join("")
      : `<li>No combos in this bucket</li>`;
  return `
    <details class="combo-bucket"${tone ? ` data-tone="${tone}"` : ""}>
      <summary><span>${label}</span><strong>${items.length} combo${items.length === 1 ? "" : "s"}${Number.isFinite(averageEquity) ? ` <small class="bucket-avg">avg ${pct(averageEquity)}</small>` : ""}</strong></summary>
      <ul class="bucket-combo-list">${list}</ul>
    </details>
  `;
}

function renderTimelineSnapshot(stage) {
  const classes = stage.snapshot.handClasses || [];
  const handList = classes
    .map((item) => {
      const comboList = item.combos.length
        ? item.combos.map((combo) => `<li>${escapeHtml(combo)}</li>`).join("")
        : `<li class="blocked-combo">No live combos</li>`;
      return `
        <details class="timeline-hand-class">
          <summary><span>${escapeHtml(item.handClass)}</span><strong>${item.liveCount} combo${item.liveCount === 1 ? "" : "s"}</strong></summary>
          <ul class="bucket-combo-list">${comboList}</ul>
        </details>
      `;
    })
    .join("");

  return `
    <details class="range-stage" data-street="${escapeHtml(stage.street || "")}" ${stage.open ? "open" : ""}>
      <summary>
        <span>${escapeHtml(stage.title)}</span>
        <strong>${stage.snapshot.combos} combo${stage.snapshot.combos === 1 ? "" : "s"}</strong>
      </summary>
      <p>${escapeHtml(stage.description)}</p>
      <div class="timeline-class-list">${handList || `<div class="empty-state">No combos remain at this stage.</div>`}</div>
    </details>
  `;
}

function parseLLMStageRange(rangeText, knownCards) {
  if (!rangeText) return { range: null, error: "No range text returned." };
  try {
    return { range: parseRange(rangeText, knownCards), error: null };
  } catch (error) {
    return { range: null, error: error.message };
  }
}

function expectedLLMStreetSummaries(interpretation = {}) {
  const activeIndex = streetOrderIndex(interpretation.street || "preflop");
  const supplied = new Map(
    (interpretation.streetSummaries || [])
      .filter((item) => item?.street)
      .map((item) => [item.street, item]),
  );
  return ["preflop", "flop", "turn", "river"]
    .slice(0, activeIndex + 1)
    .map((street) => {
      const suppliedItem = supplied.get(street);
      if (suppliedItem) return suppliedItem;
      return {
        street,
        reasoning:
          street === interpretation.street
            ? interpretation.summary || "LLM final range for this street."
            : "The LLM did not provide a separate cumulative range for this street.",
        rangeText: street === interpretation.street ? interpretation.rangeText || "" : "",
      };
    });
}

function renderLLMRangeTimeline(target, interpretation = {}, heroCards = [], boardCards = [], finalParsedRange = null) {
  const summaries = expectedLLMStreetSummaries(interpretation);
  const stages = summaries.map((item, index, list) => {
    const isFinal = index === list.length - 1;
    const stageKnownCards = knownCardsThroughStreet(heroCards, boardCards, item.street || "preflop");
    const parsed = item.parsedRange
      ? { range: item.parsedRange, error: item.parseError || null }
      : isFinal && finalParsedRange
        ? { range: finalParsedRange, error: null }
        : parseLLMStageRange(item.rangeText, stageKnownCards);
    const parseNote = parsed.error ? ` Parser note: ${parsed.error}.` : "";
    return {
      street: item.street || interpretation.street || "preflop",
      rangeText: item.rangeText || "",
      reasoning: item.reasoning || "",
      title: `${streetLabel(item.street || interpretation.street || "preflop")} LLM interpretation`,
      description: [item.reasoning, item.rangeText ? `Range: ${item.rangeText}.` : "", parseNote].filter(Boolean).join(" "),
      snapshot: parsed.range ? rangeSnapshot(parsed.range) : { combos: 0, handClasses: [] },
      open: isFinal,
    };
  });

  if (!stages.length) {
    stages.push({
      street: interpretation.street || "preflop",
      rangeText: interpretation.rangeText || "",
      reasoning: interpretation.summary || "",
      title: `${streetLabel(interpretation.street || "preflop")} LLM interpretation`,
      description: interpretation.summary || "The LLM returned a current-street range interpretation.",
      snapshot: parsedRange ? rangeSnapshot(parsedRange) : { combos: 0, handClasses: [] },
      open: true,
    });
  }

  target.innerHTML = stages.map(renderTimelineSnapshot).join("");
  renderRangeSteps(
    (summaries.length ? summaries : [{ street: interpretation.street || "preflop" }])
      .map((item, index) => ({ street: item.street || interpretation.street || "preflop", combos: stages[index]?.snapshot?.combos ?? 0 })),
    interpretation.street || "preflop",
  );

  const byStreet = new Map(stages.map((stage) => [stage.street, stage]));
  activeRangeEvolution = { interpretation, byStreet, selectedStreet: interpretation.street || "preflop" };
  selectRangeStreet(interpretation.street || "preflop", { skipDetailToggle: true });
  renderRangeNarrowing($("rangeNarrowing"), summaries, stages);
}

const NARROWING_ROWS = [
  ["actionsOnStreet", "Villain's line"],
  ["removed", "Removed"],
  ["kept", "Kept"],
  ["notTaken", "Didn't do"],
  ["sizingRead", "Size read"],
];

// Best-effort scan of free-text narrowing prose for poker hand-class tokens (AA, AKs, K2s-K9s, A2s+, ...),
// so "kept" can be checked against what the street's own rangeText actually contains. Loose by design:
// this only flags a class as inconsistent when it parses cleanly and shares zero combos with rangeText,
// never on unparseable prose (so plain-English phrasing like "medium pairs" is silently skipped).
// Lookarounds instead of \b: skip numbers in prose ("~25% equity", "33%", "2.8bb", "(24 combos)", "+27 more"
// would otherwise read as hands 52/33/28/42/72), and keep a trailing "+" ("ATo+," has no word boundary after the "+").
const NARROWING_TOKEN_PATTERN = /(?<![\w.~$+])[2-9TJQKA]{2}[so]?(?:\+|-[2-9TJQKA]{2}[so]?)?(?![\w%]|\.\d|\s+(?:combos?|more|bb)\b)/g;
function findUnsupportedKeptClasses(keptText, rangeText) {
  if (!RANGE_NOTATION || !keptText || !rangeText) return [];
  const keptClasses = new Set();
  for (const token of keptText.match(NARROWING_TOKEN_PATTERN) || []) {
    const parsed = RANGE_NOTATION.parseRange(token, []);
    for (const handClass of parsed.classes || []) keptClasses.add(handClass);
  }
  if (!keptClasses.size) return [];
  const actualClasses = new Set(RANGE_NOTATION.parseRange(rangeText, []).classes || []);
  return [...keptClasses].filter((handClass) => !actualClasses.has(handClass));
}

const NARROWING_ROLE_COLORS = {
  "strong value": "#0f6e56",
  "thin value/showdown": "#185fa5",
  "draws/semi-bluffs": "#534ab7",
  "air/bluffs": "#5f5e5a",
};

// A one-to-two sentence summary of the list, with one row per hand group (what it is, how many combos, the
// reason) behind a toggle; each row opens to its exact hands.
function renderNarrowingGroups(title, groups, tone, summary = "") {
  if (!groups.length) return "";
  const total = groups.reduce((sum, group) => sum + (Number(group.combos) || 0), 0);
  const rows = groups
    .map(
      (group) => `<details class="ng-row ng-${tone}">
        <summary>
          <span class="ng-label"><i class="ng-dot" style="background:${NARROWING_ROLE_COLORS[group.role] || "#5f5e5a"}"></i>${escapeHtml(group.label)}</span>
          <span class="ng-count">${escapeHtml(group.combos)}</span>
          <span class="ng-why">${escapeHtml(group.why || "No reason recorded.")}</span>
        </summary>
        <p class="ng-hands">${escapeHtml(group.hands || "")}</p>
      </details>`,
    )
    .join("");
  const count = `${groups.length} group${groups.length === 1 ? "" : "s"}`;
  return `<section class="ng-list ng-list-${tone}">
    <h4><span>${title}</span><span>${total} combo${total === 1 ? "" : "s"}</span></h4>
    ${summary ? `<p class="ng-summary">${escapeHtml(summary)}</p>` : ""}
    <details class="ng-more"><summary>Show ${count}</summary>${rows}</details>
  </section>`;
}

// Explains each street's shrink from the LLM's `narrowing` fields; combo counts come from the parsed ranges.
function renderRangeNarrowing(target, summaries = [], stages = []) {
  if (!target) return;
  const cards = summaries
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => index > 0 && item.narrowing && typeof item.narrowing === "object")
    .map(({ item, index }) => {
      const before = stages[index - 1]?.snapshot?.combos;
      const after = stages[index]?.snapshot?.combos;
      const delta = Number.isFinite(before) && Number.isFinite(after) ? `${before} → ${after} combos` : "";
      // Group-decision ranges come with one row per group; the prose rows cover the rest of the street.
      const structured = Array.isArray(item.narrowing.keptGroups);
      const rows = NARROWING_ROWS.filter(([key]) => item.narrowing[key] && !(structured && (key === "kept" || key === "removed")))
        .map(([key, label]) => `<div class="narrowing-row"><span>${label}</span><p>${escapeHtml(item.narrowing[key])}</p></div>`)
        .join("");
      const listed = structured
        ? [...item.narrowing.keptGroups, ...(item.narrowing.removedGroups || [])].reduce((sum, group) => sum + (Number(group.combos) || 0), 0)
        : 0;
      // Kept + Removed covers the combos still possible on this board; the rest share a card with it.
      const blocked = structured && Number.isFinite(before) ? before - listed : 0;
      const groups = structured
        ? renderNarrowingGroups("Kept", item.narrowing.keptGroups, "keep", item.narrowing.keptSummary) +
          renderNarrowingGroups("Removed", item.narrowing.removedGroups || [], "drop", item.narrowing.removedSummary) +
          (blocked > 0
            ? `<p class="ng-note">${blocked} more combo${blocked === 1 ? "" : "s"} became impossible because ${blocked === 1 ? "it shares" : "they share"} a card with the new board.</p>`
            : "")
        : "";
      if (!rows && !groups) return "";
      const unsupported = findUnsupportedKeptClasses(item.narrowing.kept, item.rangeText);
      const warning = unsupported.length
        ? `<div class="narrowing-row narrowing-warning"><span>⚠ Inconsistent</span><p>The LLM's "kept" text names ${escapeHtml(unsupported.join(", "))}, but this street's actual range does not include ${unsupported.length === 1 ? "it" : "them"}. The chart and combo list below reflect the real range, not this description.</p></div>`
        : "";
      return `<div class="narrowing-card"><div class="narrowing-head"><strong>Why the range narrowed on the ${escapeHtml(streetLabel(item.street))}</strong><span>${escapeHtml(delta)}</span></div>${rows}${groups}${warning}</div>`;
    })
    .filter(Boolean);
  target.innerHTML = cards.join("");
}

const RANGE_STEP_STREETS = ["preflop", "flop", "turn", "river"];

// Preflop -> flop -> turn -> river combo counts; streets not reached yet show a dash. Reached streets
// are buttons so an earlier street's range can be pulled up in the matrix and detail panel below.
function renderRangeSteps(steps, currentStreet) {
  const target = $("rangeSteps");
  if (!target) return;
  target.innerHTML = RANGE_STEP_STREETS.map((street, index) => {
    const step = steps.find((item) => item.street === street);
    const current = street === currentStreet;
    const arrow = index ? `<span class="evo-arrow" aria-hidden="true">→</span>` : "";
    const tag = step ? "button" : "div";
    const attrs = step ? ` type="button" data-street="${street}"` : "";
    return `${arrow}<${tag} class="evo-step${current ? " is-current" : ""}${step ? "" : " is-pending"}"${attrs}><span>${streetLabel(street)}${current ? " · current" : ""}</span><b>${step ? step.combos : "—"}</b></${tag}>`;
  }).join("");
  if (target.dataset.wired !== "true") {
    target.dataset.wired = "true";
    target.addEventListener("click", (event) => {
      const button = event.target.closest("[data-street]");
      if (button) selectRangeStreet(button.getAttribute("data-street"));
    });
  }
}

// Switches which street's range the "Action buckets" matrix and the street-by-street detail
// highlight, without re-running analysis. The current street keeps its real LLM-assigned buckets; an
// earlier street only has a cumulative rangeText, so it renders as a single "in range" bucket.
function selectRangeStreet(street, options = {}) {
  if (!activeRangeEvolution) return;
  const stage = activeRangeEvolution.byStreet.get(street);
  if (!stage) return;
  activeRangeEvolution.selectedStreet = street;
  if (!options.fromStrip) selectAnalysisStreet(street, { fromRanges: true });

  $("rangeSteps")?.querySelectorAll("[data-street]").forEach((el) => {
    el.classList.toggle("is-selected", el.getAttribute("data-street") === street);
  });

  const bucketsTarget = $("actionBuckets");
  if (bucketsTarget) {
    const isCurrentStreet = street === (activeRangeEvolution.interpretation.street || "preflop");
    if (isCurrentStreet) {
      renderLLMWeightedGroups(bucketsTarget, activeRangeEvolution.interpretation);
    } else if (RANGE_BUCKET_MATRIX_VIEW && stage.rangeText) {
      RANGE_BUCKET_MATRIX_VIEW.renderBucketMatrix(
        bucketsTarget,
        [{ label: `${streetLabel(street)} range`, rangeText: stage.rangeText, reasoning: stage.reasoning }],
        { label: `Villain ${streetLabel(street)} range` },
      );
    } else {
      bucketsTarget.innerHTML = `<div class="empty-state">No range text captured for the ${escapeHtml(streetLabel(street))}.</div>`;
    }
  }

  if (!options.skipDetailToggle) {
    const details = document.querySelector(".evo-details");
    if (details && !details.open) details.open = true;
    const stagePanel = $("rangeTimeline")?.querySelector(`.range-stage[data-street="${street}"]`);
    if (stagePanel) {
      // Keep the detail panel in sync without moving the page: the user is looking at the steps and chart.
      $("rangeTimeline").querySelectorAll(".range-stage").forEach((panel) => { panel.open = panel === stagePanel; });
    }
  }
}

// The shared street strip under the analysis tabs: Ranges, Equity and AI Analysis all follow the street picked
// there. The analyzed street shows the live panels; an earlier street shows that street's own finished
// analysis from this hand when there is one, otherwise equity recomputed from that street's range.
const STREET_VIEW_PANELS = {
  equity: ["equityMetric", "potOddsMetric", "evLabel", "evMetric", "confluenceMetric", "equityBuckets", "boardTextureSummary"],
  ai: ["harringtonAnalysis", "pokerSkillAnalysis"],
};
let viewedAnalysisStreet = null;

function displayedAnalysisSpot() {
  const view = currentRangeViews.llm;
  return view?.status === "ready" ? view.payload?.spot || null : null;
}

function captureStreetView() {
  return Object.fromEntries(Object.values(STREET_VIEW_PANELS).flat().map((id) => {
    const element = $(id);
    return [id, { html: element?.innerHTML || "", className: element?.className || "" }];
  }));
}

function recordAnalysisStreetHistory() {
  const spot = displayedAnalysisSpot();
  if (spot) analysisStreetHistory?.record(spot, captureStreetView());
}

function resetAnalysisStreetView() {
  viewedAnalysisStreet = null;
  showStreetHistoryPanels(null);
  const strip = $("analysisStreetStrip");
  if (strip) {
    strip.hidden = true;
    strip.innerHTML = "";
  }
}

function renderAnalysisStreetStrip() {
  const strip = $("analysisStreetStrip");
  if (!strip) return;
  const spot = displayedAnalysisSpot();
  if (!spot) {
    resetAnalysisStreetView();
    return;
  }
  const current = spot.street || "preflop";
  const selected = viewedAnalysisStreet || current;
  strip.hidden = false;
  strip.innerHTML = `<span class="street-strip-label">Street</span>${RANGE_STEP_STREETS.map((street) => {
    const reached = streetOrderIndex(street) <= streetOrderIndex(current);
    const label = `${streetLabel(street)}${street === current ? " · current" : ""}`;
    return reached
      ? `<button type="button" class="street-strip-btn${street === current ? " is-current" : ""}" data-view-street="${street}" aria-pressed="${street === selected}">${label}</button>`
      : `<span class="street-strip-btn is-pending" aria-disabled="true">${label}</span>`;
  }).join("")}`;
  if (strip.dataset.wired !== "true") {
    strip.dataset.wired = "true";
    strip.addEventListener("click", (event) => {
      const button = event.target.closest("[data-view-street]");
      if (button) selectAnalysisStreet(button.getAttribute("data-view-street"));
    });
  }
}

function selectAnalysisStreet(street, { fromRanges = false } = {}) {
  const spot = displayedAnalysisSpot();
  if (!spot) {
    resetAnalysisStreetView();
    return;
  }
  const current = spot.street || "preflop";
  if (streetOrderIndex(street) > streetOrderIndex(current)) return;
  viewedAnalysisStreet = street === current ? null : street;
  if (!fromRanges && activeRangeEvolution?.byStreet.has(street)) {
    selectRangeStreet(street, { skipDetailToggle: true, fromStrip: true });
  }
  if (viewedAnalysisStreet) {
    const stored = analysisStreetHistory?.lookup(spot, street) || null;
    showStreetHistoryPanels({
      equity: streetHistoryNote(street, current, stored ? "equity" : "computed") + (stored ? storedPanelHtml("equity", stored) : computedEquityPanelHtml(street)),
      ai: streetHistoryNote(street, current, stored ? "ai" : "missing") + (stored ? storedPanelHtml("ai", stored) : ""),
    });
  } else {
    showStreetHistoryPanels(null);
  }
  renderAnalysisStreetStrip();
}

document.addEventListener("click", (event) => {
  if (event.target.closest?.("[data-view-street-back]")) selectAnalysisStreet(displayedAnalysisSpot()?.street || "preflop");
});

function showStreetHistoryPanels(content) {
  for (const name of Object.keys(STREET_VIEW_PANELS)) {
    const target = document.querySelector(`[data-street-history="${name}"]`);
    if (!target) continue;
    target.innerHTML = content ? content[name] || "" : "";
    target.closest(".analysis-panel")?.classList.toggle("is-viewing-history", Boolean(content));
  }
}

function streetHistoryNote(street, current, kind) {
  const text = {
    equity: `${streetLabel(street)} decision, as analyzed earlier in this hand.`,
    ai: `${streetLabel(street)} decision, as analyzed earlier in this hand.`,
    computed: `No ${streetLabel(street).toLowerCase()} decision was analyzed, so this is Hero's equity against villain's ${streetLabel(street).toLowerCase()} range on the ${streetLabel(street).toLowerCase()} board. Pot odds and EV need that decision's pot.`,
    missing: `No ${streetLabel(street).toLowerCase()} decision has been analyzed for this hand yet. Choose Hero's ${streetLabel(street).toLowerCase()} action in the hand timeline and run the analysis to see it here.`,
  }[kind];
  return `<div class="street-history-note"><p><strong>Viewing the ${escapeHtml(streetLabel(street))}.</strong> ${escapeHtml(text)}</p><button type="button" class="secondary-btn" data-view-street-back>Back to ${escapeHtml(streetLabel(current))}</button></div>`;
}

// Rebuilds the live panel's markup around the stored element contents, renaming ids so they stay unique.
function storedPanelHtml(name, stored) {
  const template = document.createElement("div");
  const panel = document.querySelector(`[data-street-history="${name}"]`)?.closest(".analysis-panel");
  for (const child of panel?.children || []) {
    if (!child.classList.contains("street-history-view")) template.append(child.cloneNode(true));
  }
  for (const id of STREET_VIEW_PANELS[name]) {
    const element = template.querySelector(`#${id}`);
    if (!element || !stored[id]) continue;
    element.innerHTML = stored[id].html;
    element.className = stored[id].className;
  }
  template.querySelectorAll("[id]").forEach((element) => {
    element.dataset.viewId = element.id;
    element.removeAttribute("id");
  });
  return template.innerHTML;
}

function computedEquityPanelHtml(street) {
  const view = currentRangeViews.llm;
  const summary = (view?.interpretation?.streetSummaries || []).find((item) => item.street === street);
  const heroCards = view?.heroCards || [];
  const boardCards = boardThroughStreet(view?.boardCards || [], street);
  let comboClass = null;
  try {
    const range = summary?.rangeText ? parseRange(summary.rangeText, [...heroCards, ...boardCards]) : null;
    if (range?.combos.length) comboClass = classifyCombos(heroCards, range.combos, boardCards);
  } catch {
    comboClass = null;
  }
  if (!comboClass) return `<p class="ws-empty">No ${escapeHtml(streetLabel(street).toLowerCase())} range was captured, so equity cannot be computed for that street.</p>`;
  const buckets = document.createElement("div");
  renderEquityBuckets(buckets, comboClass);
  const texture = document.createElement("div");
  texture.innerHTML = boardTextureSummaryHtml(boardCards, street);
  return `
    <div class="metric-grid">
      <div><span>Hero equity</span><strong data-view-id="equityMetric">${pct(comboClass.equity)}</strong></div>
      <div><span>Pot odds</span><strong>—</strong></div>
      <div><span>Equity share</span><strong>—</strong></div>
      <div><span>Villain combos</span><strong>${comboClass.total}</strong></div>
    </div>
    <article class="ws-card"><div class="ws-card-head"><span>Hand vs range</span></div><div class="equity-buckets">${buckets.innerHTML}</div></article>
    <article class="ws-card"><div class="ws-card-head"><span>Board texture</span></div><div class="board-texture-summary">${texture.innerHTML}</div></article>
  `;
}

const VILLAIN_LINE_LABEL = {
  open: "open",
  call_vs_open: "call vs open",
  "3bet_vs_open": "3-bet vs open",
  call_vs_3bet: "call vs 3-bet",
};

function rangeHeadLabel(view) {
  const position = view?.payload?.spot?.villainPosition;
  const line = VILLAIN_LINE_LABEL[view?.payload?.math?.villainAction];
  return position ? `Villain estimated range · ${position}${line ? ` ${line}` : ""}` : "Villain estimated range";
}

function renderLLMWeightedGroups(target, interpretation = {}) {
  const groups = interpretation.weightedGroups || [];
  if (!groups.length) {
    target.innerHTML = `<div class="empty-state">The LLM did not return weighted range groups.</div>`;
    return;
  }
  if (RANGE_BUCKET_MATRIX_VIEW) {
    RANGE_BUCKET_MATRIX_VIEW.renderBucketMatrix(target, groups, { label: "Villain range by action bucket" });
    return;
  }
  target.innerHTML = `
    <div class="range-group-list">
      ${groups
        .map(
          (group) => `
            <div class="range-group-card">
              <strong>${escapeHtml(group.label || "Range group")}</strong>
              <code>${escapeHtml(group.rangeText || "No range text")}</code>
              <span>${escapeHtml(group.reasoning || "")}</span>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderLLMRangeView(view) {
  if (!view) {
    $("rangeComboCount").textContent = "-";
    $("rangeText").textContent = "Run an analysis to ask the LLM for a separate range.";
    $("llmRangeMeta")?.classList.add("is-hidden");
    $("rangeTimeline").innerHTML = "";
    $("rangeSteps").innerHTML = "";
    $("rangeBreakdown").innerHTML = "";
    $("equityBuckets").innerHTML = `<p class="ws-empty">Ahead, behind, and near-flip combos appear after analysis.</p>`;
    $("actionBuckets").innerHTML = "";
    $("rangeDetails").innerHTML = "";
    activeRangeEvolution = null;
    resetAnalysisStreetView();
    return;
  }

  if (view.status === "loading") {
    $("rangeComboCount").textContent = "...";
    $("rangeText").textContent = "Asking the LLM to infer villain's current range from all villain actions through this street...";
    $("llmRangeMeta")?.classList.add("is-hidden");
    $("rangeTimeline").innerHTML = `<div class="empty-state">LLM range interpretation is running.</div>`;
    $("rangeSteps").innerHTML = "";
    $("rangeBreakdown").innerHTML = "";
    $("equityBuckets").innerHTML = `<p class="ws-empty">Ahead, behind, and near-flip combos appear after analysis.</p>`;
    $("actionBuckets").innerHTML = "";
    $("rangeDetails").innerHTML = "";
    activeRangeEvolution = null;
    resetAnalysisStreetView();
    return;
  }

  if (view.status === "error") {
    $("rangeComboCount").textContent = "-";
    $("rangeText").innerHTML = `
      <span>AI range analysis unavailable</span>
      <button id="retryLlmRangeBtn" class="secondary-btn range-retry-btn" type="button">Retry</button>
    `;
    appendDeveloperDiagnostic("Range analysis error", view.error);
    $("llmRangeMeta")?.classList.add("is-hidden");
    $("rangeTimeline").innerHTML = "";
    $("rangeSteps").innerHTML = "";
    $("rangeBreakdown").innerHTML = "";
    $("equityBuckets").innerHTML = `<p class="ws-empty">Ahead, behind, and near-flip combos appear after analysis.</p>`;
    $("actionBuckets").innerHTML = "";
    $("rangeDetails").innerHTML = "";
    activeRangeEvolution = null;
    resetAnalysisStreetView();
    return;
  }

  const interpretation = view.interpretation || {};
  const knownCards = knownCardsThroughStreet(
    view.heroCards || [],
    view.boardCards || [],
    interpretation.street || "preflop",
  );
  let parsedRange = null;
  let parseError = null;
  try {
    parsedRange = parseRange(interpretation.rangeText || "", knownCards);
  } catch (error) {
    parseError = error.message;
  }

  $("rangeComboCount").textContent = parsedRange ? `${parsedRange.combos.length} combos` : "LLM";
  $("rangeHeadLabel").textContent = rangeHeadLabel(view);
  $("rangeText").innerHTML = `
    <p class="range-summary">${escapeHtml(interpretation.summary || "LLM range interpretation complete.")}</p>
    <code class="range-notation">${escapeHtml(interpretation.rangeText || "No range text returned.")}</code>
  `;
  const meta = $("llmRangeMeta");
  if (meta) {
    meta.classList.remove("is-hidden");
    const drivers = (interpretation.keyDrivers || []).map(escapeHtml).join("; ");
    const caveats = (interpretation.caveats || []).map(escapeHtml).join("; ");
    meta.innerHTML = `
      <div class="range-meta-row">
        <span>Confidence <b>${escapeHtml(interpretation.confidence || "unknown")}</b></span>
        <span>Model <b>${escapeHtml(view.provider || "unknown")}:${escapeHtml(view.model || "unknown")}</b></span>
        ${drivers ? `<span>Drivers <b>${drivers}</b></span>` : ""}
      </div>
      ${
        parseError
          ? `<div><strong>Parser note:</strong> ${escapeHtml(parseError)}. Showing interpretation text and weighted groups only.</div>`
          : ""
      }
      ${
        parsedRange?.unrecognized?.length
          ? `<div class="range-warning"><strong>Ignored notation:</strong> ${parsedRange.unrecognized.map(escapeHtml).join(", ")} (not counted in combos)</div>`
          : ""
      }
      ${view.width ? rangeWidthMetaHtml(view.width) : ""}
      ${caveats ? `<p class="range-caveat">Caveat: ${caveats}</p>` : ""}
    `;
  }

  renderLLMRangeTimeline($("rangeTimeline"), interpretation, view.heroCards || [], view.boardCards || [], parsedRange);
  if (parsedRange) {
    renderRangeBreakdown($("rangeBreakdown"), parsedRange, classifyCombos(view.heroCards, parsedRange.combos, view.boardCards));
    renderDetailedRange($("rangeDetails"), parsedRange.breakdown);
  } else {
    $("rangeBreakdown").innerHTML = `<div class="empty-state">No parseable combo breakdown is available for this LLM range.</div>`;
    $("equityBuckets").innerHTML = `<p class="ws-empty">No parseable combos to compare against Hero.</p>`;
    $("rangeDetails").innerHTML = `<div class="empty-state">Exact possibilities appear when the LLM returns parseable poker range notation.</div>`;
  }
  renderLLMWeightedGroups($("actionBuckets"), interpretation);
}

function rangeWidthMetaHtml(width) {
  const percent = Number.isFinite(width.percent) ? `${width.percent.toFixed(1)}% of hands preflop` : "unknown";
  if (width.locked) return `<div><strong>Preflop width:</strong> ${percent} · kept from earlier in this hand</div>`;
  const band = width.band ? ` (expected ${width.band.min}–${width.band.max}% for ${escapeHtml(width.band.label)})` : "";
  const retried = (width.attempts || []).length > 1 ? ` · re-asked ${width.attempts.length - 1}×` : "";
  return width.withinBand === false
    ? `<div class="range-warning"><strong>Preflop width:</strong> ${percent}${band}${retried} · outside the expected band, treat equity with caution</div>`
    : `<div><strong>Preflop width:</strong> ${percent}${band}${retried}</div>`;
}

function renderActiveRangeView() {
  renderLLMRangeView(currentRangeViews.llm);
}

function retryLLMRangeInterpretation() {
  if (currentRangeViews.llm?.status === "loading") return;
  // Equity and AI reasoning depend on the AI range, so a retry reruns the whole analysis.
  analyze(null, lastAnalyzeArgs.cacheState, lastAnalyzeArgs.importedDecisionContext);
}

function cardLabel(card) {
  const suitNames = { c: "clubs", d: "diamonds", h: "hearts", s: "spades" };
  return `${card[0]}${card[1]} (${suitNames[card[1]]})`;
}

function comboLabel(combo) {
  return `${combo[0]} ${combo[1]}`;
}

function suitSymbol(suit) {
  return { c: "♣", d: "♦", h: "♥", s: "♠" }[suit] || suit;
}

function rankDisplay(rank) {
  return rank === "T" ? "10" : rank;
}

function cardHtml(card) {
  if (!card) return `<span class="card-rank">?</span><span class="card-suit">?</span>`;
  return `<span class="card-rank">${rankDisplay(card[0])}</span><span class="card-suit">${suitSymbol(card[1])}</span>`;
}

function renderCardElement(card, className = "playing-card") {
  const red = card && (card[1] === "h" || card[1] === "d");
  return `<div class="${className}${red ? " red" : ""}${card ? "" : " empty"}">${cardHtml(card)}</div>`;
}

function renderDetailedRange(target, breakdown) {
  if (breakdown.length === 0) {
    target.innerHTML = `<div class="empty-state">No combos remain after the selected action filter.</div>`;
    return;
  }
  target.innerHTML = breakdown
    .map((item) => {
      const combos =
        item.combos.length > 0
          ? item.combos
              .map((combo) => {
                const insight = item.insightMap?.get(comboLabel(combo));
                const note = insight ? `<span class="combo-note">${insight.label}</span>` : "";
                return `<li title="${cardLabel(combo[0])} and ${cardLabel(combo[1])}">${comboLabel(combo)}${note}</li>`;
              })
              .join("")
          : `<li class="blocked-combo">No live combos after blockers</li>`;
      return `
        <details class="combo-detail">
          <summary>
            <span>${item.handClass}</span>
            <strong>${item.liveCount}/${item.preActionCount || item.theoreticalCount} combos</strong>
          </summary>
          <ul>${combos}</ul>
          ${
            item.preActionCount && item.preActionCount !== item.liveCount
              ? `<p>${item.preActionCount - item.liveCount} combo${item.preActionCount - item.liveCount === 1 ? "" : "s"} removed by the cumulative action filters.</p>`
              : item.blockedCount > 0
                ? `<p>${item.blockedCount} combo${item.blockedCount === 1 ? "" : "s"} removed by hero or board blockers.</p>`
                : ""
          }
        </details>
      `;
    })
    .join("");
}

function updateCards(heroCards, boardCards = []) {
  const [a, b] = heroCards;
  for (const [element, card] of [
    [$("heroCardA"), a],
    [$("heroCardB"), b],
  ]) {
    element.innerHTML = cardHtml(card);
    element.classList.toggle("red", Boolean(card && (card[1] === "h" || card[1] === "d")));
    element.classList.toggle("empty", !card);
  }
  const boardSlots = [0, 1, 2, 3, 4].map((index) => renderCardElement(boardCards[index]));
  $("boardCardRow").innerHTML = boardSlots.join("");
}

function clearCardVisualization() {
  updateCards([null, null], []);
}

function updateCardVisualization() {
  let heroCards = [];
  let boardCards = [];
  try {
    heroCards = parseCards($("heroHand").value, 2);
  } catch {
    heroCards = [];
  }
  boardCards = parseVisibleBoardLenient();
  if (heroCards.length === 2) updateCards(heroCards, boardCards);
}

function recommend({ equity, potOdds, ev, confluence, heroClass }) {
  if (ev > 0 && confluence >= 68 && /[AKQJ]|TT|JJ|QQ|KK|AA/.test(heroClass)) return "Raise";
  if (ev >= 0 && equity >= potOdds) return "Call";
  return "Fold";
}

function recommendForNode(node, metrics) {
  let action;
  if (node.facingBet) action = recommend(metrics);
  else if (node.terminal) action = "Review";
  else action = metrics.equity >= 0.55 || metrics.confluence >= 66 ? "Bet" : "Check";
  return ACTION_POLICY?.constrainRecommendation(action, node, metrics) || action;
}

function createAnalysisId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix =
    window.crypto?.randomUUID?.().slice(0, 8) || Math.random().toString(36).slice(2, 10);
  return `pc_${stamp}_${suffix}`;
}

function rangeBreakdownLog(range) {
  return (range.breakdown || []).map((item) => ({
    handClass: item.handClass,
    theoreticalCount: item.theoreticalCount,
    preActionCount: item.preActionCount || null,
    liveCount: item.liveCount,
    blockedCount: item.blockedCount,
    combos: item.combos.map(comboLabel),
  }));
}

async function recordLocalAnalysisLog(payload) {
  try {
    await postJson("/api/analysis-log/start", payload);
  } catch (error) {
    console.warn(`Analysis log was not saved: ${error.message}`);
  }
}

const ANALYSIS_SNAPSHOT_ELEMENT_IDS = [
  "rangeComboCount",
  "rangeText",
  "llmRangeMeta",
  "rangeTimeline",
  "rangeBreakdown",
  "actionBuckets",
  "rangeDetails",
  "equityMetric",
  "potOddsMetric",
  "evMetric",
  "confluenceMetric",
  "calculationLog",
  "harringtonAnalysis",
  "pokerSkillAnalysis",
  "equityBuckets",
  "boardTextureSummary",
  "evLabel",
  "rangeSteps",
  "rangeHeadLabel",
  "solverResult",
  "summaryContext",
  "summaryVerdict",
  "flopOrderText",
  "turnOrderText",
  "riverOrderText",
];

function cloneCacheValue(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function importedDecisionCacheStateFromValues({
  street,
  index,
  heroName,
  heroPosition,
  villainPosition,
  heroHand,
  board,
  rows,
}) {
  return {
    importId: currentVisionImportId || "manual-import-session",
    heroName,
    street,
    index: Number(index),
    gameType: $("gameType")?.value || "",
    rangeMode: $("rangeMode")?.value || "",
    heroPosition: heroPosition || "",
    villainPosition: villainPosition || "",
    heroHand: heroHand || "",
    board: board || { flop: "", turn: "", river: "" },
    rows: rows || {},
  };
}

function importedDecisionCacheState(street, index, heroName) {
  return importedDecisionCacheStateFromValues({
    street,
    index,
    heroName,
    heroPosition: $("heroPosition")?.value || "",
    villainPosition: $("villainPosition")?.value || "",
    heroHand: $("heroHand")?.value || "",
    board: {
      flop: $("boardCards")?.value || "",
      turn: $("turnCard")?.value || "",
      river: $("riverCard")?.value || "",
    },
    rows: Object.fromEntries(["preflop", "flop", "turn", "river"].map((nextStreet) => [nextStreet, getActionSequence(nextStreet)])),
  });
}

function captureImportedAnalysisSnapshot() {
  return {
    rangeViews: cloneCacheValue(currentRangeViews),
    activeStreet: visibleStreet,
    elements: Object.fromEntries(
      ANALYSIS_SNAPSHOT_ELEMENT_IDS.map((id) => {
        const element = $(id);
        return [
          id,
          {
            html: element?.innerHTML || "",
            className: element?.className || "",
          },
        ];
      }),
    ),
  };
}

function restoreImportedAnalysisSnapshot(snapshot) {
  if (!snapshot) return false;
  analysisRequestId += 1;
  currentRangeViews = cloneCacheValue(snapshot.rangeViews || { llm: null });
  for (const [id, state] of Object.entries(snapshot.elements || {})) {
    const element = $(id);
    if (!element) continue;
    element.innerHTML = state.html || "";
    if (typeof state.className === "string") element.className = state.className;
  }
  // Rebuild the range view from the restored data so the street strip and range steps point at this decision.
  if (currentRangeViews.llm?.status === "ready") renderActiveRangeView();
  else resetAnalysisStreetView();
  updateCardVisualization();
  updateProgressiveControls();
  return true;
}

function saveImportedAnalysisSnapshot(cacheState) {
  if (!importedAnalysisCache || !cacheState) return;
  importedAnalysisCache.set(cacheState, captureImportedAnalysisSnapshot());
}

let lastAnalyzeArgs = { cacheState: null, importedDecisionContext: null };

// Reads the analyzer form into the request the AI endpoints receive. Kept free of result-panel rendering so
// imported decisions can be turned into requests ahead of time and prefetched.
function buildAnalysisRequest(importedDecisionContext = null) {
  const heroPosition = $("heroPosition").value;
  let villainPosition = $("villainPosition").value;
  const rangeMode = $("rangeMode")?.value || "loose";
  const preflopActions = getActionSequence("preflop");
  const heroCards = parseCards($("heroHand").value, 2);
  const street = activeStreet();
  const boardCards = street === "preflop" ? [] : parseVisibleBoard();
  const postflopRows = street === "preflop" ? [] : getActionSequence(street);
  if (street !== "preflop" && importedDecisionContext) {
    villainPosition = importedDecisionContext.primaryVillainPosition;
    if ($("villainPosition").value !== villainPosition) $("villainPosition").value = villainPosition;
  } else if (street !== "preflop") {
    const allPostflopRows = ["flop", "turn", "river"].flatMap((nextStreet) => getActionSequence(nextStreet));
    villainPosition = resolveVillainPosition(villainPosition, heroPosition, postflopRows, allPostflopRows);
    if ($("villainPosition").value !== villainPosition) $("villainPosition").value = villainPosition;
  }
  const order = postflopOrder(heroPosition, villainPosition);
  const preflopSpot = inferPreflopSpot(preflopActions, heroPosition, villainPosition);
  const sequence = sequenceFromRows(
    postflopRows,
    heroPosition,
    villainPosition,
    street !== "preflop" && boardCards.length >= requiredBoardCount(street),
    streetLabel(street),
  );
  if (street === "flop" && boardCards.length !== 3) {
    throw new Error("Enter exactly 3 flop cards before analyzing the flop.");
  }
  if (street === "turn" && boardCards.length !== 4) {
    throw new Error("Enter 3 flop cards and exactly 1 turn card before analyzing the turn.");
  }
  if (street === "river" && boardCards.length !== 5) {
    throw new Error("Enter flop, turn, and exactly 1 river card before analyzing the river.");
  }
  if (new Set([...heroCards, ...boardCards]).size !== heroCards.length + boardCards.length) {
    throw new Error("Hero hand and board cards cannot contain the same card.");
  }
  const potState = combinedPotState(street, heroPosition);
  const decisionNode = importedDecisionContext
    ? IMPORT_DECISION_MODEL.decisionNodeForImportedContext(importedDecisionContext, streetLabel(street))
    : currentDecisionNode(sequence);
  if (street === "preflop" && !importedDecisionContext) {
    decisionNode.facingBet = potState.facingBet;
    decisionNode.facingAllIn = false;
    decisionNode.terminal = !potState.facingBet;
    decisionNode.title = potState.facingBet ? "Preflop Node: Hero facing action" : "Preflop Node: sequence review";
    decisionNode.description = potState.facingBet
      ? "The preflop action sequence leaves hero facing a calculated call price."
      : "The preflop action sequence does not leave hero with an unresolved call decision.";
  } else if (potState.facingBet) {
    decisionNode.facingBet = true;
  }
  decisionNode.legalActions = ACTION_POLICY?.legalActionsForNode(decisionNode) || [];
  if (importedDecisionContext) {
    const validation = IMPORT_DECISION_MODEL.validateImportedDecisionNode(importedDecisionContext, decisionNode);
    if (!validation.valid) throw new Error(`Imported decision is inconsistent: ${validation.errors.join(" ")}`);
  }
  const isPostflopSpot = street !== "preflop";
  const pot = potState.pot;
  const call = decisionNode.facingBet ? potState.amountToCall : 0;
  const villainAction = preflopSpot.action;
  const heroClass = handClass(heroCards[0], heroCards[1]);
  const analysisId = createAnalysisId();
  const allStreetActions = Object.fromEntries(
    ["preflop", "flop", "turn", "river"]
      .filter((nextStreet) => streetOrderIndex(nextStreet) <= streetOrderIndex(street))
      .map((nextStreet) => [nextStreet, nextStreet === "preflop" || isStreetVisible(nextStreet) ? getActionSequence(nextStreet) : []]),
  );
  const spot = {
    analysisId,
    street,
    heroPosition,
    villainPosition,
    heroHand: heroCards.join(" "),
    board: boardCards.join(" "),
    rangeMode,
    preflopActions,
    streetActions: postflopRows,
    allStreetActions,
    actionLine:
      street === "preflop"
        ? preflopActions.map((row) => `${row.actor} ${row.action} ${row.amount || ""}`.trim()).join(" -> ")
        : actionSequenceText(sequence),
    decisionNode: decisionNode.title,
    decisionDescription: decisionNode.description,
    facingAllIn: decisionNode.facingAllIn || false,
    legalActions: decisionNode.legalActions,
    recordedHeroAction: decisionNode.recordedHeroAction || null,
    recordedHeroAmount: decisionNode.recordedHeroAmount || null,
    decisionOwner: RANGE_DECISION_CONTEXT?.rangeDecisionOwner(importedDecisionContext) || "hero",
  };
  const spotPayload = {
    analysisId,
    spot,
    math: {
      legalActions: decisionNode.legalActions,
      facingAllIn: decisionNode.facingAllIn || false,
      pot,
      call,
      heroClass,
      villainAction,
      boardTexture: boardTexture(boardCards),
    },
  };
  // A prefetched import decision keeps the prefetch's analysisId so its server logs land in one record.
  const prefetchedAnalysisId = importedPrefetchedAnalysisId(spotPayload);
  if (prefetchedAnalysisId) {
    spot.analysisId = prefetchedAnalysisId;
    spotPayload.analysisId = prefetchedAnalysisId;
  }
  return {
    heroPosition,
    villainPosition,
    rangeMode,
    preflopActions,
    heroCards,
    street,
    boardCards,
    postflopRows,
    order,
    preflopSpot,
    sequence,
    potState,
    decisionNode,
    isPostflopSpot,
    pot,
    call,
    villainAction,
    heroClass,
    analysisId: spotPayload.analysisId,
    allStreetActions,
    spot,
    spotPayload,
  };
}

async function analyze(triggerButton = null, cacheState = null, importedDecisionContext = null, options = {}) {
  if (!options.background) lastAnalyzeArgs = { cacheState, importedDecisionContext };
  const requestId = ++analysisRequestId;
  const requestSignal = analysisRequestCoordinator?.begin(requestId);
  const originMode = currentMode;
  let sessionToken = null;
  if (HAND_SESSION_MODEL) {
    const originSession = originMode === "import" ? importSession : manualSession;
    const started = HAND_SESSION_MODEL.beginRequest(originSession, "analysis");
    sessionToken = started.token;
    if (originMode === "import") importSession = started.session;
    else manualSession = started.session;
  }
  try {
    updateProgressiveControls();
    if (triggerButton) {
      triggerButton.disabled = true;
      triggerButton.dataset.originalText = triggerButton.textContent;
      triggerButton.textContent = "Calculating...";
    }

    const {
      heroPosition,
      villainPosition,
      rangeMode,
      preflopActions,
      heroCards,
      street,
      boardCards,
      postflopRows,
      order,
      preflopSpot,
      sequence,
      potState,
      decisionNode,
      isPostflopSpot,
      pot,
      call,
      villainAction,
      heroClass,
      analysisId,
      allStreetActions,
      spot,
      spotPayload,
    } = buildAnalysisRequest(importedDecisionContext);

    updateCards(heroCards, boardCards);
    if (isStreetVisible("flop")) {
      $("flopOrderText").textContent = `Postflop order: ${order.firstActor} acts first, then ${order.secondActor}. Current node: ${decisionNode.title}.`;
    }
    if (isStreetVisible("turn")) {
      $("turnOrderText").textContent = `Postflop order: ${order.firstActor} acts first, then ${order.secondActor}. Current node: ${decisionNode.title}.`;
    }
    if (isStreetVisible("river")) {
      $("riverOrderText").textContent = `Postflop order: ${order.firstActor} acts first, then ${order.secondActor}. Current node: ${decisionNode.title}.`;
    }
    currentRangeViews = { llm: { status: "loading" } };
    renderActiveRangeView();

    $("equityMetric").textContent = "...";
    $("potOddsMetric").textContent = decisionNode.facingBet ? pct(call / (pot + call)) : "N/A";
    $("evMetric").textContent = "...";
    $("confluenceMetric").textContent = "...";
    verdictState = { ai: null, skill: null, solver: null, node: decisionNode.title };
    $("summaryContext").textContent = summaryContextText(decisionNode, street, pot);
    renderSummaryVerdict("Analyzing…");
    renderBoardTextureSummary(boardCards, street);
    $("solverResult").innerHTML = street === "preflop"
      ? `<span>TexasSolver</span><strong>Not used preflop</strong><small>The solver checks flop, turn, and river spots.</small>`
      : `<span>TexasSolver</span><strong>Waiting for the AI range...</strong>`;
    analysisTabs?.setBusy("ai", true);
    $("harringtonAnalysis").innerHTML = `
      <p class="llm-status">Building a separate Harrington-style analysis from the local theory and style corpus...</p>
    `;
    $("pokerSkillAnalysis").innerHTML = `
      <p class="llm-status">Selecting PokerSkill-style layers and asking the LLM for a grounded recommendation...</p>
    `;
    $("calculationLog").innerHTML = calcRows([
      ["Analysis ID", analysisId],
      ["Villain range", "Waiting for the AI range interpretation..."],
    ]);

    // Harrington and PokerSkill never use a villain range, so they start immediately.
    const asyncPanels = [
      renderHarringtonAnalysis(spotPayload, requestId, requestSignal),
      renderPokerSkillAnalysis(spotPayload, requestId, requestSignal),
    ];

    const rangeView = await renderLLMRangeInterpretation(spotPayload, { heroCards, boardCards }, requestId, requestSignal);
    if (requestId !== analysisRequestId) return false;
    const interpretation = rangeView?.interpretation || {};
    let range = null;
    let rangeError = rangeView ? null : "AI range interpretation is unavailable.";
    if (rangeView) {
      try {
        range = parseRange(interpretation.rangeText || "", [...heroCards, ...boardCards]);
        if (!range.combos.length) rangeError = "The AI range has no live combos after removing Hero and board cards.";
        else if (range.unrecognized?.length) rangeError = `The AI range contains invalid notation (${range.unrecognized.join(", ")}), so part of villain's range would be silently dropped.`;
      } catch (error) {
        rangeError = `The AI range could not be parsed: ${error.message}`;
      }
    }

    if (rangeError) {
      ["equityMetric", "evMetric", "confluenceMetric"].forEach((id) => {
        $(id).textContent = "-";
      });
      if (street !== "preflop") $("solverResult").innerHTML = `<span>TexasSolver</span><strong>Skipped</strong><small>The solver needs villain's range.</small>`;
      renderSummaryVerdict("No range");
      $("calculationLog").innerHTML = calcRows([
        ["Analysis ID", analysisId],
        ["Villain range", escapeHtml(rangeError)],
      ]);
    } else {
      const rangeText = interpretation.rangeText;
      const rangeSource = `LLM range interpreter (${rangeView.provider || "unknown"}:${rangeView.model || "unknown"})`;
      const potOdds = decisionNode.facingBet ? call / (pot + call) : 0;
      const comboClass = classifyCombos(heroCards, range.combos, boardCards, { potOdds });
      const equity = Number.isFinite(comboClass.equity) ? comboClass.equity : estimateEquity(heroCards, range.combos, boardCards);
      const ev = decisionNode.facingBet ? equity * (pot + call) - call : equity * pot;
      const equityEdge = decisionNode.facingBet ? equity - potOdds : equity - 0.5;
      const comboPressure = (comboClass.ahead - comboClass.behind) / Math.max(range.combos.length, 1);
      const blockerScore = 1 - range.combos.length / Math.max(parseRange(rangeText, []).combos.length, 1);
      const equityComponent = equityEdge * 140;
      const comboComponent = comboPressure * 18;
      const blockerComponent = blockerScore * 14;
      const evComponent = ev > 0 ? 8 : -8;
      const confluence = Math.max(
        0,
        Math.min(100, 50 + equityComponent + comboComponent + blockerComponent + evComponent),
      );
      const formula = `50 + ${equityComponent.toFixed(1)} equity + ${comboComponent.toFixed(1)} combos + ${blockerComponent.toFixed(1)} blockers + ${evComponent.toFixed(1)} EV = ${confluence.toFixed(0)}`;
      const action = recommendForNode(decisionNode, { equity, potOdds, ev, confluence, heroClass });
      const className = action.toLowerCase();

      const analysisPayload = {
        analysisId,
        spot,
        math: {
          ...spotPayload.math,
          localBaselineRecommendation: action,
          equity,
          potOdds,
          ev,
          confluence,
          rangeText,
          rangeSource,
          rangeSummary: interpretation.summary || "",
          rangeConfidence: interpretation.confidence || null,
          combosTotal: range.combos.length,
          heroAheadCombos: comboClass.ahead,
          heroBehindCombos: comboClass.behind,
          nearFlipCombos: comboClass.close,
          rangeBreakdown: rangeBreakdownLog(range),
          finalComboList: range.combos.map(comboLabel),
        },
      };

      $("equityMetric").textContent = pct(equity);
      $("potOddsMetric").textContent = decisionNode.facingBet ? pct(potOdds) : "N/A";
      $("evLabel").textContent = decisionNode.facingBet ? "Call EV" : "Equity share";
      $("evMetric").textContent = `${signed(ev)} bb`;
      $("confluenceMetric").innerHTML = `${confluence.toFixed(0)}<small class="metric-scale">/100</small>`;


      $("calculationLog").innerHTML = `
        ${calcRows([
          ["Analysis ID", analysisId],
          ["Villain range", `${escapeHtml(rangeSource)} · ${escapeHtml(interpretation.confidence || "unknown")} confidence`],
          ["Estimated equity", `${pct(equity)} ${comboClass.exact ? "counted exactly over every runout" : "from sampled runouts"} against the AI range (average over its combos)`],
          [
            "Required equity",
            decisionNode.facingBet ? `${bb(call)} / (${bb(pot)} + ${bb(call)}) = ${pct(potOdds)}` : "Not applicable: hero is not facing a bet",
          ],
          [
            "Node EV",
            decisionNode.facingBet
              ? `${pct(equity)} * ${bb(pot + call)} - ${bb(call)} = ${signed(ev)} big blinds`
              : `${pct(equity)} * ${bb(pot)} current pot = ${signed(ev)} equity share`,
          ],
          ["Range blockers", `${range.combos.length} live combos after removing hero and board cards`],
          ...(isPostflopSpot
            ? [
                ["Decision node", decisionNode.title],
                ["Action sequence", actionSequenceText(sequence)],
                ["Board texture", boardTexture(boardCards)],
              ]
            : []),
          [
            "Combo comparison",
            Number.isFinite(comboClass.live)
              ? `${comboClass.ahead} ahead (≥55%) / ${comboClass.close} near flip (45–55%) / ${comboClass.live} behind but live (10–45%) / ${comboClass.thin} thin or dead (<10%)`
              : `${comboClass.ahead} ahead / ${comboClass.behind} behind / ${comboClass.close} close`,
          ],
          ["Confluence formula", formula],
        ])}
      `;
      if (street !== "preflop") {
        $("solverResult").innerHTML = `<span>TexasSolver</span><strong>Running solver check...</strong>`;
      }

      await recordLocalAnalysisLog({
        analysisId,
        importId: currentVisionImportId,
        local: {
          pokerFacts: analysisPayload.spot,
          math: analysisPayload.math,
          rangeAnalysis: {
            source: rangeSource,
            preflopAction: villainAction,
            preflopSpot,
            rangeText,
            finalCombos: range.combos.length,
            finalComboList: range.combos.map(comboLabel),
            streetSummaries: (interpretation.streetSummaries || []).map((item) => ({
              street: item.street,
              rangeText: item.rangeText,
              combos: item.snapshot?.combos ?? null,
            })),
            rangeBreakdown: rangeBreakdownLog(range),
          },
          recommendationInputs: {
            equity,
            potOdds,
            ev,
            confluence,
            comboClass,
            equityEdge,
            comboPressure,
            blockerScore,
            formula,
          },
        },
      });

      asyncPanels.push(renderLLMReasoning(analysisPayload, decisionNode, action, className, requestId, requestSignal));
      if (street !== "preflop") {
        asyncPanels.push(renderSolverRecommendation(analysisPayload, requestId, requestSignal));
      }
    }
    await Promise.all(asyncPanels);
    if (requestId === analysisRequestId) analysisTabs?.setBusy("ai", false);
    if (HAND_SESSION_MODEL && sessionToken && requestId === analysisRequestId && originMode === currentMode) {
      const activeSession = originMode === "import" ? importSession : manualSession;
      const accepted = HAND_SESSION_MODEL.acceptResult(activeSession, sessionToken, captureAnalysisSurface());
      if (accepted.accepted) {
        if (originMode === "import") importSession = accepted.session;
        else manualSession = accepted.session;
      }
    }
    const generationIsCurrent = !options.background || options.generation === importedPrefetchGeneration;
    if (requestId === analysisRequestId && generationIsCurrent) {
      saveImportedAnalysisSnapshot(cacheState);
      recordAnalysisStreetHistory();
    }
    return true;
  } catch (error) {
    const canRenderError = requestId === analysisRequestId &&
      (!options.background || options.generation === importedPrefetchGeneration);
    if (canRenderError) {
      renderSummaryVerdict("Check cards");
      analysisTabs?.setBusy("ai", false);
      $("harringtonAnalysis").innerHTML = `<p class="llm-status warning">Harrington-style analysis is waiting for a valid spot.</p>`;
      $("pokerSkillAnalysis").innerHTML = `<p class="llm-status warning">PokerSkill-style analysis is waiting for a valid spot.</p>`;
    }
    if (options.background) throw error;
    return false;
  } finally {
    analysisRequestCoordinator?.finish(requestId);
    if (triggerButton) {
      triggerButton.disabled = false;
      triggerButton.textContent = triggerButton.dataset.originalText || "Analyze";
    }
  }
}

async function renderSolverRecommendation(payload, requestId, signal) {
  const target = $("solverResult");
  if (!target) return;
  try {
    const result = await postJson("/api/solver/recommend", payload, signal);
    if (requestId !== analysisRequestId || !target.isConnected) return;
    if (!result.ok) {
      throw new Error(result.error || "TexasSolver request failed.");
    }
    const legalActions = payload?.math?.legalActions || payload?.spot?.legalActions || [];
    if (Array.isArray(legalActions) && legalActions.length && !legalActions.includes(result.recommendedAction)) {
      throw new Error(`TexasSolver returned ${result.recommendedAction}, but legal actions here are ${legalActions.join(" / ")}.`);
    }
    // The headline is the solver's pick; the small line lists the other actions it mixes in.
    const mix = result.mixedStrategy
      .filter((item) => item.action !== result.recommendedAction)
      .map((item) => `${escapeHtml(item.action)} ${(item.probability * 100).toFixed(1)}%`)
      .join(" / ");
    const checkRaise = result.checkRaiseNode?.actionCombos?.counts
      ? ` · check-raise node: ${Object.entries(result.checkRaiseNode.actionCombos.counts)
          .map(([action, count]) => `${escapeHtml(action)} ${count}`)
          .join(" / ")}`
      : "";
    verdictState.solver = result.recommendedAction;
    verdictState.solverConfidence = result.confidence;
    target.innerHTML = `
      <span>TexasSolver</span>
      <strong>${escapeHtml(result.recommendedAction)} ${(result.confidence * 100).toFixed(1)}%</strong>
      <small>${[mix, result.heroComboMatched ? `matched ${escapeHtml(result.heroComboMatched)}` : "", checkRaise.replace(/^ · /, "")].filter(Boolean).join(" · ")}</small>
      ${agreementBadgeHtml()}
    `;
    renderSummaryVerdict();
  } catch (error) {
    if (requestId !== analysisRequestId || !target.isConnected) return;
    target.innerHTML = `
      <span>TexasSolver</span>
      <strong>Unavailable</strong>
      <small>${escapeHtml(error.message)}</small>
    `;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function fetchServerHealth() {
  try {
    const response = await fetch(API_CLIENT?.resolveApiUrl("/api/health") || "/api/health", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    return response.ok
      ? `Server reachable. Model: ${payload.model || "unknown"}, import model: ${payload.importModel || "unknown"}.`
      : `Health check returned HTTP ${response.status}.`;
  } catch (error) {
    return `Health check failed: ${error.message}.`;
  }
}

async function postJson(url, payload, signal) {
  const urls = [API_CLIENT?.resolveApiUrl(url) || url];
  const failures = [];
  for (const nextUrl of urls) {
    try {
      return await postJsonOnce(nextUrl, payload, signal);
    } catch (error) {
      failures.push(error.message);
      if (!/HTTP (404|405)/.test(error.message)) break;
    }
  }
  throw new Error(failures.join(" | fallback: "));
}

async function postJsonOnce(url, payload, signal) {
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    const health = await fetchServerHealth();
    throw new Error(
      `Network request failed for ${url} from ${window.location.href}: ${error.message}. ${health} This usually means the local server restarted, the request was interrupted, or the browser could not reach localhost.`,
    );
  }

  const responseText = await response.text();
  let result = {};
  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch {
    result = { message: responseText.slice(0, 240) || "Response was not JSON." };
  }
  if (!response.ok) {
    const detail = result.error || result.message || "No error body returned.";
    const hint = result.hint ? ` Hint: ${result.hint}` : "";
    const allow = response.headers.get("allow");
    const originNote = ` Page origin: ${window.location.origin}. Client build: ${CLIENT_BUILD_ID}.`;
    const allowNote = allow ? ` Allow: ${allow}.` : "";
    throw new Error(`HTTP ${response.status} from ${url}: ${detail}${hint}${allowNote}${originNote}`);
  }
  return result;
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  const html = [];
  let listOpen = false;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex].trim();
    const table = ANALYSIS_PRESENTATION?.parseMarkdownTable(lines, lineIndex);
    if (table) {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
      html.push(markdownTableHtml(table));
      lineIndex = table.end - 1;
      continue;
    }
    if (!line) {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
      continue;
    }
    if (line.startsWith("### ")) {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
      html.push(`<h3>${inlineMarkdown(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
      html.push(`<h3>${inlineMarkdown(line.slice(3))}</h3>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
      html.push(`<h3>${inlineMarkdown(line.replace(/^\d+\.\s+/, ""))}</h3>`);
      continue;
    }
    if (line.startsWith("* ") || line.startsWith("- ")) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${inlineMarkdown(line.slice(2))}</li>`);
      continue;
    }
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
    html.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  if (listOpen) html.push("</ul>");
  return html.join("");
}

function markdownTableHtml(table) {
  const head = table.header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("");
  const cellHtml = (cell) => cell.split(/<br\s*\/?>/i).map(inlineMarkdown).join("<br>");
  const body = table.rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cellHtml(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function numericSummary(math = {}) {
  if (!Number.isFinite(math.equity)) return "The coach's full reasoning is below.";
  return `Hero has ${pct(math.equity)} equity against villain's ${math.combosTotal}-combo range: ahead of ${math.heroAheadCombos}, behind ${math.heroBehindCombos}.`;
}

// A short paragraph up front, with the complete analysis one click away.
function strategyBlurbHtml(analysis, fullLabel) {
  const blurb = ANALYSIS_PRESENTATION?.blurb(analysis) || "";
  return `
    ${blurb ? `<p class="ai-summary">${escapeHtml(blurb)}</p>` : ""}
    <details class="full-reasoning"${blurb ? "" : " open"}>
      <summary>${fullLabel}</summary>
      <div class="llm-analysis">${markdownToHtml(analysis)}</div>
    </details>
  `;
}

// The model's decision up front (action badge + size), its recommendation write-up, and the full analysis one click away.
function strategyDecisionHtml(decision, analysis, fullLabel) {
  if (!decision?.action) return strategyBlurbHtml(analysis, fullLabel);
  const writeup = decision.writeup || ANALYSIS_PRESENTATION?.blurb(analysis) || "";
  return `
    <div class="decision-box" data-tone="${ANALYSIS_PRESENTATION?.actionTone(decision.action) || "neutral"}">
      <div class="decision-head">
        ${verdictBadgeHtml(decision.action, "verdict-badge is-large")}
        ${decision.size ? `<span class="decision-size"><small>Size</small>${escapeHtml(decision.size)}</span>` : ""}
      </div>
      ${writeup ? `<div class="decision-writeup">${markdownToHtml(writeup)}</div>` : ""}
    </div>
    <details class="full-reasoning">
      <summary>${fullLabel}</summary>
      <div class="llm-analysis">${markdownToHtml(analysis)}</div>
    </details>
  `;
}

function verdictBadgeHtml(action, className = "verdict-badge") {
  const tone = ANALYSIS_PRESENTATION?.actionTone(action) || "neutral";
  return `<span class="${className}" data-tone="${tone}">${escapeHtml(action || "-")}</span>`;
}

function agreementBadgeHtml() {
  const aiAction = verdictState.skill || verdictState.ai;
  const agreement = ANALYSIS_PRESENTATION?.verdictAgreement(aiAction, verdictState.solver);
  if (!agreement) return "";
  return agreement === "agree"
    ? `<span class="agreement-badge" data-agreement="agree">✓ Matches ${verdictSourceLabel()}</span>`
    : `<span class="agreement-badge" data-agreement="disagree">≠ ${verdictSourceLabel()} says ${escapeHtml(aiAction)}</span>`;
}

function summaryContextText(decisionNode, street, pot) {
  const streetLabel = street.charAt(0).toUpperCase() + street.slice(1);
  const potText = Number.isFinite(pot) && pot > 0 ? ` · pot ${bb(pot)} bb` : "";
  const nodeLabel = String(decisionNode.title || "").replace(/^\w+ Node:\s*/i, "");
  return `${streetLabel} · ${nodeLabel}${potText}`;
}

function verdictSourceLabel() {
  return verdictState.skill ? "Skill-grounded" : "AI coach";
}

function renderSummaryVerdict(statusText = "") {
  const target = $("summaryVerdict");
  if (!target) return;
  const action = verdictState.skill || verdictState.ai;
  if (!action) {
    // While an analysis is running the summary must stay visible; the empty badge hides the workspace.
    const status = statusText || (verdictState.node ? "Analyzing…" : "");
    target.innerHTML = `<span class="verdict-badge" data-tone="neutral"${status ? "" : ' data-empty="true"'}>${escapeHtml(status || "Waiting for a spot")}</span>`;
    return;
  }
  const source = verdictSourceLabel();
  const agreement = ANALYSIS_PRESENTATION?.verdictAgreement(action, verdictState.solver);
  const solverPercent = Number.isFinite(verdictState.solverConfidence) ? ` ${(verdictState.solverConfidence * 100).toFixed(1)}%` : "";
  const solverText = verdictState.solver
    ? agreement === "agree"
      ? `<span class="agreement-badge" data-agreement="agree">✓ ${verdictSourceLabel()} and TexasSolver agree</span>`
      : `<span class="agreement-badge" data-agreement="disagree">≠ TexasSolver prefers ${escapeHtml(verdictState.solver)}</span>`
    : "";
  target.innerHTML = `
    ${verdictBadgeHtml(action, "verdict-badge is-large")}
    ${verdictState.solver ? "" : `<span class="summary-source">${source}</span>`}
    ${solverText}
    ${verdictState.solver ? `<span class="summary-solver">Solver: ${escapeHtml(verdictState.solver.toLowerCase())}${solverPercent}</span>` : ""}
  `;
}

function renderBoardTextureSummary(boardCards, street) {
  const target = $("boardTextureSummary");
  if (target) target.innerHTML = boardTextureSummaryHtml(boardCards, street);
}

function boardTextureSummaryHtml(boardCards, street) {
  if (!boardCards.length || street === "preflop") {
    return `<strong>No board yet</strong><span>Board texture appears from the flop onward.</span>`;
  }
  const [streetLabel, ...rest] = boardTexture(boardCards).split(":");
  const description = rest.join(":").trim() || streetLabel;
  const note = ANALYSIS_PRESENTATION?.boardNote(boardCards) || "";
  return `<strong>${escapeHtml(description.charAt(0).toUpperCase() + description.slice(1))}</strong><span>${escapeHtml(note)}</span><small>${escapeHtml(boardCards.map((card) => `${rankDisplay(card[0])}${suitSymbol(card[1])}`).join(" "))} · ${escapeHtml(streetLabel)}</small>`;
}

function modelTrailHtml(result) {
  const failures = result.modelFailures || [];
  const failedText = failures.length
    ? ` Failed first: ${failures.map((item) => `${item.model} (${item.error})`).join(" | ")}`
    : "";
  const provider = result.provider ? `${result.provider}:` : "";
  const attribution = PROVIDER_ATTRIBUTION?.attributionForResult(result);
  const attributionHtml = attribution
    ? `<p class="provider-attribution">${escapeHtml(attribution.label)} · ${escapeHtml(attribution.detail)}</p>`
    : "";
  appendDeveloperDiagnostic("Model routing", {
    provider: result.provider || "unknown",
    model: result.model || "unknown",
    failures,
  });
  if (attribution) appendDeveloperDiagnostic("Provider attribution", attribution);
  return "";
}

function conciseReasoning(text) {
  const summary = ANALYSIS_PRESENTATION?.summarizeReasoning(text);
  if (summary) return summary;
  const plain = String(text || "")
    .replace(/^#{1,6}\s+.*$/gm, " ")
    .replace(/^[-*]\s+/gm, "")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "Detailed reasoning is available below.";
  const sentences = plain.match(/[^.!?]+[.!?]+/g) || [plain];
  return sentences.slice(0, 3).join(" ").trim().slice(0, 620);
}

function renderPromptDebug(debug = {}) {
  if (!debug.prompt && !debug.systemInstruction) return "";
  const payload = {
    endpoint: debug.endpoint || "unknown",
    query: debug.query || null,
    spot: debug.spot || null,
    math: debug.math || null,
    selectedSkills: debug.selectedSkills || null,
  };
  appendDeveloperDiagnostic("Prompt debug", {
    systemInstruction: debug.systemInstruction || "",
    prompt: debug.prompt || "",
    request: payload,
  });
  return "";
}

async function renderLLMReasoning(payload, decisionNode, action, className, requestId, signal) {
  try {
    const result = await postJson("/api/analyze", payload, signal);
    if (requestId !== analysisRequestId) return;

    verdictState.ai = ANALYSIS_PRESENTATION?.extractRecommendedAction(result.analysis, decisionNode.legalActions) || null;
    modelTrailHtml(result);
    renderPromptDebug(result.debug);
    renderSummaryVerdict();
    if ($("solverResult")?.querySelector(".agreement-badge") || verdictState.solver) {
      $("solverResult").querySelector(".agreement-badge")?.remove();
      $("solverResult").insertAdjacentHTML("beforeend", agreementBadgeHtml());
    }
    postflopAnalysisView?.setData({
      aiAnalysis: result.analysis,
      boardTexture: payload?.spot?.boardTexture || payload?.boardTexture || null,
      equity: payload?.math?.equity == null ? null : {
        hero: Math.round(payload.math.equity * 1000) / 10,
        villain: Math.round((1 - payload.math.equity) * 1000) / 10,
      },
      villainRange: currentRangeViews.llm || null,
      rangeHistory: [],
    });
  } catch (error) {
    if (requestId !== analysisRequestId) return;
    renderSummaryVerdict();
    appendDeveloperDiagnostic("AI reasoning error", error.message);
  }
}

async function renderHarringtonAnalysis(payload, requestId, signal) {
  const target = $("harringtonAnalysis");
  if (!target) return;
  try {
    const result = await postJsonPrefetched("/api/analyze/harrington", payload, signal);
    if (requestId !== analysisRequestId) return;

    target.innerHTML = `
      ${modelTrailHtml(result)}
      ${strategyDecisionHtml(ANALYSIS_PRESENTATION?.extractDecision(result.analysis, payload.math?.legalActions), result.analysis, "Full Harrington analysis")}
      <details class="context-details">
        <summary>Retrieved Harrington context</summary>
        ${renderRetrievedHarringtonContext(result.retrievedContext)}
      </details>
      ${renderPromptDebug(result.debug)}
    `;
  } catch (error) {
    if (requestId !== analysisRequestId) return;
    target.innerHTML = `
      <p class="llm-status warning">Range reasoning is temporarily unavailable.</p>
      <p>The local PokeTerior calculation remains available above.</p>
    `;
    appendDeveloperDiagnostic("Range reasoning error", error.message);
  }
}

async function renderPokerSkillAnalysis(payload, requestId, signal) {
  const target = $("pokerSkillAnalysis");
  if (!target) return;
  try {
    const result = await postJsonPrefetched("/api/analyze/pokerskill", payload, signal);
    if (requestId !== analysisRequestId) return;

    const skillChips = (result.selectedSkills || [])
      .map((skill) => String(skill.title || skill.id || "").trim())
      .filter((title) => title && !/output contract/i.test(title))
      .map((title) => `<span class="chip">${escapeHtml(title.charAt(0) + title.slice(1).toLowerCase())}</span>`)
      .join("");
    const decision = ANALYSIS_PRESENTATION?.extractDecision(result.analysis, payload.math?.legalActions);
    verdictState.skill = decision?.action || null;
    renderSummaryVerdict();
    target.innerHTML = `
      ${modelTrailHtml(result)}
      ${strategyDecisionHtml(decision, result.analysis, "Full skill-grounded analysis")}
      ${skillChips ? `<div class="chip-row" aria-label="Skill layers used">${skillChips}</div>` : ""}
      <details class="context-details pokerskill-details">
        <summary>Selected PokerSkill-style layers</summary>
        ${renderPokerSkillLayers(result.selectedSkills)}
      </details>
      ${renderPromptDebug(result.debug)}
    `;
  } catch (error) {
    if (requestId !== analysisRequestId) return;
    target.innerHTML = `
      <p class="llm-status warning">Skill-grounded analysis is temporarily unavailable.</p>
      <p>The local PokeTerior calculation remains available above.</p>
    `;
    appendDeveloperDiagnostic("Skill-grounded analysis error", error.message);
  }
}

// Everything this hand already established about villain's range at this decision: the preflop range,
// streets to reuse verbatim (an exact earlier analysis of the same villain line, or one villain hasn't
// acted since), and bounds from other points in the hand - ceilings from a shorter line on a street,
// floors from a longer one (a later decision analyzed or prefetched first).
function rangeBoundsFor(spot) {
  const street = spot?.street;
  const lockedPreflop = PREFLOP_RANGE_LOCK?.get(spot) || null;
  const currentStreetLock = STREET_RANGE_LOCK?.get(spot, street);
  // Bounds go to the server as plain ranges; only a range reused verbatim (a lock) brings its reasons along.
  const ceilingsWithReasons = STREET_RANGE_LOCK?.ceilings?.(spot, street) || [];
  const floorsWithReasons = STREET_RANGE_LOCK?.floors?.(spot, street) || [];
  const ceilings = ceilingsWithReasons.map(({ street: s, rangeText, unchanged }) => ({ street: s, rangeText, unchanged }));
  const floors = floorsWithReasons.map(({ street: s, rangeText, unchanged }) => ({ street: s, rangeText, unchanged }));
  const withReasons = (lock) => (lock?.narrowing ? { narrowing: lock.narrowing, reasoning: lock.reasoning || "" } : {});
  const exactLocks = [
    ...(STREET_RANGE_LOCK?.priorLocks(spot, street) || []),
    ...(currentStreetLock ? [{ street, rangeText: currentStreetLock.rangeText, ...withReasons(currentStreetLock) }] : []),
  ];
  const streetLocks = [
    ...exactLocks,
    ...[...ceilingsWithReasons, ...floorsWithReasons]
      .filter((bound) => bound.unchanged && !exactLocks.some((lock) => lock.street === bound.street))
      .filter((bound, index, list) => list.findIndex((other) => other.street === bound.street) === index)
      .map((bound) => ({ street: bound.street, rangeText: bound.rangeText, ...withReasons(bound) })),
  ].sort((a, b) => ["flop", "turn", "river"].indexOf(a.street) - ["flop", "turn", "river"].indexOf(b.street));
  return { lockedPreflop, streetLocks, ceilings, floors };
}

// The range request carries this hand's established ranges so the model builds on them.
function buildRangePayload(payload) {
  const decisionSpot = RANGE_DECISION_CONTEXT ? RANGE_DECISION_CONTEXT.buildRangeDecisionContext(payload.spot) : payload.spot;
  const { lockedPreflop, streetLocks, ceilings, floors } = rangeBoundsFor(payload.spot);
  return {
    ...payload,
    spot: {
      ...decisionSpot,
      ...(lockedPreflop ? { lockedPreflopRange: { rangeText: lockedPreflop.rangeText } } : {}),
      ...(streetLocks.length ? { lockedPriorStreetRanges: streetLocks } : {}),
      ...(ceilings.length ? { rangeCeilings: ceilings } : {}),
      ...(floors.length ? { rangeFloors: floors } : {}),
    },
  };
}

// Sanitizes a range response and records what it established. Bounds are read again now, not taken
// from the request: the prefetch chain and the foreground request run in parallel, so another response
// for this hand may have landed while this one was in flight. Whichever lands first sets the range and
// later ones are made to agree with it, so two views of the same villain line can never differ.
function settleRangeResult(payload, rangePayload, result, context) {
  let interpretation = result.rangeInterpretation;
  if (LLM_RANGE_GUARD) {
    const bounds = rangeBoundsFor(payload.spot);
    interpretation = LLM_RANGE_GUARD.sanitizeLLMRangeInterpretation({
      interpretation: result.rangeInterpretation || {},
      parseRange,
      knownCardsThroughStreet,
      heroCards: context.heroCards || [],
      boardCards: context.boardCards || [],
      comboFactCheck: analyzeFlopCombo,
      freezeCurrentStreetToPriorRange: rangePayload.spot?.freezeToPriorStreetRange === true,
      locks: [
        ...(bounds.lockedPreflop ? [{ street: "preflop", rangeText: bounds.lockedPreflop.rangeText }] : []),
        ...bounds.streetLocks,
      ],
      ceilings: bounds.ceilings,
      floors: bounds.floors,
    });
  }
  // The preflop range shown is the one this hand keeps, even when its width is outside the expected band
  // (the band warning still shows): locking only in-band ranges let one decision display a preflop range
  // that every later decision contradicted. remember() keeps the first one.
  // Never keep a range that reads as zero combos (unparseable text): locking it would empty every later
  // street for the rest of the hand.
  const readable = (text) => Boolean(text) && parseRange(text, []).combos.length > 0;
  const preflopText = (interpretation?.streetSummaries || []).find((item) => item?.street === "preflop")?.rangeText ||
    (interpretation?.street === "preflop" ? interpretation.rangeText : "");
  if (readable(preflopText)) {
    PREFLOP_RANGE_LOCK?.remember(payload.spot, preflopText, { analysisId: payload.analysisId, percent: result.rangeWidth?.percent ?? null });
  }
  // Same for flop/turn/river: what this analysis showed is what later decisions build on.
  for (const summary of interpretation?.streetSummaries || []) {
    if (!summary?.street || summary.street === "preflop" || !readable(summary.rangeText)) continue;
    STREET_RANGE_LOCK?.remember(payload.spot, summary.street, summary.rangeText, {
      analysisId: payload.analysisId,
      // Keep the per-group reasons with the range, so a later street that reuses it can still show why.
      ...(Array.isArray(summary.narrowing?.keptGroups) ? { narrowing: summary.narrowing, reasoning: summary.reasoning || "" } : {}),
    });
  }
  return interpretation;
}

async function renderLLMRangeInterpretation(payload, context, requestId, signal) {
  const rangePayload = buildRangePayload(payload);
  currentRangeViews.llm = {
    status: "loading",
    payload: rangePayload,
    context,
  };
  renderActiveRangeView();
  try {
    const result = await postJsonPrefetched("/api/range/interpret", rangePayload, signal);
    if (requestId !== analysisRequestId) return null;
    const interpretation = settleRangeResult(payload, rangePayload, result, context);
    currentRangeViews.llm = {
      status: "ready",
      interpretation,
      width: result.rangeWidth || null,
      provider: result.provider,
      model: result.model,
      heroCards: context.heroCards,
      boardCards: context.boardCards,
      selectedSkills: result.selectedSkills || [],
      retrievedContext: result.retrievedContext || {},
      payload: rangePayload,
      context,
    };
    renderActiveRangeView();
    return currentRangeViews.llm;
  } catch (error) {
    if (requestId !== analysisRequestId) return null;
    currentRangeViews.llm = { status: "error", error: error.message, payload: rangePayload, context };
    renderActiveRangeView();
    return null;
  }
}

function renderPokerSkillLayers(skills = []) {
  if (!skills.length) return `<p>No skill layers were selected.</p>`;
  return skills
    .map(
      (skill) => `
        <div class="context-group skill-layer">
          <strong>${escapeHtml(skill.id || "")} ${escapeHtml(skill.title || "")}</strong>
          <span>${escapeHtml(skill.scope || "")}</span>
          ${
            Array.isArray(skill.bullets) && skill.bullets.length
              ? `<ul>${skill.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
              : `<p>No layer notes supplied.</p>`
          }
        </div>
      `,
    )
    .join("");
}

function renderRetrievedHarringtonContext(context = {}) {
  const theory = context.theory || [];
  const styleExamples = context.styleExamples || [];
  const renderList = (label, items) => `
    <div class="context-group">
      <strong>${label}</strong>
      ${
        items.length
          ? `<ul>${items
              .map(
                (item) =>
                  `<li>${escapeHtml(item.title)} <span>${escapeHtml(item.sourcePath)} · ${Number(item.score || 0).toFixed(2)}</span></li>`,
              )
              .join("")}</ul>`
          : `<p>No matching snippets retrieved.</p>`
      }
    </div>
  `;
  return `${renderList("Theory knowledge", theory)}${renderList("Style examples", styleExamples)}`;
}

function clearActionRows(street) {
  $(`${street}Actions`).innerHTML = "";
  refreshActionRows(street);
}

function resetResultPanels() {
  currentRangeViews = { llm: null };
  $("rangeComboCount").textContent = "-";
  $("rangeText").textContent = "Run an analysis to ask the LLM for villain range.";
  $("llmRangeMeta")?.classList.add("is-hidden");
  if ($("llmRangeMeta")) $("llmRangeMeta").innerHTML = "";
  $("rangeTimeline").innerHTML = "";
  $("rangeSteps").innerHTML = "";
  $("rangeBreakdown").innerHTML = "";
  $("actionBuckets").innerHTML = "";
  $("rangeDetails").innerHTML = "";
  activeRangeEvolution = null;
  resetAnalysisStreetView();
  $("equityMetric").textContent = "-";
  $("potOddsMetric").textContent = "-";
  $("evLabel").textContent = "Call EV";
  $("evMetric").textContent = "-";
  $("confluenceMetric").textContent = "-";
  $("calculationLog").textContent = "The calculation trail will appear here.";
  verdictState = { ai: null, skill: null, solver: null, solverConfidence: null, node: "" };
  $("summaryContext").textContent = "Enter the action and click analyze.";
  renderSummaryVerdict();
  $("equityBuckets").innerHTML = `<p class="ws-empty">Ahead, behind, and near-flip combos appear after analysis.</p>`;
  $("boardTextureSummary").innerHTML = `<p class="ws-empty">Structural observations appear after analysis.</p>`;
  $("rangeHeadLabel").textContent = "Villain estimated range";
  $("solverResult").innerHTML = `<span>TexasSolver</span><strong>Not run yet</strong><small>The solver checks flop, turn, and river spots.</small>`;
  analysisTabs?.setBusy("ai", false);
  $("harringtonAnalysis").innerHTML = "<p>Run an analysis to generate a Harrington-style coaching note.</p>";
  $("pokerSkillAnalysis").innerHTML = "<p>Run an analysis to generate a skill-grounded LLM recommendation.</p>";
}

function resetHand() {
  analysisRequestId += 1;
  analysisRequestCoordinator?.cancel();
  preflopBuilder?.reset();
  postflopBuilder?.reset();
  $("boardCards").value = "";
  $("turnCard").value = "";
  $("riverCard").value = "";

  for (const street of ["flop", "turn", "river"]) {
    clearActionRows(street);
  }

  setVisibleStreet("preflop");
  showManualBuilderStage("preflop");
  $("flopOrderText").textContent = "Postflop order will appear after analysis.";
  $("turnOrderText").textContent = "Turn action sequence uses the same postflop order.";
  $("riverOrderText").textContent = "River action sequence uses the same postflop order.";
  clearCardVisualization();
  updatePotReadouts();
  resetResultPanels();
}

function resetActiveHand() {
  if (currentMode !== "import") {
    resetHand();
    manualSession = HAND_SESSION_MODEL?.replaceHand(manualSession, preflopBuilder?.getState() || null, {}) || manualSession;
    return;
  }
  screenshotImportGeneration += 1;
  analysisRequestId += 1;
  cancelImportedAnalysisPrefetch();
  cancelImportedRequestPrefetch();
  importedAnalysisCache?.clear();
  importedHand = null;
  currentVisionImportId = null;
  importSession = HAND_SESSION_MODEL?.createSession("screenshot") || null;
  importWorkspace?.setSession({ converted: null, selectedDecisionKey: null });
  $("screenshotInput").value = "";
  $("importPreview").innerHTML = "";
  $("importPreview").classList.add("is-hidden");
  $("importSummary").innerHTML = "";
  $("importSummary").classList.add("is-hidden");
  $("importDecisions").innerHTML = "";
  $("importStatus").textContent = "No screenshot imported yet.";
  hideImportStages();
  setImportState("empty");
  resetResultPanels();
}

function calcRows(rows) {
  return rows.map(([label, value]) => `<div class="calc-row"><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function labelSequenceAction(action) {
  return {
    none: "no action",
    check: "checks",
    bet: "bets",
    call: "calls",
    fold: "folds",
    raise: "raises",
    allin: "moves all-in",
  }[action];
}

function actionSequenceText(sequence) {
  if (sequence.rows?.length) {
    return sequence.rows.map((row) => `${row.actor}: ${labelSequenceAction(row.action)}`).join(" -> ");
  }
  const parts = [`${sequence.firstActor}: ${labelSequenceAction(sequence.action1)}`];
  if (sequence.action2 !== "none") parts.push(`${sequence.secondActor}: ${labelSequenceAction(sequence.action2)}`);
  if (sequence.heroResponse !== "none") parts.push(`Hero response: ${labelSequenceAction(sequence.heroResponse)}`);
  return parts.join(" -> ");
}

function boardTexture(boardCards) {
  if (boardCards.length < 3) return "No flop entered.";
  const ranks = boardCards.map((card) => RANK_VALUE[card[0]]).sort((a, b) => b - a);
  const suits = boardCards.map((card) => card[1]);
  const paired = new Set(ranks).size < ranks.length;
  const monotone = new Set(suits).size === 1;
  const twoTone = new Set(suits).size === 2;
  const connected = ranks[0] - ranks[2] <= 4;
  const highCard = Object.entries(RANK_VALUE).find(([, value]) => value === ranks[0])?.[0] || "";
  const parts = [`${highCard}-high`];
  if (paired) parts.push("paired");
  if (monotone) parts.push("monotone");
  else if (twoTone) parts.push("two-tone");
  else parts.push("rainbow");
  if (connected) parts.push("connected");
  else parts.push("disconnected");
  const street = boardCards.length === 3 ? "flop" : boardCards.length === 4 ? "turn" : "river";
  return `${street}: ${parts.join(", ")}`;
}

function setMode(mode) {
  if (mode !== currentMode) saveAnalysisSurface(currentMode);
  if (mode !== currentMode) {
    analysisRequestId += 1;
    analysisRequestCoordinator?.cancel();
  }
  currentMode = mode;
  $("manualModeBtn").classList.toggle("is-active", mode === "manual");
  $("importModeBtn").classList.toggle("is-active", mode === "import");
  $("importSection").classList.toggle("is-hidden", mode !== "import");
  document.querySelectorAll(".manual-mode").forEach((element) => {
    element.classList.toggle("is-hidden", mode !== "manual");
  });
  if (mode === "manual") setVisibleStreet(visibleStreet);
  restoreAnalysisSurface(mode);
}

const ANALYSIS_SURFACE_IDS = [
  "rangeComboCount", "rangeText", "llmRangeMeta", "rangeTimeline", "rangeBreakdown", "actionBuckets",
  "rangeDetails", "heroCardA", "heroCardB", "boardCardRow", "equityMetric",
  "potOddsMetric", "evMetric", "confluenceMetric", "calculationLog", "harringtonAnalysis", "pokerSkillAnalysis",
  "equityBuckets", "boardTextureSummary", "evLabel", "rangeSteps", "rangeHeadLabel", "solverResult", "summaryContext", "summaryVerdict",
];

function captureAnalysisSurface() {
  return Object.fromEntries(ANALYSIS_SURFACE_IDS.map((id) => {
    const element = $(id);
    return [id, element ? { html: element.innerHTML, className: element.className } : null];
  }));
}

function saveAnalysisSurface(mode) {
  if (!HAND_SESSION_MODEL) return;
  const session = mode === "import" ? importSession : manualSession;
  if (!session) return;
  const selected = session.selectedDecision ? session : HAND_SESSION_MODEL.selectDecision(session, { key: "current" });
  const started = HAND_SESSION_MODEL.beginRequest(selected, "surface");
  const accepted = HAND_SESSION_MODEL.acceptResult(started.session, started.token, captureAnalysisSurface());
  if (mode === "import") importSession = accepted.session;
  else manualSession = accepted.session;
}

function restoreAnalysisSurface(mode) {
  resetAnalysisStreetView();
  const session = mode === "import" ? importSession : manualSession;
  const key = session?.selectedDecision?.key || "current";
  const snapshot = session?.analysisState?.byDecision?.[key];
  if (!snapshot) {
    resetResultPanels();
    return;
  }
  for (const [id, state] of Object.entries(snapshot)) {
    const element = $(id);
    if (!element || !state) continue;
    element.innerHTML = state.html;
    element.className = state.className;
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const dataUrl = String(reader.result || "");
      try {
        resolve(SCREENSHOT_UPLOAD_MODEL?.dataUrlPayload?.(dataUrl, file.type || "image/png") || { dataUrl });
      } catch (error) {
        reject(error);
      }
    });
    reader.addEventListener("error", () => reject(new Error("Could not read the screenshot file.")));
    reader.readAsDataURL(file);
  });
}

function loadDataUrlImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("Could not decode the screenshot image.")), { once: true });
    image.src = dataUrl;
  });
}

async function fileToPayload(file) {
  const originalPayload = await readFileAsDataUrl(file);
  const originalDataUrl = originalPayload.dataUrl;
  const image = await loadDataUrlImage(originalDataUrl);
  const dimensions = SCREENSHOT_UPLOAD_MODEL?.uploadDimensions?.({ width: image.naturalWidth, height: image.naturalHeight });
  const dataUrl = !dimensions?.resized
    ? originalDataUrl
    : (() => {
        const canvas = document.createElement("canvas");
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        canvas.getContext("2d").drawImage(image, 0, 0, dimensions.width, dimensions.height);
        return canvas.toDataURL("image/jpeg", 0.9);
      })();
  return SCREENSHOT_UPLOAD_MODEL?.dataUrlPayload?.(dataUrl, file.type || "image/png") || originalPayload;
}

// ---- Import Engine V2 (feature-gated; the full-image importer below stays the default and the fallback) ----------
let importEngineCapabilities;

async function loadImportEngineCapabilities() {
  if (importEngineCapabilities) return importEngineCapabilities;
  try {
    const response = await fetch(API_CLIENT?.resolveApiUrl("/api/health") || "/api/health", { cache: "no-store" });
    if (!response.ok) return null;
    const health = await response.json();
    importEngineCapabilities = {
      importEngineV2Enabled: Boolean(health.importEngineV2Enabled),
      importEngineV2Sites: health.importEngineV2Sites || [],
      importEngineV2Debug: Boolean(health.importEngineV2Debug),
    };
    return importEngineCapabilities;
  } catch {
    return null;
  }
}

// "empty" (nothing yet), "reading" (upload in flight), "review" (hand imported), "failed" (import error).
// CSS keys the whole import layout off this attribute.
function setImportState(state) {
  const section = $("importSection");
  if (section) section.dataset.importState = state;
}

function hideImportStages() {
  const stages = $("importStages");
  if (!stages) return;
  stages.innerHTML = "";
  stages.classList.add("is-hidden");
}

function renderImportStages(snapshot, change) {
  const stages = $("importStages");
  if (!stages || !IMPORT_PROGRESS_VIEW) return;
  stages.classList.remove("is-hidden");
  stages.innerHTML = IMPORT_PROGRESS_VIEW.renderProgressMarkup(snapshot, change);
}

// Returns true when V2 handled the upload (or a newer upload superseded it) and false when the unchanged
// full-image importer should run. A failed or non-replayable V2 result never touches the current session.
async function attemptImportEngineV2(file, importGeneration) {
  const stale = () => importGeneration !== screenshotImportGeneration;
  const capabilities = await loadImportEngineCapabilities();
  if (stale()) return true;
  if (!IMPORT_DISPATCH || !capabilities?.importEngineV2Enabled) return false;
  const runtime = window.PokerCoachImportRuntime || null;
  let prepared = null;
  try {
    prepared = runtime ? await runtime.prepare(file) : null;
  } catch {
    prepared = null;
  }
  if (stale()) return true;
  if (IMPORT_DISPATCH.chooseRoute({ capabilities, runtime, detection: prepared?.detection }).route !== "v2") return false;

  const importId = `imp_v2_${Date.now().toString(36)}`;
  $("importStatus").textContent = "Reading the screenshot with the local import engine...";
  try {
    const result = await prepared.createEngine({ postJson }).import(prepared.source, {
      importId,
      anchors: prepared.anchors,
      onProgress: (snapshot, change) => {
        if (!stale()) renderImportStages(snapshot, change);
      },
    });
    if (stale()) return true;
    if (!IMPORT_DISPATCH.isReplayable(result)) {
      throw new Error(result?.route === "legacy" ? `layout not handled: ${result.reason}` : "no replayable hand was recognized");
    }
    const label = IMPORT_DISPATCH.providerLabel(result);
    const nextHand = normalizeImportedHand(IMPORT_DISPATCH.legacyHandFromResult(result));
    let converted = null;
    let nextSession = importSession;
    if (IMPORT_BUILDER_ADAPTER && HAND_SESSION_MODEL) {
      converted = IMPORT_BUILDER_ADAPTER.fromImportedHand(nextHand, {
        heroName: IMPORT_DECISION_MODEL?.resolveImportedHeroName(nextHand, nextHand.heroName),
      });
      nextSession = HAND_SESSION_MODEL.replaceHand(importSession, converted, { importId, provider: label.provider, model: label.model });
    }
    // Commit only after every conversion succeeded so a failure leaves the previous import intact.
    currentVisionImportId = importId;
    importedHand = nextHand;
    importSession = nextSession;
    if (converted) {
      importedAnalysisCache?.clear();
      importWorkspace?.setSession({ converted, selectedDecisionKey: null });
    }
    $("importPreview").classList.remove("is-hidden");
    showImportPreview(URL.createObjectURL(file));
    $("importStatus").textContent = `Imported with the local import engine (${label.model}). Review any highlighted fields before running analysis.`;
    renderImportedHand();
    return true;
  } catch (error) {
    if (stale()) return true;
    $("importStatus").textContent = `The local import engine could not finish (${error.message}); using the full-image importer...`;
    return false;
  }
}

function focusImportField(ref) {
  const target = IMPORT_PROGRESS_VIEW?.resolveFieldRef(ref);
  if (!target) return;
  if (target.kind === "cards") {
    importCardReviewRequested = true;
    $("importSummary")?.classList.remove("is-collapsed");
    const input = $(target.inputId);
    input?.scrollIntoView?.({ block: "center" });
    input?.focus();
    return;
  }
  const button = $("importBuilderWorkspace")?.querySelector(`[data-decision-key="${target.decisionKey}"]`);
  if (!button || button.disabled) return;
  button.click();
  $("importBuilderWorkspace").querySelector("[data-import-edit-form]")?.elements?.[target.control === "amountBb" ? "amountBb" : "action"]?.focus();
}

async function importScreenshotFile(file) {
  if (!file) return;
  const importGeneration = ++screenshotImportGeneration;
  const progress = IMPORT_PROGRESS_MODEL?.create({
    setStatus: (message) => {
      if (importGeneration === screenshotImportGeneration) $("importStatus").textContent = message;
    },
  });
  cancelImportedAnalysisPrefetch();
  cancelImportedRequestPrefetch();
  importCardReviewRequested = false;
  setImportState("reading");
  $("importStatus").textContent = "Reading screenshot...";
  hideImportStages();
  if (await attemptImportEngineV2(file, importGeneration)) return;
  try {
    const payload = await fileToPayload(file);
    if (importGeneration !== screenshotImportGeneration) return;
    $("importStatus").textContent = "Extracting hand history with vision model...";
    progress?.start();
    const result = await postJson("/api/import/screenshot", {
      imageBase64: payload.imageBase64,
      mimeType: payload.mimeType,
    });
    if (importGeneration !== screenshotImportGeneration) return;
    currentVisionImportId = result.importId || null;
    importedHand = normalizeImportedHand(result.hand || {});
    importedHand.validationWarnings = result.validationWarnings || [];
    importedHand.actionAttribution = result.actionAttribution || importedHand.actionAttribution || { safe: true, issues: [] };
    if (IMPORT_BUILDER_ADAPTER && HAND_SESSION_MODEL) {
      const converted = IMPORT_BUILDER_ADAPTER.fromImportedHand(importedHand, {
        heroName: IMPORT_DECISION_MODEL?.resolveImportedHeroName(importedHand, importedHand.heroName),
      });
      importSession = HAND_SESSION_MODEL.replaceHand(importSession, converted, {
        importId: result.importId || null,
        provider: result.provider || "vision",
        model: result.model || null,
      });
      importedAnalysisCache?.clear();
      importWorkspace?.setSession({ converted, selectedDecisionKey: null });
    }
    $("importPreview").classList.remove("is-hidden");
    showImportPreview(payload.dataUrl);
    $("importStatus").textContent = `Imported with ${result.provider || "vision"} ${result.model}. Review the extracted hand before running analysis.`;
    renderImportedHand();
  } catch (error) {
    if (importGeneration !== screenshotImportGeneration) return;
    $("importStatus").textContent = `Import failed: ${error.message}`;
    setImportState("failed");
  } finally {
    progress?.stop();
  }
}

function normalizeImportedHand(hand) {
  const streets = hand.streets || {};
  for (const street of ["preflop", "flop", "turn", "river"]) {
    streets[street] = streets[street] || { potBb: null, actions: [] };
    streets[street].actions = (streets[street].actions || [])
      .map((action) => ({
        actor: action.actor || null,
        position: normalizePosition(action.position),
        action: normalizeImportedAction(action.action),
        amountBb: action.amountBb == null ? null : Number(action.amountBb),
      }))
      .filter((action) => !["refund", "win", "muck"].includes(action.action));
  }
  const normalized = {
    ...hand,
    heroHand: normalizeImportedCards(hand.heroHand || []),
    board: {
      flop: normalizeImportedCards(hand.board?.flop || []),
      turn: normalizeImportedCards(hand.board?.turn ? [hand.board.turn] : [])[0] || null,
      river: normalizeImportedCards(hand.board?.river ? [hand.board.river] : [])[0] || null,
    },
    players: (hand.players || []).map((player) => ({
      ...player,
      position: normalizePosition(player.position),
      stackBb: player.stackBb == null ? null : Number(player.stackBb),
      isHero: Boolean(player.isHero),
    })),
    streets,
    confidenceNotes: hand.confidenceNotes || [],
  };
  IMPORT_HERO_CARD_MODEL?.initializeCardOwnership(normalized);
  repairHeadsUpImportedActors(normalized);
  return normalized;
}

function normalizePosition(position) {
  if (!position) return null;
  const upper = String(position).toUpperCase();
  return upper === "HJ" ? "MP" : upper;
}

function normalizeImportedAction(action) {
  const raw = String(action || "").toLowerCase();
  const compact = raw.replace(/[^a-z]/g, "");
  if (/\breturn(?:ed)?\b|\brefund(?:ed)?\b|\buncalled\b|\bcollect(?:s|ed)?\b|\bwin(?:s|ner)?\b/.test(raw)) return "refund";
  if (/\bmuck(?:s|ed)?\b/.test(raw) || compact === "muck") return "muck";
  if (/\ball[\s-]?in\b|\bshove[sd]?\b|\bjam(?:s|med)?\b/.test(raw) || compact === "allin") return "allin";
  if (/\braise[sd]?\b|\breraised?\b/.test(raw) || compact === "raise") return "raise";
  if (/\bbet[st]?\b/.test(raw) || compact === "bet") return "bet";
  if (/\bcall(?:s|ed)?\b/.test(raw) || compact === "call") return "call";
  if (/\bcheck(?:s|ed)?\b/.test(raw) || compact === "check") return "check";
  if (/\bfold(?:s|ed)?\b/.test(raw) || compact === "fold") return "fold";
  if (/\bante\b/.test(raw) || compact === "ante") return "ante";
  if (/\bblind\b/.test(raw) || compact === "sb" || compact === "bb") return "blind";
  return "check";
}

function normalizeImportedCards(cards) {
  return cards
    .map((card) => {
      try {
        return normalizeCard(String(card));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function repairHeadsUpImportedActors(hand) {
  const heroName = hand.heroName || hand.players.find((player) => player.isHero)?.name || "";
  const heroPosition = hand.players.find((player) => player.name === heroName || player.isHero)?.position || null;
  if (!heroPosition) return;

  const positionFor = (action) =>
    normalizePosition(action.position) || hand.players.find((player) => player.name === action.actor)?.position || null;
  const heroActor = hand.players.find((player) => player.position === heroPosition)?.name || heroName;
  for (const street of ["flop", "turn", "river"]) {
    const actions = hand.streets[street]?.actions || [];
    let previous = null;
    for (const action of actions) {
      if (["blind", "ante", "refund", "win", "muck"].includes(action.action)) continue;
      const position = positionFor(action);
      if (
        previous &&
        position &&
        position === positionFor(previous) &&
        position !== heroPosition &&
        ["call", "fold"].includes(action.action)
      ) {
        action.actor = heroActor;
        action.position = heroPosition;
      }
      previous = action;
    }
  }
}

function selectedImportedHeroName() {
  return IMPORT_DECISION_MODEL?.resolveImportedHeroName(importedHand, $("importHeroSelect")?.value) ||
    $("importHeroSelect")?.value ||
    importedHand?.heroName ||
    importedHand?.players.find((player) => player.isHero)?.name ||
    "";
}

function importedPlayerByName(name) {
  return importedHand?.players.find((player) => player.name === name) || null;
}

function actorPosition(action) {
  if (IMPORT_DECISION_MODEL) return IMPORT_DECISION_MODEL.actorPosition(importedHand, action);
  return normalizePosition(action.position) || importedPlayerByName(action.actor)?.position || null;
}

function importedHeroPlayer() {
  const selected = selectedImportedHeroName();
  return importedPlayerByName(selected) || importedHand?.players.find((player) => player.isHero) || null;
}

function isHeroImportedAction(action, heroName = selectedImportedHeroName()) {
  if (IMPORT_DECISION_MODEL) return IMPORT_DECISION_MODEL.isHeroImportedAction(importedHand, action, heroName);
  const heroPosition = importedPlayerByName(heroName)?.position;
  return action.actor === heroName || (heroPosition && actorPosition(action) === heroPosition);
}

function visiblePositionLabel(position) {
  return escapeHtml(position || "?");
}

function importedActionText(action) {
  const position = visiblePositionLabel(actorPosition(action));
  const amount = action.amountBb == null ? "" : ` ${formatNumber(action.amountBb)}bb`;
  const label = action.action === "allin" ? "all-in" : action.action;
  return `${position} ${escapeHtml(label)}${amount}`;
}

function relevantImportedActionsForStreet(street, heroName) {
  if (IMPORT_DECISION_MODEL) return IMPORT_DECISION_MODEL.relevantImportedActionsForStreet(importedHand, street, heroName);
  const actions = importedHand.streets[street]?.actions || [];
  const visible = actions
    .map((action, index) => ({ action, index }))
    .filter(({ action }) => !["blind", "ante", "refund", "win", "muck", "fold"].includes(action.action));
  if (street === "preflop") {
    const firstHeroIndex = visible.findIndex(({ action }) => isHeroImportedAction(action, heroName));
    return firstHeroIndex === -1 ? [] : visible.slice(firstHeroIndex);
  }
  return visible;
}

function previousActionLine(street, targetIndex) {
  if (IMPORT_DECISION_MODEL) {
    return IMPORT_DECISION_MODEL.previousActionLine(importedHand, street, targetIndex, importedActionText);
  }
  const actions = importedHand.streets[street]?.actions || [];
  return actions
    .slice(0, targetIndex)
    .filter((action) => !["blind", "ante", "refund", "win", "muck", "fold"].includes(action.action))
    .map(importedActionText)
    .join(" -> ");
}

function syncImportedEdits(restartPrefetch = true) {
  if (!importedHand) return;
  const before = JSON.stringify(importedHand);
  const convertedBefore = importSession?.handState;
  const heroHandInput = $("importHeroHandEdit");
  if (heroHandInput) {
    const cards = normalizeImportedCards(heroHandInput.value.split(/\s+/).filter(Boolean));
    if (IMPORT_HERO_CARD_MODEL) {
      IMPORT_HERO_CARD_MODEL.setCardsForSelectedHero(importedHand, selectedImportedHeroName(), cards);
    } else {
      importedHand.heroHand = cards;
    }
  }
  const flopInput = $("importFlopEdit");
  if (flopInput) {
    const cards = normalizeImportedCards(flopInput.value.split(/\s+/).filter(Boolean));
    if (cards.length <= 3) importedHand.board.flop = cards;
  }
  const turnInput = $("importTurnEdit");
  if (turnInput) {
    importedHand.board.turn = normalizeImportedCards([turnInput.value.trim()])[0] || null;
  }
  const riverInput = $("importRiverEdit");
  if (riverInput) {
    importedHand.board.river = normalizeImportedCards([riverInput.value.trim()])[0] || null;
  }
  const validity = refreshImportedCardValidity();
  const changed = before !== JSON.stringify(importedHand);
  if (changed && validity.valid && IMPORT_BUILDER_ADAPTER && HAND_SESSION_MODEL) {
    const sourceBefore = convertedBefore?.sourceHand;
    const sameCards = (left = [], right = []) => JSON.stringify(left) === JSON.stringify(right);
    let converted;
    if (sourceBefore && !sameCards(sourceBefore.heroHand, importedHand.heroHand)) {
      converted = IMPORT_BUILDER_ADAPTER.editImportedCards(convertedBefore, "hero", importedHand.heroHand).converted;
    } else if (sourceBefore && !sameCards(sourceBefore.board?.flop, importedHand.board?.flop)) {
      converted = IMPORT_BUILDER_ADAPTER.editImportedCards(convertedBefore, "flop", importedHand.board.flop).converted;
    } else if (sourceBefore && sourceBefore.board?.turn !== importedHand.board?.turn) {
      converted = IMPORT_BUILDER_ADAPTER.editImportedCards(convertedBefore, "turn", [importedHand.board.turn].filter(Boolean)).converted;
    } else if (sourceBefore && sourceBefore.board?.river !== importedHand.board?.river) {
      converted = IMPORT_BUILDER_ADAPTER.editImportedCards(convertedBefore, "river", [importedHand.board.river].filter(Boolean)).converted;
    } else {
      converted = IMPORT_BUILDER_ADAPTER.fromImportedHand(importedHand, { heroName: selectedImportedHeroName() });
    }
    importedHand = converted.sourceHand;
    importSession = HAND_SESSION_MODEL.replaceHand(importSession, converted, {
      ...importSession.metadata,
      correctedKey: "cards",
    });
    importWorkspace?.setSession({ converted, selectedDecisionKey: null });
    renderImportedHand();
  }
  if (restartPrefetch && changed) cancelImportedAnalysisPrefetch();
}

function currentImportedCardValidity() {
  return IMPORT_CARD_VALIDITY?.validateImportedCards(importedHand) || { valid: true, warnings: [] };
}

// The review card is shown only when it has a job: invalid cards, unverifiable action attribution, or the
// user jumped to a card field from a "needs a quick check" pill.
function syncImportReviewVisibility(cardsValid) {
  const needsReview = !cardsValid || importedHand?.actionAttribution?.safe === false || importCardReviewRequested;
  $("importSummary")?.classList.toggle("is-collapsed", !needsReview);
}

function refreshImportedCardValidity() {
  if (!importedHand) return { valid: true, warnings: [] };
  const validity = currentImportedCardValidity();
  syncImportReviewVisibility(validity.valid);
  const warning = $("importCardWarning");
  if (warning) {
    warning.classList.toggle("is-hidden", validity.valid);
    warning.innerHTML = validity.valid
      ? ""
      : `<strong>Correct the card setup before analysis.</strong><ul>${validity.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  }
  document.querySelectorAll(".import-load-btn").forEach((button) => {
    button.disabled = !validity.valid;
    button.setAttribute("aria-disabled", String(!validity.valid));
    button.title = validity.valid ? "" : "Correct the duplicate or incomplete cards before analysis.";
  });
  return validity;
}

function pointKind(street, action, heroName, streetRows) {
  if (IMPORT_DECISION_MODEL) return IMPORT_DECISION_MODEL.pointKind(importedHand, street, action, heroName, streetRows);
  const isHero = isHeroImportedAction(action, heroName);
  if (street === "preflop" && isHero && streetRows[0]?.action === action) {
    return {
      label: "First Hero Decision",
      button: "Analyze Point",
      className: "hero-decision hero-action-cell",
    };
  }
  if (isHero) {
    return {
      label: "Review Hero Action",
      button: "Review Point",
      className: "review-decision hero-action-cell",
    };
  }
  return {
    label: "Villain Key Action",
    button: "Analyze Point",
    className: "villain-decision",
  };
}

function showImportPreview(src) {
  const preview = $("importPreview");
  preview.innerHTML = `<button type="button" class="import-preview-chip" aria-haspopup="dialog"><img src="${src}" alt="" /><span>Original screenshot</span><span aria-hidden="true">⤢</span></button>`;
  preview.querySelector(".import-preview-chip").addEventListener("click", () => {
    const dialog = $("importPreviewDialog");
    dialog.querySelector("img").src = src;
    dialog.onclick = (event) => { if (event.target === dialog) dialog.close(); };
    dialog.showModal();
  });
}

function importCardsStripHtml(heroCards, board) {
  const slot = (card) => renderCardElement(card && card.length === 2 ? card : null);
  const boardSlots = [0, 1, 2, 3, 4].map((index) => slot(board[index]));
  return `<div class="import-cards-strip" aria-label="Imported cards">
    <div><span>Hero</span><div class="import-cards-row">${[0, 1].map((index) => slot(heroCards[index])).join("")}</div></div>
    <div><span>Board</span><div class="import-cards-row">${boardSlots.join("")}</div></div>
  </div>`;
}

function renderImportedHand() {
  if (!importedHand) return;
  setImportState("review");
  const heroName = selectedImportedHeroName() || importedHand.heroName || importedHand.players.find((player) => player.isHero)?.name || "";
  if (!importedHand.heroName && heroName) importedHand.heroName = heroName;
  const board = [
    ...(importedHand.board.flop || []),
    importedHand.board.turn,
    importedHand.board.river,
  ].filter(Boolean);
  const players = importedHand.players
    .map((player) => `<span${player.name === heroName ? ' class="is-hero"' : ""}>${visiblePositionLabel(player.position)}${player.stackBb ? ` ${formatNumber(player.stackBb)}bb` : ""}${player.name === heroName ? " Hero" : ""}</span>`)
    .join("");
  const heroPlayer = importedPlayerByName(heroName);
  $("importSummary").classList.remove("is-hidden");
  $("importSummary").innerHTML = `
    ${importCardsStripHtml(importedHand.heroHand || [], board)}
    <div class="import-meta">
      <div><span>Site</span><strong>${escapeHtml(importedHand.site || "Unknown")}</strong></div>
      <div><span>Hand</span><strong>${escapeHtml(importedHand.handId || "-")}</strong></div>
      <label><span>Hero hand</span><input id="importHeroHandEdit" value="${escapeHtml(importedHand.heroHand.join(" "))}" spellcheck="false" /></label>
      <div><span>Board</span><strong>${escapeHtml(board.join(" ") || "-")}</strong></div>
    </div>
    <div class="import-card-edits">
      <label><span>Flop</span><input id="importFlopEdit" value="${escapeHtml((importedHand.board.flop || []).join(" "))}" spellcheck="false" /></label>
      <label><span>Turn</span><input id="importTurnEdit" value="${escapeHtml(importedHand.board.turn || "")}" spellcheck="false" /></label>
      <label><span>River</span><input id="importRiverEdit" value="${escapeHtml(importedHand.board.river || "")}" spellcheck="false" /></label>
    </div>
    <div id="importCardWarning" class="import-card-warning is-hidden" role="alert"></div>
    <label class="import-hero-field">
      Hero for analysis
      <select id="importHeroSelect">
        ${importedHand.players
          .map((player) => `<option value="${escapeHtml(player.name)}" ${player.name === heroName ? "selected" : ""}>${visiblePositionLabel(player.position)}${player.name === heroName || player.isHero ? " (Hero)" : ""}</option>`)
          .join("")}
      </select>
    </label>
    <div class="import-hero-note">Hero is treated as the bottom seat${heroPlayer?.position ? ` (${visiblePositionLabel(heroPlayer.position)})` : ""}.</div>
    <div class="import-player-list">${players}</div>
    ${
      importedHand.confidenceNotes.length
        ? `<ul class="import-notes">${importedHand.confidenceNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`
        : ""
    }
  `;
  $("importHeroSelect")?.addEventListener("change", (event) => {
    cancelImportedAnalysisPrefetch();
    importedAnalysisCache?.clear();
    const nextHeroName = event.target.value;
    const nextHeroCards = IMPORT_HERO_CARD_MODEL
      ? IMPORT_HERO_CARD_MODEL.cardsForSelectedHero(importedHand, nextHeroName)
      : [];
    if (importSession?.handState && IMPORT_BUILDER_ADAPTER && HAND_SESSION_MODEL) {
      const changed = IMPORT_BUILDER_ADAPTER.changeImportedHero(importSession.handState, nextHeroName);
      changed.converted.sourceHand.heroHand = nextHeroCards;
      importedHand = changed.converted.sourceHand;
      const converted = IMPORT_BUILDER_ADAPTER.fromImportedHand(importedHand, { heroName: nextHeroName });
      importSession = HAND_SESSION_MODEL.replaceHand(importSession, converted, {
        ...importSession.metadata,
        correctedKey: "hero",
      });
      importWorkspace?.setSession({ converted, selectedDecisionKey: null });
    } else {
      importedHand.heroName = nextHeroName;
      importedHand.heroHandOwner = nextHeroName;
      importedHand.heroHand = nextHeroCards;
    }
    renderImportedHand();
  });
  for (const id of ["importHeroHandEdit", "importFlopEdit", "importTurnEdit", "importRiverEdit"]) {
    $(id)?.addEventListener("change", syncImportedEdits);
  }
  renderImportedDecisions(heroName);
  refreshImportedCardValidity();
  startImportedRequestPrefetch();
}

function renderImportedDecisions(heroName) {
  if (importedHand?.actionAttribution?.safe === false) {
    $("importDecisions").innerHTML = `
      <div class="import-card-warning" role="alert">
        <strong>Action attribution could not be verified.</strong>
        Decision analysis is disabled for this import. The extracted cards and board remain editable.
      </div>`;
    return;
  }
  const groups = ["preflop", "flop", "turn", "river"].map((street) => ({
    street,
    rows: relevantImportedActionsForStreet(street, heroName),
  }));
  const decisionCount = groups.reduce((total, group) => total + group.rows.length, 0);
  $("importDecisions").innerHTML = `
    <div class="section-title compact-title">
      <span>Hero Decision Points</span>
      <strong>${decisionCount}</strong>
    </div>
    <div class="decision-groups">
      ${groups
        .map(
          (group) => `
            <section class="decision-street-group">
              <h3>${streetLabel(group.street)}</h3>
              ${
                group.rows.length
                  ? group.rows
                      .map(({ action, index }) => {
                        const kind = pointKind(group.street, action, heroName, group.rows);
                        const leadIn = previousActionLine(group.street, index);
                        return `
                          <div class="decision-item ${kind.className}">
                            <div>
                              <span>${escapeHtml(kind.label)}${leadIn ? ` · ${escapeHtml(leadIn)}` : ""}</span>
                              <strong>${importedActionText(action)}</strong>
                            </div>
                            <button class="primary-btn import-load-btn" type="button" data-street="${group.street}" data-index="${index}" data-default-label="${escapeHtml(kind.button)}">
                              ${escapeHtml(kind.button)}
                            </button>
                          </div>
                        `;
                      })
                      .join("")
                  : `<div class="empty-state">No hero decision extracted for this street.</div>`
              }
            </section>
          `,
        )
        .join("")}
    </div>
  `;
  refreshImportedCardValidity();
}

function importedBoardThrough(street) {
  const board = importedHand.board || {};
  if (street === "preflop") return { flop: "", turn: "", river: "" };
  return {
    flop: (board.flop || []).join(" "),
    turn: ["turn", "river"].includes(street) ? board.turn || "" : "",
    river: street === "river" ? board.river || "" : "",
  };
}

function importedStreetRows(street, targetStreet, targetIndex, heroName) {
  if (IMPORT_DECISION_MODEL?.importedStreetRowsForAnalysis) {
    return IMPORT_DECISION_MODEL.importedStreetRowsForAnalysis(importedHand, street, targetStreet, targetIndex, heroName);
  }
  const actions = importedHand.streets[street]?.actions || [];
  const streetOrder = ["preflop", "flop", "turn", "river"];
  const beforeTarget = streetOrder.indexOf(street) < streetOrder.indexOf(targetStreet);
  const sameStreet = street === targetStreet;
  const targetAction = sameStreet ? actions[targetIndex] : null;
  const heroPosition = importedPlayerByName(heroName)?.position;
  const isHeroTarget = targetAction && (targetAction.actor === heroName || actorPosition(targetAction) === heroPosition);
  const max = beforeTarget ? actions.length : sameStreet ? targetIndex + (isHeroTarget ? 0 : 1) : 0;
  let selected = actions
    .slice(0, max)
    .filter((action) => !["blind", "ante", "refund", "win", "muck"].includes(action.action));
  let hasAggression = false;
  return selected
    .filter((action) => !(street === "preflop" && action.action === "fold"))
    .map((action) => {
    const importedAction = action.action;
    let mappedAction = importedAction;
    if (street === "preflop" && importedAction === "raise" && !hasAggression) mappedAction = "open";
    if (street === "preflop" && importedAction === "allin" && !hasAggression) mappedAction = "open";
    if (["open", "raise", "bet", "allin"].includes(mappedAction)) hasAggression = true;
    return {
      actor: actorPosition(action) || "MP",
      action: mappedAction,
      amount: action.amountBb || "",
    };
  });
}

function normalizedPreparedRows(rows) {
  return (rows || []).map((row) => ({
    actor: row.actor,
    action: row.action,
    amount: row.amount ?? "",
  }));
}

function prepareImportedDecision(street, index, heroName = selectedImportedHeroName()) {
  const targetIndex = Number(index);
  const importedDecisionContext = IMPORT_DECISION_MODEL.buildImportedDecisionContext(
    importedHand,
    street,
    targetIndex,
    heroName,
  );
  const board = importedBoardThrough(street);
  const rowsByStreet = Object.fromEntries(
    ["preflop", "flop", "turn", "river"].map((nextStreet) => {
      const rows = nextStreet === street
        ? importedDecisionContext.actionsThroughTarget
        : importedStreetRows(nextStreet, street, targetIndex, heroName);
      return [nextStreet, normalizedPreparedRows(rows)];
    }),
  );
  const cacheState = importedDecisionCacheStateFromValues({
    street,
    index: targetIndex,
    heroName,
    heroPosition: importedDecisionContext.heroPosition,
    villainPosition: importedDecisionContext.primaryVillainPosition,
    heroHand: importedHand.heroHand.join(" "),
    board,
    rows: rowsByStreet,
  });
  return {
    street,
    index: targetIndex,
    heroName,
    importedDecisionContext,
    heroPosition: importedDecisionContext.heroPosition,
    villainPosition: importedDecisionContext.primaryVillainPosition,
    heroHand: importedHand.heroHand.join(" "),
    board,
    rowsByStreet,
    cacheState,
    cacheKey: IMPORT_ANALYSIS_CACHE_MODEL.cacheKeyForImportedDecision(cacheState),
  };
}

function applyPreparedImportedDecision(prepared) {
  $("heroPosition").value = prepared.heroPosition;
  $("villainPosition").value = prepared.villainPosition;
  $("heroHand").value = prepared.heroHand;
  $("boardCards").value = prepared.board.flop;
  $("turnCard").value = prepared.board.turn;
  $("riverCard").value = prepared.board.river;
  for (const street of ["preflop", "flop", "turn", "river"]) {
    clearActionRows(street);
    for (const row of prepared.rowsByStreet[street]) addActionRow(street, row);
  }
  setVisibleStreet(prepared.street);
  updateProgressiveControls();
}

const PREFETCH_BUTTON_LABELS = {
  queued: "Preparing…",
  running: "Preparing…",
  completed: "Ready",
  failed: "Retry",
};

function renderImportedPrefetchStatus(key, status) {
  const button = [...document.querySelectorAll(".import-load-btn")]
    .find((candidate) => candidate.dataset.prefetchKey === key);
  if (!button) return;
  button.textContent = PREFETCH_BUTTON_LABELS[status] || button.dataset.defaultLabel || "Analyze Point";
  button.setAttribute("aria-busy", String(status === "queued" || status === "running"));
  button.title = status === "completed"
    ? "Analysis is ready to open."
    : status === "failed"
      ? "Background preparation failed. Click to retry."
      : "Preparing this analysis in the background.";
}

function cancelImportedAnalysisPrefetch() {
  importedPrefetchGeneration += 1;
  activeImportedPrefetchKey = null;
  activeImportedPrefetchMode = "background";
  importedAnalysisPrefetchQueue?.cancel();
  analysisRequestCoordinator?.cancel();
  document.querySelectorAll(".import-load-btn[data-prefetch-key]").forEach((button) => {
    button.textContent = button.dataset.defaultLabel || "Analyze Point";
    button.setAttribute("aria-busy", "false");
    button.removeAttribute("data-prefetch-key");
    if (currentImportedCardValidity().valid) button.title = "";
  });
}

function buildImportedPrefetchEntries(generation) {
  if (!importedHand || importedHand.actionAttribution?.safe === false) return [];
  const heroName = selectedImportedHeroName();
  const candidates = IMPORT_ANALYSIS_PREFETCH_MODEL.rankImportedPostflopCandidates(
    importedHand,
    heroName,
    (hand, action, selectedHero) => IMPORT_DECISION_MODEL.isHeroImportedAction(hand, action, selectedHero),
    2,
  );
  return candidates.flatMap((candidate) => {
    try {
      const prepared = prepareImportedDecision(candidate.street, candidate.index, heroName);
      return [{ ...candidate, key: prepared.cacheKey, prepared, generation }];
    } catch {
      return [];
    }
  });
}

function startImportedAnalysisPrefetch() {
  if (!importedAnalysisPrefetchQueue || !currentImportedCardValidity().valid) return;
  const generation = ++importedPrefetchGeneration;
  const entries = buildImportedPrefetchEntries(generation);
  for (const entry of entries) {
    const button = document.querySelector(
      `.import-load-btn[data-street="${entry.street}"][data-index="${entry.index}"]`,
    );
    if (button) button.dataset.prefetchKey = entry.key;
  }
  const pending = entries.filter((entry) => {
    if (!importedAnalysisCache?.get(entry.prepared.cacheState)) return true;
    renderImportedPrefetchStatus(entry.key, "completed");
    return false;
  });
  importedAnalysisPrefetchQueue.replace(pending);
}

function restartImportedAnalysisPrefetch() {
  cancelImportedAnalysisPrefetch();
  importedAnalysisCache?.clear();
  startImportedAnalysisPrefetch();
}

async function runImportedPrefetchEntry(entry) {
  if (entry.generation !== importedPrefetchGeneration || currentMode !== "import") {
    throw new Error("Imported analysis prefetch was superseded.");
  }
  applyPreparedImportedDecision(entry.prepared);
  resetResultPanels();
  activeImportedPrefetchKey = entry.key;
  activeImportedPrefetchMode = "background";
  await analyze(null, entry.prepared.cacheState, entry.prepared.importedDecisionContext, {
    background: true,
    generation: entry.generation,
    cacheKey: entry.key,
  });
  if (!importedAnalysisCache.get(entry.prepared.cacheState)) {
    throw new Error("Imported analysis prefetch did not produce a complete snapshot.");
  }
  if (activeImportedPrefetchMode === "foreground") {
    cancelImportedAnalysisPrefetch();
  } else if (activeImportedPrefetchKey === entry.key) {
    activeImportedPrefetchKey = null;
  }
}

// Screenshot imports pre-run the slow AI calls (villain range, Harrington, PokerSkill) for the key decision
// points as soon as the hand is read, so choosing Analyze on one of them picks up the in-flight or finished
// responses. Only the network requests run in the background; nothing is rendered until the user asks.
const IMPORTED_REQUEST_PREFETCH_LIMIT = 2;
const PREFETCHED_STRATEGY_ENDPOINTS = ["/api/analyze/harrington", "/api/analyze/pokerskill"];
let importedRequestPrefetch = { handKey: null, controller: null, analysisIds: new Map(), responses: new Map() };

function prefetchRequestKey(url, payload = {}) {
  const { analysisId: _payloadId, ...rest } = payload;
  const { analysisId: _spotId, ...spot } = rest.spot || {};
  return JSON.stringify([url, { ...rest, spot }]);
}

function importedPrefetchedAnalysisId(spotPayload) {
  return importedRequestPrefetch.analysisIds.get(prefetchRequestKey("spot", spotPayload)) || null;
}

function cancelImportedRequestPrefetch() {
  importedRequestPrefetch.controller?.abort();
  importedRequestPrefetch = { handKey: null, controller: null, analysisIds: new Map(), responses: new Map() };
}

function registerPrefetchedResponse(url, payload, promise) {
  promise.catch(() => {}); // Unused prefetches may fail quietly; the foreground call retries live.
  importedRequestPrefetch.responses.set(prefetchRequestKey(url, payload), promise);
}

function waitUnlessAborted(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason || new Error("Request aborted."));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason || new Error("Request aborted."));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

// Uses a prefetched response for exactly this request when there is one (each is used once, so a
// deliberate re-analysis still asks the server again), and falls back to a live call if it failed.
async function postJsonPrefetched(url, payload, signal) {
  const key = prefetchRequestKey(url, payload);
  const pending = importedRequestPrefetch.responses.get(key);
  if (!pending) return postJson(url, payload, signal);
  for (const [otherKey, promise] of importedRequestPrefetch.responses) {
    if (promise === pending) importedRequestPrefetch.responses.delete(otherKey);
  }
  try {
    return await waitUnlessAborted(pending, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    return postJson(url, payload, signal);
  }
}

// The analyzer form is the only source of request payloads, so borrow it briefly and put it back.
function withAnalyzerFormFor(prepared, build) {
  const saved = {
    heroPosition: $("heroPosition").value,
    villainPosition: $("villainPosition").value,
    heroHand: $("heroHand").value,
    board: { flop: $("boardCards").value, turn: $("turnCard").value, river: $("riverCard").value },
    rowsByStreet: Object.fromEntries(["preflop", "flop", "turn", "river"].map((street) => [street, getActionSequence(street)])),
    street: visibleStreet,
  };
  try {
    applyPreparedImportedDecision(prepared);
    return build();
  } finally {
    applyPreparedImportedDecision(saved);
  }
}

// A prefetched range fixes this hand's locks. Once they are remembered, the same decision's foreground
// request carries them, so also file the response under that request - but only if every lock it now
// carries is the one this very response established.
function aliasPrefetchedRange(spotPayload, sentPayload, result, interpretation, promise) {
  const lockedPayload = buildRangePayload(spotPayload);
  if (prefetchRequestKey("range", lockedPayload) === prefetchRequestKey("range", sentPayload)) return;
  const established = new Map((interpretation?.streetSummaries || []).map((item) => [item?.street, item?.rangeText]));
  const rawPreflop = (result.rangeInterpretation?.streetSummaries || []).find((item) => item?.street === "preflop")?.rangeText;
  const preflopLock = lockedPayload.spot?.lockedPreflopRange?.rangeText;
  if (preflopLock && preflopLock !== (sentPayload.spot?.lockedPreflopRange?.rangeText || rawPreflop)) return;
  for (const lock of lockedPayload.spot?.lockedPriorStreetRanges || []) {
    const sentLock = (sentPayload.spot?.lockedPriorStreetRanges || []).find((item) => item.street === lock.street)?.rangeText;
    if (lock.rangeText !== (sentLock || established.get(lock.street))) return;
  }
  // A ceiling that appeared only after this response is one this response set for its own street; any
  // other new ceiling means the foreground request would be bounded differently, so don't alias.
  const sentCeilings = new Map((sentPayload.spot?.rangeCeilings || []).map((item) => [item.street, item.rangeText]));
  for (const ceiling of lockedPayload.spot?.rangeCeilings || []) {
    if (ceiling.rangeText !== (sentCeilings.get(ceiling.street) || established.get(ceiling.street))) return;
  }
  registerPrefetchedResponse("/api/range/interpret", lockedPayload, promise);
}

function startImportedRequestPrefetch() {
  if (!IMPORT_ANALYSIS_PREFETCH_MODEL || !importedHand || importedHand.actionAttribution?.safe === false || !currentImportedCardValidity().valid) {
    cancelImportedRequestPrefetch();
    return;
  }
  const heroName = selectedImportedHeroName();
  const prepared = IMPORT_ANALYSIS_PREFETCH_MODEL.rankImportedPostflopCandidates(
    importedHand,
    heroName,
    (hand, action, selectedHero) => IMPORT_DECISION_MODEL.isHeroImportedAction(hand, action, selectedHero),
    IMPORTED_REQUEST_PREFETCH_LIMIT,
  )
    // Earlier streets first, so a later decision's range request can carry the locks the earlier one sets.
    .sort((left, right) => streetOrderIndex(left.street) - streetOrderIndex(right.street) || left.index - right.index)
    .flatMap((candidate) => {
      try {
        return [prepareImportedDecision(candidate.street, candidate.index, heroName)];
      } catch {
        return [];
      }
    })
    .filter((decision) => !importedAnalysisCache?.get(decision.cacheState));
  const handKey = JSON.stringify(prepared.map((decision) => decision.cacheKey));
  if (handKey === importedRequestPrefetch.handKey) return;
  cancelImportedRequestPrefetch();
  if (!prepared.length) return;
  const controller = new AbortController();
  importedRequestPrefetch.handKey = handKey;
  importedRequestPrefetch.controller = controller;

  const requests = prepared.flatMap((decision) => {
    try {
      const { spotPayload, heroCards, boardCards } = withAnalyzerFormFor(decision, () => buildAnalysisRequest(decision.importedDecisionContext));
      return [{ spotPayload, context: { heroCards, boardCards } }];
    } catch {
      return [];
    }
  });
  let rangeChain = Promise.resolve();
  for (const { spotPayload, context } of requests) {
    importedRequestPrefetch.analysisIds.set(prefetchRequestKey("spot", spotPayload), spotPayload.analysisId);
    for (const url of PREFETCHED_STRATEGY_ENDPOINTS) {
      registerPrefetchedResponse(url, spotPayload, postJson(url, spotPayload, controller.signal));
    }
    rangeChain = rangeChain.then(async () => {
      if (controller.signal.aborted) return;
      const rangePayload = buildRangePayload(spotPayload);
      const promise = postJson("/api/range/interpret", rangePayload, controller.signal);
      registerPrefetchedResponse("/api/range/interpret", rangePayload, promise);
      const result = await promise;
      if (controller.signal.aborted) return;
      const interpretation = settleRangeResult(spotPayload, rangePayload, result, context);
      aliasPrefetchedRange(spotPayload, rangePayload, result, interpretation, promise);
    }).catch(() => {});
  }
}

function chooseVillainPosition(targetStreet, targetIndex, heroName) {
  const modeled = IMPORT_DECISION_MODEL?.priorOpponentPosition(importedHand, targetStreet, targetIndex, heroName);
  if (modeled) return modeled;
  const heroPosition = importedPlayerByName(heroName)?.position;
  const sameStreetActions = importedHand.streets[targetStreet]?.actions || [];
  const previous = sameStreetActions
    .slice(0, targetIndex)
    .reverse()
    .find((action) => !["blind", "ante", "refund", "win", "muck", "fold"].includes(action.action) && actorPosition(action) !== heroPosition);
  if (previous) return actorPosition(previous) || "MP";
  const streetOrder = ["preflop", "flop", "turn", "river"];
  const priorStreets = streetOrder.slice(0, streetOrder.indexOf(targetStreet)).reverse();
  for (const street of priorStreets) {
    const prior = (importedHand.streets[street]?.actions || [])
      .slice()
      .reverse()
      .find((action) => !["blind", "ante", "refund", "win", "muck", "fold"].includes(action.action) && actorPosition(action) !== heroPosition);
    if (prior) return actorPosition(prior) || "MP";
  }
  const anyOpponent = importedHand.players.find((player) => player.name !== heroName && player.position);
  return anyOpponent?.position || "MP";
}

async function loadImportedDecision(street, index, triggerButton = null, { analyzeNow = true } = {}) {
  if (!importedHand) return;
  syncImportedEdits(false);
  const validity = currentImportedCardValidity();
  if (!validity.valid) {
    $("importStatus").textContent = "Correct the duplicate or incomplete cards before running analysis.";
    return;
  }
  const heroName = selectedImportedHeroName();
  const heroPlayer = importedPlayerByName(heroName);
  if (!heroPlayer?.position) {
    $("importStatus").textContent = "Choose a hero with a visible position before loading a decision.";
    return;
  }
  let prepared;
  try {
    prepared = prepareImportedDecision(street, Number(index), heroName);
  } catch (error) {
    $("importStatus").textContent = `Cannot analyze imported point: ${error.message}`;
    return;
  }
  const prefetchStatus = importedAnalysisPrefetchQueue?.status(prepared.cacheKey);
  const cachedSnapshot = importedAnalysisCache?.get(prepared.cacheState);
  if (cachedSnapshot && restoreImportedAnalysisSnapshot(cachedSnapshot)) {
    cancelImportedAnalysisPrefetch();
    applyPreparedImportedDecision(prepared);
    saveAnalysisSurface("import");
    $("importStatus").textContent = `Loaded cached ${streetLabel(street)} decision ${Number(index) + 1} into the analyzer.`;
    return;
  }
  if (!analyzeNow) {
    cancelImportedAnalysisPrefetch();
    applyPreparedImportedDecision(prepared);
    resetResultPanels();
    $("importStatus").textContent = `Selected ${streetLabel(street)} decision ${Number(index) + 1}. Review the reconstructed state, then choose Analyze Street.`;
    return;
  }
  if (prefetchStatus === "running" && activeImportedPrefetchKey === prepared.cacheKey) {
    activeImportedPrefetchMode = "foreground";
    setVisibleStreet(street);
    $("importStatus").textContent = `Finishing the prepared ${streetLabel(street)} analysis.`;
    await importedAnalysisPrefetchQueue.promiseFor(prepared.cacheKey).catch(() => {});
    return;
  }
  if (prefetchStatus === "queued") {
    importedAnalysisPrefetchQueue.promote(prepared.cacheKey);
    $("importStatus").textContent = `Prioritized ${streetLabel(street)} decision ${Number(index) + 1}. It is being prepared.`;
    return;
  }

  cancelImportedAnalysisPrefetch();
  applyPreparedImportedDecision(prepared);
  resetResultPanels();
  $("importStatus").textContent = `Loaded ${streetLabel(street)} decision ${Number(index) + 1} into the analyzer.`;
  await analyze(triggerButton, prepared.cacheState, prepared.importedDecisionContext);
}

for (const id of ["analyzeFlopBtn", "analyzeTurnBtn", "analyzeRiverBtn"]) {
  $(id).addEventListener("click", (event) => analyze(event.currentTarget));
}
$("manualModeBtn").addEventListener("click", () => {
  analysisRequestId += 1;
  cancelImportedAnalysisPrefetch();
  setMode("manual");
});
$("importModeBtn").addEventListener("click", () => {
  setMode("import");
});
$("continueTurnBtn").addEventListener("click", () => setVisibleStreet("turn"));
$("continueRiverBtn").addEventListener("click", () => setVisibleStreet("river"));
$("resetHandBtn").addEventListener("click", resetActiveHand);
$("rangeText")?.addEventListener("click", (event) => {
  if (event.target.closest("#retryLlmRangeBtn")) retryLLMRangeInterpretation();
});
$("screenshotInput").addEventListener("change", (event) => importScreenshotFile(event.target.files?.[0]));
$("importStages")?.addEventListener("click", (event) => {
  const control = event.target.closest?.("[data-import-field-ref]");
  if (control) focusImportField(control.dataset.importFieldRef);
});
$("importDropzone").addEventListener("dragover", (event) => {
  event.preventDefault();
  $("importDropzone").classList.add("is-dragging");
});
$("importDropzone").addEventListener("dragleave", () => $("importDropzone").classList.remove("is-dragging"));
$("importDropzone").addEventListener("drop", (event) => {
  event.preventDefault();
  $("importDropzone").classList.remove("is-dragging");
  importScreenshotFile(event.dataTransfer?.files?.[0]);
});
document.addEventListener("paste", (event) => {
  if (currentMode !== "import") return;
  const imageItem = [...(event.clipboardData?.items || [])].find((item) => item.type.startsWith("image/"));
  if (imageItem) importScreenshotFile(imageItem.getAsFile());
});
$("importDecisions").addEventListener("click", (event) => {
  const button = event.target.closest(".import-load-btn");
  if (!button) return;
  loadImportedDecision(button.dataset.street, button.dataset.index, null);
});
setupActionSequence("flop");
setupActionSequence("turn");
setupActionSequence("river");

for (const id of ["heroPosition", "villainPosition", "heroHand", "boardCards", "turnCard", "riverCard"]) {
  $(id).addEventListener("input", updateProgressiveControls);
  $(id).addEventListener("change", updateProgressiveControls);
}
$("heroPosition").addEventListener("change", () => refreshHeroActionRows());

function loadManualBuilderSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem("pokerCoach.manualBuilder.settings.v1") || "null");
    if (!stored || stored.gameType !== "6max") return undefined;
    if (![50, 100, 200].includes(Number(stored.startingStackBb))) return undefined;
    if (!["tight", "standard", "loose"].includes(stored.opponentProfile)) return undefined;
    return stored;
  } catch {
    return undefined;
  }
}

function syncManualPreflopCompatibility(state) {
  const legacy = window.PokerCoachPreflopBuilderModel.toLegacyPreflopInput(state);
  $("gameType").value = state.settings.gameType;
  $("rangeMode").value = state.settings.opponentProfile === "tight" ? "tight" : "loose";
  $("heroPosition").value = legacy.heroPosition;
  $("villainPosition").value = legacy.villainPosition;
  $("heroHand").value = legacy.heroHand;
  $("preflopPotSize").value = legacy.preflopPotBb;
  $("preflopCallAmount").value = legacy.preflopCallBb;
  $("preflopActions").innerHTML = legacy.preflopActions.map((action, index) => `
    <div class="action-row" data-street="preflop">
      <span class="action-row-index">${index + 1}</span>
      <div class="action-row-fields">
        <select class="action-actor" aria-label="Actor"><option selected>${action.actor}</option></select>
        <select class="action-type" aria-label="Action"><option value="${action.action}" selected>${action.action}</option></select>
        <input class="action-amount" type="number" value="${action.amount}" aria-label="Amount" />
      </div>
    </div>`).join("");
  updateProgressiveControls();
}

function getManualPreflopInput() {
  return window.PokerCoachPreflopBuilderModel.toLegacyPreflopInput(preflopBuilder.getState());
}

function renderLegacyPostflopActions(street, actions) {
  $(`${street}Actions`).innerHTML = actions.map((legacyAction, index) => {
    const action = POSTFLOP_COMPATIBILITY?.actionRowData(legacyAction) || legacyAction;
    return `
    <div class="action-row" data-street="${street}">
      <span class="action-row-index">${index + 1}</span>
      <div class="action-row-fields">
        <select class="action-actor" aria-label="Actor"><option selected>${action.actor}</option></select>
        <select class="action-type" aria-label="Action"><option value="${action.action}" selected>${action.action}</option></select>
        <input class="action-amount" type="number" value="${action.amount}" aria-label="Amount" />
      </div>
    </div>`;
  }).join("");
}

function syncPostflopCompatibility(state) {
  if (!state) return;
  const legacy = window.PokerCoachPostflopBuilderModel.toLegacyAnalysisInput(state);
  $("boardCards").value = legacy.boardCards;
  $("turnCard").value = legacy.turnCard;
  $("riverCard").value = legacy.riverCard;
  for (const street of ["flop", "turn", "river"]) {
    renderLegacyPostflopActions(street, legacy.actionsByStreet[street]);
    const lastPot = state.streetActions[street].at(-1)?.potAfterUnits ?? state.streetStarts[street]?.potUnits;
    if (lastPot != null) $(`${street}PotSize`).value = lastPot / 10;
    const callUnits = state.street === street ? window.PokerCoachPostflopBuilderModel.legalActions(state).amountToCallUnits : 0;
    $(`${street}CallAmount`).value = callUnits / 10;
  }
  visibleStreet = legacy.street;
  updateProgressiveControls();
}

analysisTabs = window.PokerCoachAnalysisTabsView?.createAnalysisTabs({ root: $("analysisWorkspace") }) || null;

// The collapsed Developer Details card shows the analysis id, read from the calculation trail's first row.
{
  const devDetails = document.querySelector(".developer-details");
  const trail = $("calculationLog");
  if (devDetails && trail) {
    const syncHint = () => {
      const row = trail.querySelector(".calc-row");
      devDetails.dataset.hint = row?.querySelector("span")?.textContent === "Analysis ID" ? row.querySelector("strong")?.textContent || "" : "";
    };
    new MutationObserver(syncHint).observe(trail, { childList: true, subtree: true, characterData: true });
    syncHint();
  }
}

postflopAnalysisView = window.PokerCoachPostflopAnalysisView.createPostflopAnalysisView({
  root: $("postflopAnalysis"),
  rangeMatrixView: window.PokerCoachRangeMatrixView,
});

importWorkspace = window.PokerCoachHandWorkspaceView?.createHandWorkspaceView({
  root: $("importBuilderWorkspace"),
  onSelectDecision: async (decisionKey) => {
    if (!importSession?.handState) return;
    const entry = importSession.handState.actionIndex?.[decisionKey];
    importSession = HAND_SESSION_MODEL.selectDecision(importSession, {
      key: decisionKey,
      street: entry?.street,
      owner: entry?.actor,
    });
    importWorkspace.setSession({ converted: importSession.handState, selectedDecisionKey: decisionKey, visibleStreet: entry?.street });
    const canAnalyze = IMPORT_DECISION_MODEL.selectableDecisionKeys(importSession.handState).includes(decisionKey);
    if (!canAnalyze) {
      $("importStatus").textContent = "Replay selected. Correct the recorded action to enable analysis.";
      return;
    }
    try {
      IMPORT_DECISION_MODEL.decisionSnapshotForAction(importSession.handState, decisionKey);
      const [street, index] = decisionKey.split(":");
      await loadImportedDecision(street, Number(index), null, { analyzeNow: false });
      saveAnalysisSurface("import");
    } catch (error) {
      $("importStatus").textContent = `Correct this imported action before analysis: ${error.message}`;
    }
  },
  onAnalyzeDecision: async (decisionKey, triggerButton) => {
    const [street, index] = decisionKey.split(":");
    await loadImportedDecision(street, Number(index), triggerButton, { analyzeNow: true });
    saveAnalysisSurface("import");
  },
  onEditAction: (decisionKey, replacement) => {
    if (!importSession?.handState) return;
    try {
      const result = IMPORT_BUILDER_ADAPTER.editImportedAction(importSession.handState, decisionKey, replacement);
      importedHand = result.converted.sourceHand;
      importSession = HAND_SESSION_MODEL.replaceHand(importSession, result.converted, {
        ...importSession.metadata,
        correctedKey: result.correctedKey,
      });
      importWorkspace.setSession({ converted: result.converted, selectedDecisionKey: null });
      renderImportedHand();
      const discarded = result.discardedStreets.length ? ` Later ${result.discardedStreets.join(" and ")} history was cleared.` : "";
      $("importStatus").textContent = `Imported action corrected.${discarded}`;
    } catch (error) {
      $("importStatus").textContent = `Correction failed: ${error.message}`;
    }
  },
});
importWorkspace?.setSession({ converted: null, selectedDecisionKey: null });

postflopBuilder = window.PokerCoachPostflopBuilderView.createPostflopBuilderView({
  root: $("postflopBuilder"),
  model: window.PokerCoachPostflopBuilderModel,
  onStateChange: syncPostflopCompatibility,
  onAnalyze: (_legacy, state) => {
    syncPostflopCompatibility(state);
    const street = state.street === "results" ? "river" : state.street;
    const trigger = $(`analyze${street[0].toUpperCase()}${street.slice(1)}Btn`);
    analyze(trigger);
  },
});

preflopBuilder = window.PokerCoachPreflopBuilderView.createPreflopBuilderView({
  root: $("preflopBuilder"),
  model: window.PokerCoachPreflopBuilderModel,
  initialState: window.PokerCoachPreflopBuilderModel.createInitialState({ settings: loadManualBuilderSettings() }),
  onStateChange: syncManualPreflopCompatibility,
  onAnalyze: () => analyze($("analyzePreflopBtn")),
  onContinueFlop: (preflopState) => {
    postflopBuilder.startFromPreflop(preflopState);
    showManualBuilderStage("postflop");
  },
});

setVisibleStreet("preflop");
showManualBuilderStage("preflop");
