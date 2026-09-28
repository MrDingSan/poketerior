(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PokerCoachProviderAttribution = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function attributionForResult(result) {
    if (result?.provider !== "nebius") return null;
    return {
      label: "Powered by NVIDIA Nemotron via Nebius Token Factory",
      detail: result.model || "NVIDIA Nemotron",
    };
  }

  return { attributionForResult };
});
