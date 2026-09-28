// Generalizes preflopRangeLock.js to flop/turn: once a street's cumulative villain range has been
// computed, remember it keyed by the exact action/board history through that street, so re-analyzing
// a later street in the same hand reuses it instead of asking the LLM to re-derive it from scratch.
// Without this, each street's analysis is an independent LLM call over the full history, and a
// non-deterministic model can (and does) return a different flop range depending on whether it was
// asked "what's villain's flop range" directly or as a byproduct of a turn/river request.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PokerCoachStreetRangeLock = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STORAGE_KEY = "poketerior.streetRangeLocks";
  const MAX_ENTRIES = 150;
  const STREET_ORDER = ["preflop", "flop", "turn", "river"];
  const BOARD_COUNT = { preflop: 0, flop: 3, turn: 4, river: 5 };

  function actionsThroughStreet(spot, street) {
    const allStreetActions = spot?.allStreetActions || {};
    return STREET_ORDER.slice(0, STREET_ORDER.indexOf(street) + 1).map((thisStreet) => [
      thisStreet,
      (allStreetActions[thisStreet] || []).map((row) => [row.actor, row.action, String(row.amount ?? "")]),
    ]);
  }

  function boardThroughStreet(spot, street) {
    const count = BOARD_COUNT[street] || 0;
    if (!count) return [];
    return String(spot?.board || "").trim().split(/\s+/).filter(Boolean).slice(0, count);
  }

  // Villain's range through a given street depends on who's involved, the opponent profile, the full
  // action line through that street, and the board through that street. Hero's cards are excluded, same
  // as preflopRangeLock: they only remove combos, which the parser already does via known-card blockers.
  function lockKey(spot = {}, street) {
    if (!spot.villainPosition || !street || street === "preflop") return null;
    return JSON.stringify([
      spot.rangeMode || "",
      spot.heroPosition || "",
      spot.villainPosition,
      street,
      actionsThroughStreet(spot, street),
      boardThroughStreet(spot, street),
    ]);
  }

  function createStreetRangeLock({ storage = null } = {}) {
    const entries = new Map();
    try {
      for (const [key, value] of JSON.parse(storage?.getItem(STORAGE_KEY) || "[]")) entries.set(key, value);
    } catch {
      // A corrupt or blocked store only means ranges are re-inferred.
    }

    function persist() {
      try {
        storage?.setItem(STORAGE_KEY, JSON.stringify([...entries].slice(-MAX_ENTRIES)));
      } catch {
        // Persistence is a convenience; the in-memory lock still applies for this page.
      }
    }

    function get(spot, street) {
      const key = lockKey(spot, street);
      return key ? entries.get(key) || null : null;
    }

    // Every street strictly before `uptoStreetExclusive` that has already been locked (or can be
    // locked from this very result), in street order - what a later street's prompt should copy
    // verbatim instead of re-deriving.
    function priorLocks(spot, uptoStreetExclusive) {
      const cutoff = STREET_ORDER.indexOf(uptoStreetExclusive);
      if (cutoff <= 0) return [];
      return STREET_ORDER.slice(1, cutoff)
        .map((street) => ({ street, lock: get(spot, street) }))
        .filter((entry) => entry.lock)
        .map((entry) => ({ street: entry.street, rangeText: entry.lock.rangeText }));
    }

    function remember(spot, street, rangeText, meta = {}) {
      const key = lockKey(spot, street);
      const text = String(rangeText || "").trim();
      if (!key || !text || entries.has(key)) return false;
      entries.set(key, { rangeText: text, ...meta });
      persist();
      return true;
    }

    return { get, priorLocks, remember };
  }

  return { createStreetRangeLock, lockKey };
});
