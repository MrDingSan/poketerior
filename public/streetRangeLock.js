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
  // v4: ranges carry the per-group reasons they were decided with, and were decided under the poker-logic
  // guardrails. Earlier versions are not reused: v1 had model-written rangeText with no reasons, v2 let a
  // check drop sets and better, and v3 let a first-to-act check narrow the range.
  const STORAGE_KEY = "poketerior.streetRangeLocks.v4";
  const MAX_ENTRIES = 150;
  const STREET_ORDER = ["preflop", "flop", "turn", "river"];
  const BOARD_COUNT = { preflop: 0, flop: 3, turn: 4, river: 5 };

  // Each street's rows up to villain's last action on it. Villain's range only changes when villain acts,
  // so Hero's (or anyone else's) trailing actions - checking behind, a bet villain hasn't answered yet -
  // don't make it a different line: the decision before Hero's check and the next street's decision
  // share one remembered range instead of two that can disagree.
  function actionsThroughStreet(spot, street) {
    const allStreetActions = spot?.allStreetActions || {};
    return STREET_ORDER.slice(0, STREET_ORDER.indexOf(street) + 1).map((thisStreet) => {
      const rows = (allStreetActions[thisStreet] || []).map((row) => [row.actor, row.action, String(row.amount ?? "")]);
      let end = rows.length;
      while (end > 0 && rows[end - 1][0] !== spot?.villainPosition) end -= 1;
      return [thisStreet, rows.slice(0, end)];
    });
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

  // The reasons a stored range was decided with, when it has them.
  function explanation(entry) {
    return entry?.narrowing ? { narrowing: entry.narrowing, reasoning: entry.reasoning || "" } : {};
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
        .map((entry) => ({ street: entry.street, rangeText: entry.lock.rangeText, ...explanation(entry.lock) }));
    }

    // A lock only matches the exact action line, so a range computed mid-street (e.g. flop after villain
    // only checked) never matches the same street once more actions land on it (check, bet, call). That
    // earlier range is still an upper bound: every later villain action on the street can only narrow it.
    // For each street through `throughStreet`, return the stored range with the longest action line that
    // is a prefix of the current one - including the exact line itself on the current street. `unchanged`
    // marks one where villain hasn't acted since, so callers can reuse it verbatim.
    function ceilings(spot, throughStreet) {
      const cutoff = STREET_ORDER.indexOf(throughStreet);
      if (cutoff <= 0 || !spot?.villainPosition) return [];
      const result = [];
      for (const street of STREET_ORDER.slice(1, cutoff + 1)) {
        const current = actionsThroughStreet(spot, street);
        const board = JSON.stringify(boardThroughStreet(spot, street));
        const currentStreetActions = current[current.length - 1][1];
        let best = null;
        for (const [key, value] of entries) {
          let parsed;
          try {
            parsed = JSON.parse(key);
          } catch {
            continue;
          }
          const [rangeMode, heroPosition, villainPosition, keyStreet, actions, keyBoard] = parsed;
          if (keyStreet !== street || rangeMode !== (spot.rangeMode || "") || heroPosition !== (spot.heroPosition || "")) continue;
          if (villainPosition !== spot.villainPosition || JSON.stringify(keyBoard) !== board) continue;
          if (JSON.stringify(actions.slice(0, -1)) !== JSON.stringify(current.slice(0, -1))) continue;
          const streetActions = actions[actions.length - 1]?.[1] || [];
          const isPrefix =
            streetActions.length <= currentStreetActions.length &&
            streetActions.every((row, index) => JSON.stringify(row) === JSON.stringify(currentStreetActions[index]));
          // An exact match on an earlier street is already a verbatim lock (priorLocks). A shorter line still
          // applies even then, so a lock saved before ceilings existed can't keep a range wider than it.
          if (!isPrefix || (street !== throughStreet && streetActions.length === currentStreetActions.length)) continue;
          // Villain's range only moves when villain acts. If every action since that earlier line is someone
          // else's (Hero checking behind, another player folding), the earlier range is the answer, not a bound.
          const unchanged = currentStreetActions.slice(streetActions.length).every((row) => row[0] !== spot.villainPosition);
          if (!best || streetActions.length > best.length) best = { length: streetActions.length, rangeText: value.rangeText, unchanged, ...explanation(value) };
        }
        if (best) result.push({ street, rangeText: best.rangeText, unchanged: best.unchanged, ...explanation(best) });
      }
      return result;
    }

    // The mirror of ceilings: a range already stored for a LONGER line on the current street (e.g. the
    // turn decision was analyzed - or prefetched - before the flop decision, so the flop after check-check
    // exists before the flop after one check). The earlier point must contain it: it's a floor. When the
    // extra actions aren't villain's, nothing about villain changed and it's the answer (`unchanged`).
    function floors(spot, street) {
      if (STREET_ORDER.indexOf(street) <= 0 || !spot?.villainPosition) return [];
      const current = actionsThroughStreet(spot, street);
      const board = JSON.stringify(boardThroughStreet(spot, street));
      const currentStreetActions = current[current.length - 1][1];
      let best = null;
      for (const [key, value] of entries) {
        let parsed;
        try {
          parsed = JSON.parse(key);
        } catch {
          continue;
        }
        const [rangeMode, heroPosition, villainPosition, keyStreet, actions, keyBoard] = parsed;
        if (keyStreet !== street || rangeMode !== (spot.rangeMode || "") || heroPosition !== (spot.heroPosition || "")) continue;
        if (villainPosition !== spot.villainPosition || JSON.stringify(keyBoard) !== board) continue;
        if (JSON.stringify(actions.slice(0, -1)) !== JSON.stringify(current.slice(0, -1))) continue;
        const streetActions = actions[actions.length - 1]?.[1] || [];
        const extends_ =
          streetActions.length > currentStreetActions.length &&
          currentStreetActions.every((row, index) => JSON.stringify(row) === JSON.stringify(streetActions[index]));
        if (!extends_) continue;
        const unchanged = streetActions.slice(currentStreetActions.length).every((row) => row[0] !== spot.villainPosition);
        // Prefer the nearest extension; among equals, one villain hasn't acted in.
        if (!best || streetActions.length < best.length || (streetActions.length === best.length && unchanged && !best.unchanged)) {
          best = { length: streetActions.length, rangeText: value.rangeText, unchanged, ...explanation(value) };
        }
      }
      return best ? [{ street, rangeText: best.rangeText, unchanged: best.unchanged, ...explanation(best) }] : [];
    }

    function remember(spot, street, rangeText, meta = {}) {
      const key = lockKey(spot, street);
      const text = String(rangeText || "").trim();
      if (!key || !text || entries.get(key)?.rangeText === text) return false;
      // Overwrite, don't keep the first: what was shown must be what later streets build on. Callers only
      // pass sanitized ranges, which were already capped by this entry, so an overwrite can only narrow it.
      entries.delete(key);
      entries.set(key, { rangeText: text, ...meta });
      persist();
      return true;
    }

    // Drops every remembered range, in memory and in storage.
    function clear() {
      entries.clear();
      persist();
    }

    return { get, priorLocks, ceilings, floors, remember, clear };
  }

  return { createStreetRangeLock, lockKey };
});
