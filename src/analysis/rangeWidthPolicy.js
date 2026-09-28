import "../../public/rangeNotation.js";

const RANGE_NOTATION = globalThis.PokerCoachRangeNotation;

// Plausible preflop width bands (% of all 1326 combos) for 6-max cash, by villain action and position.
// They catch implausible reads (a 100% UTG open) without dictating which hands belong in the range.
const OPEN_BANDS = {
  UTG: { tight: [10, 18], loose: [15, 30] },
  MP: { tight: [13, 22], loose: [18, 34] },
  CO: { tight: [20, 30], loose: [26, 44] },
  BTN: { tight: [30, 46], loose: [40, 65] },
  SB: { tight: [25, 42], loose: [35, 60] },
};

const ACTION_BANDS = {
  call_vs_open: { default: { tight: [6, 18], loose: [10, 30] }, BB: { tight: [20, 40], loose: [28, 55] } },
  "3bet_vs_open": { default: { tight: [3, 8], loose: [5, 15] } },
  call_vs_3bet: { default: { tight: [3, 10], loose: [4, 15] } },
};

const POSITION_ALIASES = { HJ: "MP", LJ: "MP", UTG1: "MP", "UTG+1": "MP", BU: "BTN", BUTTON: "BTN" };

function normalizePosition(position) {
  const upper = String(position || "").toUpperCase().trim();
  return POSITION_ALIASES[upper] || upper;
}

export function expectedPreflopBand({ villainAction, villainPosition, rangeMode }) {
  const mode = rangeMode === "tight" ? "tight" : "loose";
  const position = normalizePosition(villainPosition);
  let pair = null;
  if (villainAction === "open") pair = OPEN_BANDS[position]?.[mode];
  else if (ACTION_BANDS[villainAction]) {
    const bands = ACTION_BANDS[villainAction];
    pair = (bands[position] || bands.default)[mode];
  }
  if (!pair) return null;
  const actionLabel = villainAction === "open" ? "open" : villainAction.replaceAll("_", " ");
  return { min: pair[0], max: pair[1], label: `${mode} ${position} ${actionLabel}` };
}

export function preflopRangeText(interpretation = {}) {
  const preflop = (interpretation.streetSummaries || []).find((item) => item?.street === "preflop");
  if (preflop?.rangeText) return preflop.rangeText;
  return interpretation.street === "preflop" ? interpretation.rangeText || "" : "";
}

// Checks the preflop range an interpretation implies against the expected band.
export function checkPreflopWidth(interpretation, band) {
  const rangeText = preflopRangeText(interpretation);
  const width = RANGE_NOTATION.rangeWidth(rangeText);
  const percent = Math.round(width.percent * 10) / 10;
  const withinBand = !band || (percent >= band.min && percent <= band.max);
  const distance = !band ? 0 : percent < band.min ? band.min - percent : percent > band.max ? percent - band.max : 0;
  return { rangeText, percent, combos: width.combos, unrecognized: width.unrecognized, band, withinBand, distance };
}

export function widthCorrectionNote(check) {
  const direction = check.percent > check.band.max ? "too wide" : "too narrow";
  const ignored = check.unrecognized.length
    ? ` These tokens were not valid notation and were ignored: ${check.unrecognized.join(", ")}.`
    : "";
  return `Your previous preflop range (${check.rangeText}) covers ${check.percent}% of starting hands, which is ${direction} for a ${check.band.label}. Rebuild the preflop range so it covers ${check.band.min}–${check.band.max}% of hands, then derive later streets from it.${ignored}`;
}
