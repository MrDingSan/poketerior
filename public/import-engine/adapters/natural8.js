(function attachNatural8Adapter(root) {
  const PROFILE = "classic-tall-v1";
  const WEIGHTS = { tallAspect: 0.1, historyBoundary: 0.2, fiveColumns: 0.25, streetHeadings: 0.3, tableCards: 0.15 };

  // Normalized geometry measured from the 1280x2022 structured tall layout: header strip, table (with
  // board and Hero cards), then a history panel of five equal columns (Blinds, Pre-Flop, Flop, Turn, River).
  const HISTORY_TOP = 0.49;
  const HEADING_HEIGHT = 0.0525;
  const ROWS_TOP = 0.554;
  const COLUMN_WIDTH = 0.2;
  const COLUMNS = ["blinds", "preflop", "flop", "turn", "river"];
  const CARD = { y: 0.2165, width: 0.0845, height: 0.076, xs: [0.2733, 0.3657, 0.4581, 0.5498, 0.6421] };

  const PROFILE_REGIONS = {
    metadata: { x: 0, y: 0, width: 1, height: 0.035 },
    board: { x: 0.2725, y: CARD.y, width: 0.4542, height: CARD.height },
    boardCards: CARD.xs.map((x) => ({ x, y: CARD.y, width: CARD.width, height: CARD.height })),
    heroCards: { x: 0.4305, y: 0.375, width: 0.138, height: 0.0425 },
    heroCardSlots: [
      { x: 0.4329, y: 0.375, width: 0.0569, height: 0.0425 },
      { x: 0.4897, y: 0.375, width: 0.0758, height: 0.0425 },
    ],
    history: { x: 0, y: HISTORY_TOP, width: 1, height: 1 - HISTORY_TOP },
    blinds: columnRegion(0, ROWS_TOP),
    streets: {
      preflop: columnRegion(1, ROWS_TOP),
      flop: columnRegion(2, ROWS_TOP),
      turn: columnRegion(3, ROWS_TOP),
      river: columnRegion(4, ROWS_TOP),
    },
    streetHeadings: Object.fromEntries(COLUMNS.map((name, index) => [name, columnRegion(index, HISTORY_TOP + 0.0025, HEADING_HEIGHT)])),
  };

  function columnRegion(index, top, height) {
    return { x: index * COLUMN_WIDTH, y: top, width: COLUMN_WIDTH, height: height ?? 1 - top };
  }

  function mapRegions(value, convert) {
    if (Array.isArray(value)) return value.map((item) => mapRegions(item, convert));
    if (value && typeof value.width === "number") return convert(value);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapRegions(item, convert)]));
  }

  function isTall(context) {
    const ratio = Number(context.height) / Number(context.width);
    return ratio >= 1.4 && ratio <= 1.9;
  }

  function detect(context = {}) {
    const anchors = { ...(context.anchors || {}) };
    if (anchors.tallAspect === undefined) anchors.tallAspect = isTall(context);
    const evidence = Object.keys(WEIGHTS).filter((key) => anchors[key]);
    const raw = evidence.reduce((sum, key) => sum + WEIGHTS[key], 0);
    const score = Math.round(raw * 1e4) / 1e4;
    const threshold = root.PokerCoachImportAdapters?.SUPPORTED_SCORE_THRESHOLD ?? 0.8;
    return {
      score,
      evidence,
      profile: PROFILE,
      site: anchors.streetHeadings && score >= threshold ? "Natural8" : null,
    };
  }

  function regions(image) {
    const rects = root.PokerCoachImportRegions;
    return {
      profile: PROFILE,
      normalized: mapRegions(PROFILE_REGIONS, (rect) => ({ ...rect })),
      pixels: mapRegions(PROFILE_REGIONS, (rect) => rects.pixelRect(rect, image)),
    };
  }

  const adapter = Object.freeze({ id: "natural8", site: "Natural8", version: "1", profile: PROFILE, detect, regions });
  root.PokerCoachNatural8Adapter = adapter;
  if (typeof module !== "undefined" && module.exports) module.exports = adapter;
})(typeof globalThis !== "undefined" ? globalThis : window);
