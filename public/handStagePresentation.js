(function attachHandStagePresentation(global) {
  const STREETS = ["preflop", "flop", "turn", "river", "results"];

  function buildProgress(activeStreet, completedStreets = []) {
    return STREETS.map((street) => ({
      street,
      status: street === activeStreet
        ? "current"
        : completedStreets.includes(street) ? "complete" : "pending",
    }));
  }

  function buildTimeline(actions = [], selectedKey = null) {
    let previousStreet = null;
    return actions.flatMap((action, index) => {
      const entries = [];
      if (action.street !== previousStreet) entries.push({ type: "street", street: action.street });
      entries.push({ type: "action", index: index + 1, ...action, selected: action.key === selectedKey });
      previousStreet = action.street;
      return entries;
    });
  }

  global.PokeTeriorHandStagePresentation = { buildProgress, buildTimeline };
})(typeof globalThis !== "undefined" ? globalThis : window);
