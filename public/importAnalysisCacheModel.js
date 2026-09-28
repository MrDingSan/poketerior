(function attachImportAnalysisCacheModel(global) {
  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== "object") return value ?? null;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }

  function cacheKeyForImportedDecision(state = {}) {
    return JSON.stringify(stableValue(state));
  }

  function cloneValue(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function createImportAnalysisCache() {
    const entries = new Map();
    return {
      get(state) {
        const entry = entries.get(cacheKeyForImportedDecision(state));
        return entry ? cloneValue(entry) : null;
      },
      set(state, snapshot) {
        entries.set(cacheKeyForImportedDecision(state), cloneValue(snapshot));
      },
      clear() {
        entries.clear();
      },
      size() {
        return entries.size;
      },
    };
  }

  global.PokerCoachImportAnalysisCacheModel = {
    cacheKeyForImportedDecision,
    createImportAnalysisCache,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
