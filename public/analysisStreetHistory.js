// Remembers the finished Equity and AI Analysis panels for each street of a hand, so the shared street strip
// can show an earlier street's analysis after the hand has moved on. An entry is only returned for a spot on
// the same line: same hero and seats, a board that extends the entry's board, identical actions on every
// earlier street and, on the entry's own street, actions that the current spot continues.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PokerCoachAnalysisStreetHistory = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STREETS = ["preflop", "flop", "turn", "river"];

  function streetIndex(street) {
    return STREETS.indexOf(street || "preflop");
  }

  function handKey(spot = {}) {
    return JSON.stringify([spot.heroHand || "", spot.heroPosition || "", spot.villainPosition || ""]);
  }

  function actionKey(row = {}) {
    return `${row.actor || ""}|${row.action || ""}|${Number(row.amount) || 0}`;
  }

  function streetActions(spot, street) {
    return (spot.allStreetActions?.[street] || []).map(actionKey);
  }

  function boardCards(spot) {
    return String(spot.board || "").split(/\s+/).filter(Boolean);
  }

  function continuesLine(earlier, later) {
    const index = streetIndex(earlier.street);
    if (index < 0 || index >= streetIndex(later.street)) return false;
    if (handKey(earlier) !== handKey(later)) return false;
    const before = boardCards(earlier);
    const after = boardCards(later);
    if (before.some((card, position) => after[position] !== card)) return false;
    for (const street of STREETS.slice(0, index)) {
      if (streetActions(earlier, street).join(",") !== streetActions(later, street).join(",")) return false;
    }
    const own = streetActions(earlier, earlier.street);
    const next = streetActions(later, earlier.street);
    return own.every((key, position) => next[position] === key);
  }

  function createStreetHistory() {
    const hands = new Map();
    return {
      // Keeps the latest decision on each street: a later spot on the same street replaces an earlier one.
      record(spot, view) {
        if (!spot || streetIndex(spot.street) < 0) return;
        const key = handKey(spot);
        if (!hands.has(key)) hands.set(key, new Map());
        const streets = hands.get(key);
        const existing = streets.get(spot.street);
        if (existing && streetActions(existing.spot, spot.street).length > streetActions(spot, spot.street).length) return;
        streets.set(spot.street, { spot, view });
      },
      lookup(spot, street) {
        const entry = hands.get(handKey(spot))?.get(street);
        return entry && continuesLine(entry.spot, spot) ? entry.view : null;
      },
      clear() {
        hands.clear();
      },
    };
  }

  return { STREETS, continuesLine, createStreetHistory };
});
