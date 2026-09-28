(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PokerCoachRangeNotation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const RANKS = "23456789TJQKA";
  const SUITS = "cdhs";
  const RANK_VALUE = Object.fromEntries([...RANKS].map((rank, index) => [rank, index + 2]));
  const TOTAL_COMBOS = 1326;

  function isRank(char) {
    return Boolean(char) && RANKS.includes(char);
  }

  function normalizeRankText(token) {
    return token.replace(/10/g, "T").replace(/^([2-9tjqka])([2-9tjqkax])/i, (_, a, b) => a.toUpperCase() + (b.toLowerCase() === "x" ? "x" : b.toUpperCase()));
  }

  function classKey(high, low, suitedness) {
    if (high === low) return high + low;
    const [a, b] = RANK_VALUE[high] >= RANK_VALUE[low] ? [high, low] : [low, high];
    return a + b + suitedness;
  }

  function combosForClass(hand) {
    const [rankA, rankB, suitedness] = hand;
    const combos = [];
    if (rankA === rankB) {
      for (let i = 0; i < SUITS.length; i += 1) {
        for (let j = i + 1; j < SUITS.length; j += 1) combos.push([rankA + SUITS[i], rankB + SUITS[j]]);
      }
      return combos;
    }
    for (const suitA of SUITS) {
      for (const suitB of SUITS) {
        if ((suitedness === "s") !== (suitA === suitB)) continue;
        combos.push([rankA + suitA, rankB + suitB]);
      }
    }
    return combos;
  }

  function allStartingHandClasses() {
    const classes = [];
    for (const high of RANKS) {
      for (const low of RANKS) {
        if (RANK_VALUE[low] > RANK_VALUE[high]) continue;
        if (high === low) classes.push(high + low);
        else classes.push(high + low + "s", high + low + "o");
      }
    }
    return classes;
  }

  // "AK" without a suffix means both the suited and offsuit class.
  function withSuitedness(high, low, suitedness) {
    if (high === low) return [high + low];
    return suitedness ? [classKey(high, low, suitedness)] : [classKey(high, low, "s"), classKey(high, low, "o")];
  }

  function parseHandClass(text) {
    const match = text.match(/^([2-9TJQKA])([2-9TJQKAx])([so])?$/);
    if (!match) return null;
    return { high: match[1], low: match[2], suitedness: match[3] || "" };
  }

  // Every kicker below `high` down to `floor` (inclusive): "A2s+" and "Kxs".
  function kickersFrom(high, floor, suitedness) {
    return [...RANKS]
      .filter((rank) => RANK_VALUE[rank] >= RANK_VALUE[floor] && RANK_VALUE[rank] < RANK_VALUE[high])
      .flatMap((rank) => withSuitedness(high, rank, suitedness));
  }

  function expandPlus(base) {
    const hand = parseHandClass(base);
    if (!hand) return null;
    if (hand.low === "x") return kickersFrom(hand.high, "2", hand.suitedness);
    if (hand.high === hand.low) {
      return [...RANKS].filter((rank) => RANK_VALUE[rank] >= RANK_VALUE[hand.high]).map((rank) => rank + rank);
    }
    if (RANK_VALUE[hand.low] > RANK_VALUE[hand.high]) return null;
    return kickersFrom(hand.high, hand.low, hand.suitedness);
  }

  function expandDash(startText, endText) {
    const start = parseHandClass(startText);
    const end = parseHandClass(endText);
    if (!start || !end || start.low === "x" || end.low === "x") return null;
    const startPair = start.high === start.low;
    const endPair = end.high === end.low;
    if (startPair && endPair) {
      const [low, high] = [RANK_VALUE[start.high], RANK_VALUE[end.high]].sort((a, b) => a - b);
      return [...RANKS].filter((rank) => RANK_VALUE[rank] >= low && RANK_VALUE[rank] <= high).map((rank) => rank + rank);
    }
    if (startPair || endPair) return null;
    const suitedness = start.suitedness || end.suitedness;
    if (start.high === end.high) {
      // Same high card, kicker range: "KQs-KTs", "A2s-A5s".
      const [low, high] = [RANK_VALUE[start.low], RANK_VALUE[end.low]].sort((a, b) => a - b);
      return [...RANKS]
        .filter((rank) => RANK_VALUE[rank] >= low && RANK_VALUE[rank] <= high && rank !== start.high)
        .flatMap((rank) => withSuitedness(start.high, rank, suitedness));
    }
    // Different high cards with the same gap is a connector/gapper run: "98s-54s", "54s-T9s".
    const gap = RANK_VALUE[start.high] - RANK_VALUE[start.low];
    if (gap !== RANK_VALUE[end.high] - RANK_VALUE[end.low] || gap <= 0) return null;
    const [lowTop, highTop] = [RANK_VALUE[start.high], RANK_VALUE[end.high]].sort((a, b) => a - b);
    const classes = [];
    for (let top = lowTop; top <= highTop; top += 1) {
      classes.push(...withSuitedness(RANKS[top - 2], RANKS[top - 2 - gap], suitedness));
    }
    return classes;
  }

  function exactCombo(token) {
    const match = token.match(/^([2-9TJQKA])([cdhs])([2-9TJQKA])([cdhs])$/i);
    if (!match) return null;
    const first = match[1].toUpperCase() + match[2].toLowerCase();
    const second = match[3].toUpperCase() + match[4].toLowerCase();
    return first === second ? null : [first, second];
  }

  // Expands one comma-separated token. Returns null when the token is not recognizable notation.
  function expandToken(rawToken) {
    const compact = rawToken.replace(/\s+/g, "");
    if (!compact) return [];
    if (/^(all|any|anytwo|100%)$/i.test(compact)) return allStartingHandClasses();
    const combo = exactCombo(compact);
    if (combo) return [{ combo }];
    const token = normalizeRankText(compact);
    if (token.endsWith("+")) return expandPlus(token.slice(0, -1));
    if (token.includes("-")) {
      const [start, end, extra] = token.split("-");
      return extra === undefined ? expandDash(start, end) : null;
    }
    const hand = parseHandClass(token);
    if (!hand) return null;
    if (hand.low === "x") return kickersFrom(hand.high, "2", hand.suitedness);
    return withSuitedness(hand.high, hand.low, hand.suitedness);
  }

  function comboLabel(combo) {
    return `${combo[0]} ${combo[1]}`;
  }

  function handClassOfCombo([cardA, cardB]) {
    if (cardA[0] === cardB[0]) return cardA[0] + cardB[0];
    return classKey(cardA[0], cardB[0], cardA[1] === cardB[1] ? "s" : "o");
  }

  function rangeEntries(rangeText) {
    const entries = [];
    const unrecognized = [];
    for (const token of String(rangeText || "").split(",")) {
      const trimmed = token.trim();
      if (!trimmed) continue;
      const expanded = expandToken(trimmed);
      if (!expanded || !expanded.length) {
        unrecognized.push(trimmed);
        continue;
      }
      for (const item of expanded) {
        if (item.combo) entries.push({ handClass: handClassOfCombo(item.combo), combos: [item.combo] });
        else entries.push({ handClass: item, combos: combosForClass(item) });
      }
    }
    return { entries, unrecognized };
  }

  function parseRange(rangeText, blockers = []) {
    const blockerSet = new Set(blockers);
    const { entries, unrecognized } = rangeEntries(rangeText);
    const grouped = new Map();
    for (const entry of entries) {
      const existing = grouped.get(entry.handClass) || { handClass: entry.handClass, theoretical: new Map(), live: new Map() };
      for (const combo of entry.combos) {
        const label = comboLabel(combo);
        existing.theoretical.set(label, combo);
        if (!blockerSet.has(combo[0]) && !blockerSet.has(combo[1])) existing.live.set(label, combo);
      }
      grouped.set(entry.handClass, existing);
    }
    const combos = [];
    const breakdown = [...grouped.values()].map((item) => {
      const liveCombos = [...item.live.values()];
      combos.push(...liveCombos);
      return {
        handClass: item.handClass,
        theoreticalCount: item.theoretical.size,
        liveCount: liveCombos.length,
        blockedCount: item.theoretical.size - liveCombos.length,
        combos: liveCombos,
      };
    });
    return { classes: [...grouped.keys()], combos, breakdown, unrecognized };
  }

  // Size of a range before blockers, as combos and as a share of all 1326 starting combos.
  function rangeWidth(rangeText) {
    const parsed = parseRange(rangeText, []);
    return {
      combos: parsed.combos.length,
      percent: (parsed.combos.length / TOTAL_COMBOS) * 100,
      classes: parsed.classes.length,
      unrecognized: parsed.unrecognized,
    };
  }

  return {
    RANKS,
    SUITS,
    TOTAL_COMBOS,
    expandToken,
    parseRange,
    rangeWidth,
    combosForClass,
    allStartingHandClasses,
  };
});
