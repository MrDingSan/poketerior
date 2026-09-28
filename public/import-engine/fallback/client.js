(function attachImportFallbackClient(root) {
  const PURPOSES = Object.freeze(["hero-cards", "board-card", "action-text", "action-amount", "actor-row", "site-metadata"]);
  const ENDPOINT = "/api/import/v2/resolve";
  const CROP_PADDING_PX = 6;
  const CONTEXT_KEYS = ["street", "index", "actorName", "position", "type", "which"];

  function validRegion(region) {
    return Boolean(region)
      && [region.x, region.y, region.width, region.height].every(Number.isFinite)
      && region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0
      && region.x + region.width <= 1 && region.y + region.height <= 1;
  }

  function defaultEncodeCrop(canvas) {
    const dataUrl = canvas.toDataURL("image/png");
    return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: "image/png" };
  }

  // One client per import: it holds the decoded source, cuts out only the requested region, and uploads
  // that crop with a fixed purpose. The server owns the prompt; nothing else about the screenshot leaves the browser.
  function createClient({
    source,
    postJson,
    regions = root.PokerCoachImportRegions,
    encodeCrop = defaultEncodeCrop,
  }) {
    async function resolve(request = {}) {
      if (!PURPOSES.includes(request.purpose)) throw new Error(`Unsupported import purpose ${request.purpose}.`);
      if (!validRegion(request.region)) throw new Error("A normalized region inside the screenshot is required for targeted recovery.");
      const rect = regions.pixelRect(request.region, source);
      const canvas = regions.crop(source, rect, { padding: CROP_PADDING_PX, scale: 1 });
      const encoded = encodeCrop(canvas);

      const incoming = request.context || {};
      const context = {};
      for (const key of CONTEXT_KEYS) if (incoming[key] !== undefined) context[key] = incoming[key];
      if (Array.isArray(incoming.candidates)) context.candidates = incoming.candidates.slice(0, 6);
      if (request.site) context.site = request.site;

      const response = await postJson(ENDPOINT, {
        purpose: request.purpose,
        cropBase64: encoded.base64,
        mimeType: encoded.mimeType || "image/png",
        context,
        importId: request.importId ?? null,
      });
      if (!response || response.ok === false || response.value === undefined) {
        throw new Error(`Targeted recovery failed${response?.error ? `: ${response.error}` : "."}`);
      }
      return { value: response.value, confidence: response.confidence, provider: response.provider, model: response.model };
    }
    return { resolve };
  }

  const api = Object.freeze({ PURPOSES, ENDPOINT, createClient });
  root.PokerCoachImportFallback = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
