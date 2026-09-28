(function attachApiClient(root) {
  const DEFAULT_LOCAL_API_ORIGIN = "http://localhost:4175";

  function resolveApiUrl(url, locationLike = root.location) {
    if (!String(url).startsWith("/api/")) return url;
    if (locationLike?.protocol === "file:") return `${DEFAULT_LOCAL_API_ORIGIN}${url}`;
    return url;
  }

  root.PokerCoachApiClient = { DEFAULT_LOCAL_API_ORIGIN, resolveApiUrl };
})(typeof globalThis !== "undefined" ? globalThis : window);
