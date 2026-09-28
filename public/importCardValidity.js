(function initImportCardValidity(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PokerCoachImportCardValidity = api;
})(typeof window !== "undefined" ? window : globalThis, function buildImportCardValidity() {
  function duplicateCards(cards) {
    const seen = new Set();
    return [...new Set(cards.filter((card) => (seen.has(card) ? true : (seen.add(card), false))))];
  }

  function validateImportedCards(hand = {}) {
    const warnings = [];
    const hero = Array.isArray(hand.heroHand) ? hand.heroHand.filter(Boolean) : [];
    const flop = Array.isArray(hand.board?.flop) ? hand.board.flop.filter(Boolean) : [];
    const turn = hand.board?.turn || null;
    const river = hand.board?.river || null;
    const board = [...flop, turn, river].filter(Boolean);

    if (hero.length !== 2) warnings.push(`Hero hand must contain exactly two cards; found ${hero.length}.`);
    if (flop.length !== 0 && flop.length !== 3) warnings.push(`Flop must contain exactly three cards; found ${flop.length}.`);
    if (turn && flop.length !== 3) warnings.push("Turn requires a complete three-card flop.");
    if (river && !turn) warnings.push("River requires a turn card.");
    warnings.push(...duplicateCards(hero).map((card) => `Duplicate hero hole card ${card}.`));
    warnings.push(...duplicateCards(board).map((card) => `Duplicate community card ${card}.`));

    const boardSet = new Set(board);
    for (const card of hero) {
      if (boardSet.has(card)) warnings.push(`Card ${card} appears in both hero hand and community board.`);
    }

    return { valid: warnings.length === 0, warnings };
  }

  return { validateImportedCards };
});
