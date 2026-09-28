(function attachActionPolicy(root) {
  function normalizeAction(action) {
    return String(action || "").toLowerCase().replace(/[-_\s]/g, "");
  }

  function isAllInAction(action) {
    return normalizeAction(action) === "allin";
  }

  function legalActionsForNode(node = {}) {
    if (node.terminal) return ["Review"];
    if (node.facingAllIn) return ["Fold", "Call"];
    if (node.facingBet) return ["Fold", "Call", "Raise"];
    return ["Check", "Bet"];
  }

  function constrainRecommendation(action, node = {}, metrics = {}) {
    const legalActions = legalActionsForNode(node);
    if (legalActions.includes(action)) return action;
    if (node.facingAllIn && action === "Raise") {
      return Number(metrics.ev) >= 0 && Number(metrics.equity) >= Number(metrics.potOdds) ? "Call" : "Fold";
    }
    return legalActions[0] || "Review";
  }

  const api = {
    isAllInAction,
    legalActionsForNode,
    constrainRecommendation,
  };

  root.PokerCoachActionPolicy = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
