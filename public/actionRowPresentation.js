(function attachActionRowPresentation(global) {
  function isHeroActor(actor, heroPosition) {
    return Boolean(actor && heroPosition && actor === heroPosition);
  }

  global.PokerCoachActionRowPresentation = { isHeroActor };
})(typeof globalThis !== "undefined" ? globalThis : window);
