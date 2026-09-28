(function attachRangeDecisionContext(global) {
  function rangeDecisionOwner(importedDecisionContext = null) {
    return importedDecisionContext?.targetIsHero ? "hero" : importedDecisionContext ? "villain" : "hero";
  }

  function buildRangeDecisionContext(spot = {}) {
    if (spot.decisionOwner !== "hero") return { ...spot, freezeToPriorStreetRange: false };

    const {
      recordedHeroAction,
      recordedHeroAmount,
      decisionNode,
      decisionDescription,
      ...rangeSpot
    } = spot;
    const streetActions = Array.isArray(rangeSpot.streetActions) ? rangeSpot.streetActions : [];
    const hasCurrentStreetVillainAction = streetActions.some((action) => action?.actor && action.actor !== rangeSpot.heroPosition);

    return {
      ...rangeSpot,
      decisionNode: `${String(rangeSpot.street || "postflop").replace(/^./, (letter) => letter.toUpperCase())} Node: Hero to act`,
      decisionDescription: "Infer the villain range immediately before Hero's decision. The recorded Hero action is intentionally withheld.",
      freezeToPriorStreetRange: rangeSpot.street !== "preflop" && !hasCurrentStreetVillainAction,
    };
  }

  global.PokerCoachRangeDecisionContext = { buildRangeDecisionContext, rangeDecisionOwner };
})(typeof globalThis !== "undefined" ? globalThis : window);
