const RANK_VALUE = Object.fromEntries("23456789TJQKA".split("").map((rank, index) => [rank, index + 2]));
const RANK_NAME = { 2: "deuces", 3: "threes", 4: "fours", 5: "fives", 6: "sixes", 7: "sevens", 8: "eights", 9: "nines", T: "tens", J: "jacks", Q: "queens", K: "kings", A: "aces" };
const HIGH_NAME = { T: "ten", J: "jack", Q: "queen", K: "king", A: "ace" };
const SUIT_NAME = { c: "club", d: "diamond", h: "heart", s: "spade" };
const STRAIGHT_WINDOWS = [
  new Set([14, 2, 3, 4, 5]),
  ...Array.from({ length: 9 }, (_, index) => new Set(Array.from({ length: 5 }, (__, offset) => index + offset + 2))),
];

function parseCards(text) {
  return String(text || "")
    .trim()
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((raw) => {
      const match = raw.match(/^(10|[2-9TJQKA])([cdhs])$/i);
      if (!match) throw new Error(`Invalid card ${raw}.`);
      return { rank: match[1].toUpperCase() === "10" ? "T" : match[1].toUpperCase(), suit: match[2].toLowerCase() };
    });
}

function straightWindowsCompletedBy(values, missingCount) {
  return STRAIGHT_WINDOWS.filter((window) => [...window].filter((value) => !values.has(value)).length === missingCount);
}

function madeHand(cards) {
  const rankCounts = new Map();
  const suitCounts = new Map();
  for (const card of cards) {
    rankCounts.set(card.rank, (rankCounts.get(card.rank) || 0) + 1);
    suitCounts.set(card.suit, (suitCounts.get(card.suit) || 0) + 1);
  }
  const values = new Set(cards.map((card) => RANK_VALUE[card.rank]));
  if ([...suitCounts.values()].some((count) => count >= 5)) return "flush";
  if (straightWindowsCompletedBy(values, 0).length) return "straight";
  const groups = [...rankCounts.entries()].sort((a, b) => b[1] - a[1] || RANK_VALUE[b[0]] - RANK_VALUE[a[0]]);
  if (groups[0]?.[1] === 4) return "four of a kind";
  if (groups[0]?.[1] === 3 && groups[1]?.[1] >= 2) return "full house";
  if (groups[0]?.[1] === 3) return `three ${RANK_NAME[groups[0][0]]}`;
  const pairs = groups.filter(([, count]) => count === 2);
  if (pairs.length >= 2) return `two pair, ${RANK_NAME[pairs[0][0]]} and ${RANK_NAME[pairs[1][0]]}`;
  if (pairs.length === 1) return `pair of ${RANK_NAME[pairs[0][0]]}`;
  const highRank = cards.slice().sort((a, b) => RANK_VALUE[b.rank] - RANK_VALUE[a.rank])[0]?.rank;
  return `${HIGH_NAME[highRank] || highRank}-high`;
}

export function deriveHeroHandFacts({ heroHand = "", board = "" } = {}) {
  const hero = parseCards(heroHand);
  const boardCards = parseCards(board);
  const cards = [...hero, ...boardCards];
  const values = new Set(cards.map((card) => RANK_VALUE[card.rank]));
  const completingRanks = new Set();
  for (const window of straightWindowsCompletedBy(values, 1)) {
    for (const value of window) if (!values.has(value)) completingRanks.add(value);
  }
  const directStraightDraw = completingRanks.size >= 2 ? "open-ended" : completingRanks.size === 1 ? "gutshot" : "none";

  const suitCounts = new Map();
  for (const card of cards) suitCounts.set(card.suit, (suitCounts.get(card.suit) || 0) + 1);
  const directFlushSuit = [...suitCounts.entries()].find(([, count]) => count === 4)?.[0] || null;
  const directFlushDraw = directFlushSuit && boardCards.length < 5 ? `${SUIT_NAME[directFlushSuit]} flush draw` : "none";
  const backdoorFlushDraw = boardCards.length === 3 && [...suitCounts.values()].some((count) => count === 3);
  const backdoorStraightDraw = boardCards.length === 3 && directStraightDraw === "none" && straightWindowsCompletedBy(values, 2).length > 0;
  const boardHigh = Math.max(0, ...boardCards.map((card) => RANK_VALUE[card.rank]));
  const overcards = hero.filter((card) => RANK_VALUE[card.rank] > boardHigh).map((card) => card.rank);
  const made = madeHand(cards);

  const clauses = [
    `${made[0].toUpperCase()}${made.slice(1)}${overcards.length ? ` with ${overcards.length === 2 ? "two" : "one"} overcard${overcards.length === 1 ? "" : "s"}` : ""}`,
    directStraightDraw === "none" ? "no direct straight draw" : `${directStraightDraw} straight draw`,
    directFlushDraw === "none" ? "no direct flush draw" : directFlushDraw,
  ];
  const backdoors = [backdoorStraightDraw ? "straight" : null, backdoorFlushDraw ? "flush" : null].filter(Boolean);
  if (backdoors.length) clauses.push(`backdoor ${backdoors.join(" and ")} possibilities only`);

  return {
    madeHand: made,
    overcards,
    directStraightDraw,
    directFlushDraw,
    backdoorStraightDraw,
    backdoorFlushDraw,
    summary: `${clauses.join("; ")}.`,
  };
}
