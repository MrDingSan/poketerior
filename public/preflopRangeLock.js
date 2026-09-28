(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PokerCoachPreflopRangeLock = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const STORAGE_KEY = "poketerior.preflopRangeLocks";
  const MAX_ENTRIES = 50;

  // Villain's preflop range depends only on who is involved, the opponent profile, and the preflop line.
  // Hero's cards are deliberately excluded: they only remove combos, which the parser does via blockers.
  function lockKey(spot = {}) {
    const actions = (spot.preflopActions || []).map((row) => [row.actor, row.action, String(row.amount ?? "")]);
    if (!spot.villainPosition || !actions.length) return null;
    return JSON.stringify([spot.rangeMode || "", spot.heroPosition || "", spot.villainPosition, actions]);
  }

  function createPreflopRangeLock({ storage = null } = {}) {
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

    function get(spot) {
      const key = lockKey(spot);
      return key ? entries.get(key) || null : null;
    }

    function remember(spot, rangeText, meta = {}) {
      const key = lockKey(spot);
      const text = String(rangeText || "").trim();
      if (!key || !text || entries.has(key)) return false;
      entries.set(key, { rangeText: text, ...meta });
      persist();
      return true;
    }

    function forget(spot) {
      const key = lockKey(spot);
      if (!key || !entries.delete(key)) return false;
      persist();
      return true;
    }

    return { get, remember, forget };
  }

  return { createPreflopRangeLock, lockKey };
});
