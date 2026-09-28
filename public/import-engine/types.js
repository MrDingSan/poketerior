(function attachImportTypes(root) {
  const STREETS = Object.freeze(["preflop", "flop", "turn", "river"]);
  const ACTIONS = Object.freeze(["fold", "check", "call", "bet", "raise", "allin", "ante", "blind", "refund", "win", "muck"]);
  const AMOUNT_KINDS = Object.freeze(["increment", "street-total", "stack-total", "none", "unknown"]);
  const CONFIDENCE_THRESHOLDS = Object.freeze({ high: 0.9, medium: 0.65 });
  const CARD_PATTERN = /^(10|[2-9TJQKA])([cdhs])$/i;

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function finiteOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function fieldRef(parts) {
    return (parts || []).filter((part) => part !== null && part !== undefined && part !== "").join(".");
  }

  function confidenceLevel(value) {
    const number = Number(value);
    if (number >= CONFIDENCE_THRESHOLDS.high) return "high";
    if (number >= CONFIDENCE_THRESHOLDS.medium) return "medium";
    return "low";
  }

  function normalizeCard(card) {
    const match = String(card ?? "").trim().match(CARD_PATTERN);
    if (!match) throw new Error(`Unreadable card token ${JSON.stringify(card)}.`);
    const rank = match[1] === "10" ? "T" : match[1].toUpperCase();
    return `${rank}${match[2].toLowerCase()}`;
  }

  function normalizeCards(cards) {
    return (Array.isArray(cards) ? cards : []).map(normalizeCard);
  }

  function normalizePosition(position) {
    const value = String(position ?? "").trim().toUpperCase();
    return value || null;
  }

  function pickExtras(source, known) {
    const extras = {};
    for (const [key, value] of Object.entries(source || {})) {
      if (!known.includes(key) && value !== undefined) extras[key] = clone(value);
    }
    return Object.keys(extras).length ? extras : null;
  }

  const ACTION_KEYS = ["id", "actorId", "actorName", "actor", "position", "type", "action", "amountBb", "amountKind", "rawText", "sourceRegion", "legacy"];
  const PLAYER_KEYS = ["id", "name", "position", "startingStackBb", "stackBb", "isHero", "legacy"];

  function normalizeAction(action, street, index) {
    const type = String(action?.type || action?.action || "").toLowerCase();
    if (!ACTIONS.includes(type)) throw new Error(`Unsupported import action ${type || "empty"}.`);
    const amountBb = finiteOrNull(action.amountBb);
    if (amountBb !== null && amountBb < 0) throw new Error(`Import action ${street}:${index} has a negative amount.`);
    const legacy = action.legacy || pickExtras(action, ACTION_KEYS);
    return {
      id: action.id || `${street}:${index}`,
      actorId: action.actorId || null,
      actorName: action.actorName || action.actor || null,
      position: normalizePosition(action.position),
      type,
      amountBb,
      amountKind: AMOUNT_KINDS.includes(action.amountKind) ? action.amountKind : "unknown",
      rawText: String(action.rawText || ""),
      sourceRegion: action.sourceRegion ? clone(action.sourceRegion) : null,
      ...(legacy ? { legacy: clone(legacy) } : {}),
    };
  }

  function normalizePlayer(player, index) {
    const legacy = player.legacy || pickExtras(player, PLAYER_KEYS);
    return {
      id: player.id || `player:${index}`,
      name: player.name ?? null,
      position: normalizePosition(player.position),
      startingStackBb: finiteOrNull(player.startingStackBb ?? player.stackBb),
      isHero: Boolean(player.isHero),
      ...(legacy ? { legacy: clone(legacy) } : {}),
    };
  }

  function normalizeWarning(warning) {
    if (typeof warning === "string") {
      return { code: "warning", severity: "warning", field: null, message: warning, correctable: false };
    }
    return {
      code: String(warning?.code || "warning"),
      severity: String(warning?.severity || "warning"),
      field: warning?.field ?? null,
      message: String(warning?.message || ""),
      correctable: Boolean(warning?.correctable),
    };
  }

  function normalizeParsedHand(input = {}) {
    const source = input.source || {};
    const game = input.game || {};
    const players = (input.players || []).map(normalizePlayer);
    const heroPlayer = players.find((player) => player.id === input.hero?.playerId) || players.find((player) => player.isHero) || null;
    const hero = input.hero || {};
    const actions = {};
    for (const street of STREETS) {
      actions[street] = (input.actions?.[street] || []).map((action, index) => normalizeAction(action, street, index));
    }
    const streetPots = {};
    for (const street of STREETS) streetPots[street] = finiteOrNull(input.streetPots?.[street]);
    const overall = Math.min(1, Math.max(0, Number(input.confidence?.overall) || 0));
    const validation = input.validation || {};
    return {
      source: {
        kind: source.kind || "screenshot",
        site: source.site ?? null,
        adapterId: source.adapterId ?? null,
        adapterVersion: source.adapterVersion ?? null,
        importId: source.importId ?? null,
      },
      game: {
        variant: game.variant || "nlhe",
        tableSize: finiteOrNull(game.tableSize),
        stakesText: game.stakesText ?? null,
        smallBlindBb: finiteOrNull(game.smallBlindBb),
        bigBlindBb: finiteOrNull(game.bigBlindBb),
        anteBb: finiteOrNull(game.anteBb),
      },
      hero: {
        playerId: hero.playerId ?? heroPlayer?.id ?? null,
        name: hero.name ?? heroPlayer?.name ?? null,
        position: normalizePosition(hero.position ?? heroPlayer?.position),
        cards: normalizeCards(hero.cards),
      },
      players,
      board: {
        flop: normalizeCards(input.board?.flop),
        turn: input.board?.turn ? normalizeCard(input.board.turn) : null,
        river: input.board?.river ? normalizeCard(input.board.river) : null,
      },
      actions,
      streetPots,
      confidence: {
        overall,
        level: confidenceLevel(overall),
        fields: clone(input.confidence?.fields || {}),
        recognitionAttempts: clone(input.confidence?.recognitionAttempts || []),
      },
      warnings: (input.warnings || []).map(normalizeWarning),
      validation: {
        valid: validation.valid ?? null,
        blockingIssues: clone(validation.blockingIssues || []),
        replayIssues: clone(validation.replayIssues || []),
        reconciledPots: clone(validation.reconciledPots || {}),
      },
      ...(input.legacyExtras ? { legacyExtras: clone(input.legacyExtras) } : {}),
    };
  }

  const api = Object.freeze({
    STREETS,
    ACTIONS,
    AMOUNT_KINDS,
    CONFIDENCE_THRESHOLDS,
    fieldRef,
    confidenceLevel,
    normalizeCard,
    normalizeCards,
    normalizePosition,
    normalizeParsedHand,
  });
  root.PokerCoachImportTypes = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
