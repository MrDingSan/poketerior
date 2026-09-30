// Hero's equity against each villain combo, counted exactly over every runout once the flop is out (990
// turn+river pairs on the flop, 44 rivers on the turn, the one board on the river); preflop, with 1.7M
// boards per combo, it is sampled. The bucket boundaries describe the matchup rather than a single cut:
//   ahead          >= 55%
//   near flip      45-55%   (a coin flip, give or take a few points)
//   behind, live   10-45%   (behind now, with real outs)
//   thin or dead   < 10%    (less than a gutshot's worth on the turn: 4 outs / 44 cards = 9%)
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PokerCoachHandEquity = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const RANKS = "23456789TJQKA";
  const SUITS = "cdhs";
  const RANK_VALUE = Object.fromEntries([...RANKS].map((rank, index) => [rank, index + 2]));
  const DECK = [...RANKS].flatMap((rank) => [...SUITS].map((suit) => rank + suit));
  const PREFLOP_SAMPLES = 300;
  const BUCKETS = { ahead: 0.55, flipLow: 0.45, thin: 0.1 };

  function highStraight(mask) {
    // Bit v is rank v (2..14); the ace also plays low as bit 1.
    const bits = mask | (mask & (1 << 14) ? 2 : 0);
    for (let high = 14; high >= 5; high -= 1) {
      const need = 0b11111 << (high - 4);
      if ((bits & need) === need) return high;
    }
    return 0;
  }

  // Category (8 straight flush .. 0 high card) and up to five tiebreak ranks, packed into one comparable number.
  function pack(category, ranks) {
    let value = category;
    for (let index = 0; index < 5; index += 1) value = value * 16 + (ranks[index] || 0);
    return value;
  }

  function topRanks(mask, count, exclude = []) {
    const out = [];
    for (let rank = 14; rank >= 2 && out.length < count; rank -= 1) {
      if (mask & (1 << rank) && !exclude.includes(rank)) out.push(rank);
    }
    return out;
  }

  function score(cards) {
    const counts = new Array(15).fill(0);
    const suitMasks = { c: 0, d: 0, h: 0, s: 0 };
    const suitCounts = { c: 0, d: 0, h: 0, s: 0 };
    let mask = 0;
    for (const card of cards) {
      const rank = RANK_VALUE[card[0]];
      counts[rank] += 1;
      mask |= 1 << rank;
      suitMasks[card[1]] |= 1 << rank;
      suitCounts[card[1]] += 1;
    }
    const flushSuit = SUITS.split("").find((suit) => suitCounts[suit] >= 5);
    if (flushSuit) {
      const straightFlush = highStraight(suitMasks[flushSuit]);
      if (straightFlush) return pack(8, [straightFlush]);
    }
    const quads = [];
    const trips = [];
    const pairs = [];
    for (let rank = 14; rank >= 2; rank -= 1) {
      if (counts[rank] === 4) quads.push(rank);
      else if (counts[rank] === 3) trips.push(rank);
      else if (counts[rank] === 2) pairs.push(rank);
    }
    if (quads.length) return pack(7, [quads[0], ...topRanks(mask, 1, [quads[0]])]);
    if (trips.length && (trips.length > 1 || pairs.length)) return pack(6, [trips[0], trips[1] || pairs[0]]);
    if (flushSuit) return pack(5, topRanks(suitMasks[flushSuit], 5));
    const straight = highStraight(mask);
    if (straight) return pack(4, [straight]);
    if (trips.length) return pack(3, [trips[0], ...topRanks(mask, 2, [trips[0]])]);
    if (pairs.length >= 2) return pack(2, [pairs[0], pairs[1], ...topRanks(mask, 1, [pairs[0], pairs[1]])]);
    if (pairs.length) return pack(1, [pairs[0], ...topRanks(mask, 3, [pairs[0]])]);
    return pack(0, topRanks(mask, 5));
  }

  function runouts(deadCards, missing) {
    const dead = new Set(deadCards);
    const live = DECK.filter((card) => !dead.has(card));
    if (missing === 0) return [[]];
    if (missing === 1) return live.map((card) => [card]);
    const out = [];
    for (let a = 0; a < live.length; a += 1) for (let b = a + 1; b < live.length; b += 1) out.push([live[a], live[b]]);
    return out;
  }

  function sampledRunout(deadCards, missing) {
    const dead = new Set(deadCards);
    const live = DECK.filter((card) => !dead.has(card));
    const out = [];
    while (out.length < missing) out.push(live.splice(Math.floor(Math.random() * live.length), 1)[0]);
    return out;
  }

  // Hero's equity against one combo: exact from the flop on, sampled preflop. heroScores caches hero's hand
  // per runout, which is shared by every villain combo that does not block it.
  function equityVsCombo(heroCards, combo, boardCards, heroScores = new Map()) {
    const missing = 5 - boardCards.length;
    const dead = [...heroCards, ...boardCards, ...combo];
    const boards = missing > 2
      ? Array.from({ length: PREFLOP_SAMPLES }, () => sampledRunout(dead, missing))
      : runouts(dead, missing);
    let points = 0;
    for (const extra of boards) {
      const board = [...boardCards, ...extra];
      const key = missing > 2 ? null : extra.join("");
      let hero = key !== null ? heroScores.get(key) : undefined;
      if (hero === undefined) {
        hero = score([...heroCards, ...board]);
        if (key !== null) heroScores.set(key, hero);
      }
      const villain = score([...combo, ...board]);
      points += hero > villain ? 1 : hero === villain ? 0.5 : 0;
    }
    return { equity: boards.length ? points / boards.length : 0, exact: missing <= 2 };
  }

  function average(items) {
    return items.length ? items.reduce((sum, item) => sum + item.equity, 0) / items.length : null;
  }

  // Every combo's matchup, the four buckets with their average equity, the range equity (mean over combos,
  // so it always agrees with the buckets), and how many combos Hero has the price against.
  function rangeMatchups(heroCards, villainCombos, boardCards, { potOdds = null } = {}) {
    const known = new Set([...heroCards, ...boardCards]);
    const combos = villainCombos.filter((combo) => combo.every((card) => !known.has(card)));
    const heroScores = new Map();
    let exact = true;
    const items = combos.map((combo) => {
      const result = equityVsCombo(heroCards, combo, boardCards, heroScores);
      exact = exact && result.exact;
      return { combo, equity: result.equity };
    });
    const buckets = { ahead: [], close: [], live: [], thin: [] };
    for (const item of items) {
      if (item.equity >= BUCKETS.ahead) buckets.ahead.push(item);
      else if (item.equity >= BUCKETS.flipLow) buckets.close.push(item);
      else if (item.equity >= BUCKETS.thin) buckets.live.push(item);
      else buckets.thin.push(item);
    }
    for (const list of Object.values(buckets)) list.sort((a, b) => b.equity - a.equity);
    const priced = Number.isFinite(potOdds) && potOdds > 0 ? items.filter((item) => item.equity >= potOdds).length : null;
    return {
      equity: average(items) ?? 0,
      exact,
      total: items.length,
      buckets,
      averages: Object.fromEntries(Object.entries(buckets).map(([key, list]) => [key, average(list)])),
      potOdds: Number.isFinite(potOdds) && potOdds > 0 ? potOdds : null,
      priced,
    };
  }

  return { score, equityVsCombo, rangeMatchups, BUCKETS };
});
