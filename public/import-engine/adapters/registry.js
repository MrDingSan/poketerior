(function attachImportAdapterRegistry(root) {
  const SUPPORTED_SCORE_THRESHOLD = 0.8;

  function clampScore(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
  }

  function createRegistry(adapters = []) {
    const registered = adapters.slice();
    for (const adapter of registered) {
      if (!adapter || typeof adapter.detect !== "function") {
        throw new Error(`Import adapter ${adapter?.id || "unknown"} must implement detect(context).`);
      }
    }

    function detect(context = {}) {
      const attempts = [];
      let best = null;
      for (const adapter of registered) {
        let detection;
        try {
          const result = adapter.detect(context) || {};
          detection = { ...result, adapterId: adapter.id, score: clampScore(result.score), evidence: Array.from(result.evidence || []) };
          attempts.push({ id: adapter.id, score: detection.score, evidence: detection.evidence });
        } catch (error) {
          attempts.push({ id: adapter.id, score: 0, evidence: [], error: error.message });
          continue;
        }
        if (!best || detection.score > best.detection.score) best = { adapter, detection };
      }
      const supported = Boolean(best && best.detection.score >= SUPPORTED_SCORE_THRESHOLD);
      return {
        supported,
        adapter: supported ? best.adapter : null,
        detection: best ? best.detection : null,
        attempts,
      };
    }

    return { adapters: registered, detect };
  }

  const api = Object.freeze({ SUPPORTED_SCORE_THRESHOLD, createRegistry });
  root.PokerCoachImportAdapters = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
