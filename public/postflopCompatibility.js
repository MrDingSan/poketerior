(function attachPostflopCompatibility(root) {
  function actionRowData(action = {}) {
    return {
      actor: action.actor || "",
      action: action.action || action.type || "",
      amount: Number(action.amount ?? (Number(action.incrementAmountUnits || 0) / 10)),
    };
  }

  root.PokerCoachPostflopCompatibility = { actionRowData };
})(typeof globalThis !== "undefined" ? globalThis : window);
