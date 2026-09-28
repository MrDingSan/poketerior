(function attachPreflopSpotModel(global) {
  function isAggressive(action) {
    return action === "open" || action === "allin" || String(action || "").startsWith("raise");
  }

  function inferPreflopSpot(actions = [], heroPosition, villainPosition) {
    const visibleActions = actions.filter((item) => item?.actor && item?.action);
    const villainActions = visibleActions.filter((item) => item.actor === villainPosition);
    const heroActions = visibleActions.filter((item) => item.actor === heroPosition);
    const heroAggression = heroActions.find((item) => item.action === "open" || String(item.action || "").startsWith("raise"));
    const lastVillainAction = [...villainActions].reverse()[0];
    const firstVillainAction = villainActions[0];
    const firstHeroAction = heroActions[0];

    if (lastVillainAction?.action === "call" && heroAggression?.action?.startsWith("raise")) {
      return { action: "call_vs_3bet", description: `${villainPosition} opened, ${heroPosition} raised, ${villainPosition} called` };
    }
    if (lastVillainAction?.action?.startsWith("raise") && heroAggression?.action === "open") {
      return { action: "3bet_vs_open", description: `${villainPosition} raised versus ${heroPosition} open` };
    }
    if (lastVillainAction?.action === "call" && heroAggression?.action === "open") {
      return { action: "call_vs_open", description: `${villainPosition} called versus ${heroPosition} open` };
    }
    if (firstVillainAction?.action === "open") {
      return { action: "open", description: `${villainPosition} opened preflop` };
    }
    if (!villainActions.length && firstHeroAction?.action === "call" && !heroAggression) {
      return { action: "open", description: `${villainPosition} opened preflop, ${heroPosition} called` };
    }
    if (lastVillainAction?.action === "call") {
      return { action: "call_vs_open", description: `${villainPosition} called preflop` };
    }
    if (lastVillainAction && isAggressive(lastVillainAction.action)) {
      return { action: "open", description: `${villainPosition} opened preflop` };
    }
    return { action: "open", description: `${villainPosition} opened preflop` };
  }

  global.PokerCoachPreflopSpotModel = {
    inferPreflopSpot,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
