import { cardText } from "./cardText.js";
const RANKS = new Set(["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"]);
const SUITS = new Set(["c", "d", "h", "s"]);

function normalizeCard(value, label) {
  const raw = String(value || "").trim();
  const match = cardText(raw).match(/^(10|[2-9TJQKA])([cdhs])$/i);
  const rank = match?.[1]?.toUpperCase() === "10" ? "T" : match?.[1]?.toUpperCase();
  const suit = match?.[2]?.toLowerCase();
  if (!RANKS.has(rank) || !SUITS.has(suit)) {
    throw new Error(`Invalid ${label} card "${raw || "empty"}".`);
  }
  return `${rank}${suit}`;
}

function normalizeOptionalCard(value, label) {
  return value === null || value === undefined || String(value).trim() === ""
    ? null
    : normalizeCard(value, label);
}

function duplicateCards(cards) {
  const seen = new Set();
  return [...new Set(cards.filter((card) => (seen.has(card) ? true : (seen.add(card), false))))];
}

export function normalizeAndValidateImportedCards(hand = {}) {
  const notes = [];
  const warnings = [];
  let heroHand = Array.isArray(hand.heroHand)
    ? hand.heroHand.map((card) => normalizeCard(card, "hero"))
    : [];
  if (heroHand.length !== 2) {
    throw new Error(`Screenshot import must contain exactly two hero hole cards; received ${heroHand.length}.`);
  }
  warnings.push(...duplicateCards(heroHand).map((card) => `Duplicate hero hole card ${card}.`));

  const rawFlop = Array.isArray(hand.board?.flop) ? hand.board.flop : [];
  const normalizedFlop = rawFlop.map((card) => normalizeCard(card, "community"));
  let flop = normalizedFlop;
  let turn = normalizeOptionalCard(hand.board?.turn, "turn");
  let river = normalizeOptionalCard(hand.board?.river, "river");

  if (normalizedFlop.length === 5) {
    [flop, turn, river] = [normalizedFlop.slice(0, 3), normalizedFlop[3], normalizedFlop[4]];
    notes.push("Split an ordered five-card flop array into the three-card flop, turn, and river; ignored conflicting street fields.");
  } else if (normalizedFlop.length !== 0 && normalizedFlop.length !== 3) {
    throw new Error(`Screenshot import flop must contain exactly three cards; received ${normalizedFlop.length}.`);
  }

  if (turn && flop.length !== 3) throw new Error("Screenshot import cannot contain a turn without a three-card flop.");
  if (river && !turn) throw new Error("Screenshot import cannot contain a river without a turn.");

  const boardCards = [...flop, turn, river].filter(Boolean);
  warnings.push(...duplicateCards(boardCards).map((card) => `Duplicate community card ${card}.`));
  const boardSet = new Set(boardCards);
  const coinPokerHeartCollision =
    /coinpoker/i.test(String(hand.site || "")) &&
    heroHand.some((card) => card[1] === "h" && boardSet.has(card));
  if (coinPokerHeartCollision) {
    const diamondHand = heroHand.map((card) => (card[1] === "h" ? `${card[0]}d` : card));
    if (diamondHand.every((card) => !boardSet.has(card)) && new Set(diamondHand).size === diamondHand.length) {
      notes.push(`Repaired CoinPoker hero red suits from hearts to diamonds after a physical-card collision: ${heroHand.join(" ")} -> ${diamondHand.join(" ")}.`);
      heroHand = diamondHand;
    }
  }
  for (const card of heroHand) {
    if (boardSet.has(card)) warnings.push(`Card ${card} appears in both hero hand and community board.`);
  }

  return {
    hand: {
      ...hand,
      heroHand,
      board: { flop, turn, river },
    },
    notes,
    warnings,
  };
}
