(function attachImportDispatch(root) {
  function chooseRoute({ capabilities, runtime, detection }) {
    if (!capabilities?.importEngineV2Enabled) return { route: "legacy", reason: "v2-disabled" };
    if (!runtime) return { route: "legacy", reason: "runtime-unavailable" };
    if (!detection?.supported) return { route: "legacy", reason: "unsupported-layout" };
    const site = String(detection.detection?.site || detection.adapter?.site || "").toLowerCase();
    const configured = (capabilities.importEngineV2Sites || []).some((name) => String(name).toLowerCase() === site);
    if (!site || !configured) return { route: "legacy", reason: "site-not-configured" };
    return { route: "v2", reason: "supported-site" };
  }

  // A replacement import may only supplant the current session once it reaches a replayed hand with real actions.
  function isReplayable(result) {
    return Boolean(result && result.route === "v2" && result.converted?.preflopState && result.hand?.actions?.preflop?.length);
  }

  // Canonical result -> the legacy import shape the app already normalizes, edits, and analyzes.
  function legacyHandFromResult(result) {
    const warnings = result.hand?.warnings || [];
    return {
      ...result.legacy,
      validationWarnings: warnings.map((warning) => warning.message),
      actionAttribution: { safe: Boolean(result.valid), issues: [...new Set(warnings.map((warning) => warning.code))] },
    };
  }

  function providerLabel(result) {
    const source = result?.hand?.source;
    return { provider: "import-engine-v2", model: source?.adapterId ? `${source.adapterId}@${source.adapterVersion}` : null };
  }

  const api = Object.freeze({ chooseRoute, isReplayable, legacyHandFromResult, providerLabel });
  root.PokerCoachImportDispatch = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
