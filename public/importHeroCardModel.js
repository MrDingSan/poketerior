(function initImportHeroCardModel(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PokerCoachImportHeroCards = api;
})(typeof window !== "undefined" ? window : globalThis, function buildImportHeroCardModel() {
  function playerKey(name) {
    return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function initializeCardOwnership(hand = {}) {
    const alreadyInitialized = Boolean(hand.holeCardsByPlayer);
    hand.holeCardsByPlayer = hand.holeCardsByPlayer || {};
    const owner = hand.heroHandOwner || hand.heroName;
    const cards = Array.isArray(hand.heroHand) ? hand.heroHand.filter(Boolean) : [];
    if (!alreadyInitialized && owner && cards.length === 2) {
      hand.holeCardsByPlayer[playerKey(owner)] = [...cards];
    }
    return hand;
  }

  function cardsForSelectedHero(hand = {}, selectedName) {
    initializeCardOwnership(hand);
    return [...(hand.holeCardsByPlayer[playerKey(selectedName)] || [])];
  }

  function setCardsForSelectedHero(hand = {}, selectedName, cards = []) {
    initializeCardOwnership(hand);
    const key = playerKey(selectedName);
    if (key) hand.holeCardsByPlayer[key] = [...cards];
    hand.heroName = String(selectedName || "").trim();
    hand.heroHandOwner = hand.heroName;
    hand.heroHand = [...cards];
    return hand;
  }

  return {
    cardsForSelectedHero,
    initializeCardOwnership,
    playerKey,
    setCardsForSelectedHero,
  };
});
