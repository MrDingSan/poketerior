(function attachLegacyImportAdapter(root) {
  const TYPES = root.PokerCoachImportTypes;
  const CONSUMED_KEYS = ["site", "heroName", "heroHand", "players", "board", "streets", "validationWarnings"];

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function readableCards(cards, field, warnings) {
    const valid = [];
    for (const card of Array.isArray(cards) ? cards : []) {
      try {
        valid.push(TYPES.normalizeCard(card));
      } catch {
        warnings.push({ code: "unreadable-card", severity: "warning", field, message: `Unreadable card ${JSON.stringify(card)} was dropped.`, correctable: true });
      }
    }
    return valid;
  }

  function fromLegacy(hand = {}, metadata = {}) {
    if (!TYPES) throw new Error("PokerCoachImportTypes must load before the legacy import adapter.");
    const warnings = [];
    const players = (hand.players || []).map((player, index) => ({ ...clone(player), id: `player:${index}` }));
    const idByName = new Map(players.map((player) => [player.name, player.id]));
    const heroPlayer = players.find((player) => player.name === hand.heroName) || players.find((player) => player.isHero) || null;
    const board = {
      flop: readableCards(hand.board?.flop, "board.flop", warnings),
      turn: readableCards(hand.board?.turn ? [hand.board.turn] : [], "board.turn", warnings)[0] || null,
      river: readableCards(hand.board?.river ? [hand.board.river] : [], "board.river", warnings)[0] || null,
    };
    const actions = {};
    const streetPots = {};
    for (const street of TYPES.STREETS) {
      const streetData = hand.streets?.[street] || {};
      streetPots[street] = streetData.potBb ?? null;
      actions[street] = (streetData.actions || []).map((action) => ({
        ...clone(action),
        actorId: idByName.get(action.actor) || null,
        actorName: action.actor || null,
        type: action.action,
      }));
    }
    const legacyWarnings = (hand.validationWarnings || []).map((message) => ({
      code: "legacy-warning", severity: "warning", field: null, message: String(message), correctable: false,
    }));
    return TYPES.normalizeParsedHand({
      source: {
        kind: metadata.kind || "screenshot",
        site: metadata.site ?? hand.site ?? null,
        adapterId: metadata.adapterId || "legacy-vision",
        adapterVersion: metadata.adapterVersion || "1",
        importId: metadata.importId ?? null,
      },
      hero: {
        playerId: heroPlayer?.id || null,
        name: hand.heroName ?? heroPlayer?.name ?? null,
        position: heroPlayer?.position || null,
        cards: readableCards(hand.heroHand, "hero.cards", warnings),
      },
      players,
      board,
      actions,
      streetPots,
      confidence: { overall: metadata.confidence ?? 0 },
      warnings: [...legacyWarnings, ...warnings],
      legacyExtras: Object.fromEntries(Object.entries(hand).filter(([key]) => !CONSUMED_KEYS.includes(key))),
    });
  }

  function toLegacy(parsed) {
    const nameById = new Map((parsed.players || []).map((player) => [player.id, player.name]));
    const streets = {};
    for (const street of TYPES.STREETS) {
      streets[street] = {
        potBb: parsed.streetPots?.[street] ?? null,
        actions: (parsed.actions?.[street] || []).map((action) => ({
          ...clone(action.legacy || {}),
          actor: action.actorName || nameById.get(action.actorId) || null,
          position: action.position,
          action: action.type,
          amountBb: action.amountBb,
          ...(action.sourceRegion ? { sourceRegion: clone(action.sourceRegion) } : {}),
          ...(action.rawText ? { rawText: action.rawText } : {}),
        })),
      };
    }
    return {
      ...clone(parsed.legacyExtras || {}),
      ...(parsed.source?.site ? { site: parsed.source.site } : {}),
      heroName: parsed.hero?.name ?? null,
      heroHand: Array.from(parsed.hero?.cards || []),
      players: (parsed.players || []).map((player) => ({
        ...clone(player.legacy || {}),
        name: player.name,
        position: player.position,
        // Unknown stacks are omitted: the builder adapter would read a null stack as 0bb.
        ...(player.startingStackBb === null ? {} : { stackBb: player.startingStackBb }),
        isHero: Boolean(player.isHero),
      })),
      board: {
        flop: Array.from(parsed.board?.flop || []),
        turn: parsed.board?.turn ?? null,
        river: parsed.board?.river ?? null,
      },
      streets,
      validationWarnings: (parsed.warnings || []).map((warning) => warning.message),
    };
  }

  const api = Object.freeze({ fromLegacy, toLegacy });
  root.PokerCoachLegacyImportAdapter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
