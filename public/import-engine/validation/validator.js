(function attachImportValidator(root) {
  const TYPES = root.PokerCoachImportTypes;
  const LEGACY = root.PokerCoachLegacyImportAdapter;
  const ADAPTER = root.PokerCoachImportBuilderAdapter;
  const PLAY_ACTIONS = new Set(["fold", "check", "call", "bet", "raise", "allin"]);
  const POT_TOLERANCE_FLOOR_BB = 0.2;
  const POT_TOLERANCE_RATE = 0.02;
  const AMOUNT_TOLERANCE_BB = 0.05;
  const BLOCKING_CONFIDENCE_CAP = 0.64;
  const RECOVERABLE_CONFIDENCE_CAP = 0.89;
  const DEFAULT_BLINDS_BB = { SB: 0.5, BB: 1 };

  // Engine error text -> structured code. The builder engines stay the single source of legality rules.
  const ENGINE_ERRORS = [
    [/next to act, not/i, "missing-prior-action"],
    [/cannot check while facing/i, "illegal-check"],
    [/call (?:target|total) must/i, "call-mismatch"],
    [/needs an amount/i, "missing-amount"],
    [/no supported actor position/i, "unsupported-position"],
    [/minimum raise|below the minimum full raise|must exceed the current wager|must open the street/i, "illegal-raise"],
    [/exceeds? the player's stack/i, "stack-exceeded"],
    [/no wager to call/i, "illegal-call"],
  ];

  function potTolerance(displayedPot) {
    return Math.max(POT_TOLERANCE_FLOOR_BB, Number(displayedPot) * POT_TOLERANCE_RATE);
  }

  function makeIssue(code, severity, field, message, correctable = true) {
    return { code, severity, field, message, correctable };
  }

  const actionField = (street, index, suffix) => TYPES.fieldRef(["actions", street, index, suffix]);

  function checkCards(hand, issues) {
    const hero = hand.hero.cards;
    if (hero.length !== 2) {
      issues.push(makeIssue("hero-cards-incomplete", "error", "hero.cards", `Hero needs exactly two cards; found ${hero.length}.`));
    }
    const { flop, turn, river } = hand.board;
    if (flop.length !== 0 && flop.length !== 3) {
      issues.push(makeIssue("board-flop-incomplete", "error", "board.flop", `The flop needs three cards; found ${flop.length}.`));
    }
    if (turn && flop.length !== 3) issues.push(makeIssue("board-street-gap", "error", "board.turn", "A turn card needs a complete flop."));
    if (river && !turn) issues.push(makeIssue("board-street-gap", "error", "board.river", "A river card needs a turn card."));

    const seen = new Map();
    const labelled = [...hero.map((card) => [card, "hero.cards"]), ...flop.map((card) => [card, "board.flop"])];
    if (turn) labelled.push([turn, "board.turn"]);
    if (river) labelled.push([river, "board.river"]);
    for (const [card, field] of labelled) {
      if (seen.has(card)) issues.push(makeIssue("duplicate-card", "error", field, `${card} appears in both ${seen.get(card)} and ${field}.`));
      else seen.set(card, field);
    }

    const boardReady = { flop: flop.length === 3, turn: Boolean(turn), river: Boolean(river) };
    for (const street of ["flop", "turn", "river"]) {
      if (hand.actions[street].length && !boardReady[street]) {
        issues.push(makeIssue("actions-without-board", "error", `board.${street}`, `The ${street} has actions but no recognized board cards.`));
      }
    }
  }

  function checkActors(hand, issues) {
    const byId = new Map(hand.players.map((player) => [player.id, player]));
    const byName = new Map(hand.players.filter((player) => player.name).map((player) => [player.name, player]));
    const folded = new Set();
    for (const street of TYPES.STREETS) {
      let previous = null;
      hand.actions[street].forEach((action, index) => {
        if (!PLAY_ACTIONS.has(action.type)) return;
        const field = actionField(street, index);
        if (!action.actorId && !action.actorName) {
          issues.push(makeIssue("missing-actor", "error", field, `The ${street} ${action.type} has no attributed player.`));
          previous = null;
          return;
        }
        const player = byId.get(action.actorId) || byName.get(action.actorName);
        if (!player) {
          issues.push(makeIssue("unknown-actor", "error", field, `${action.actorName || action.actorId} is not a recognized player.`));
          previous = null;
          return;
        }
        if (folded.has(player.id)) issues.push(makeIssue("action-after-fold", "error", field, `${player.name || player.id} acts after folding.`));
        if (previous === player.id) issues.push(makeIssue("self-response", "error", field, `${player.name || player.id} responds to their own action.`));
        if (action.type === "fold") folded.add(player.id);
        previous = player.id;
      });
    }
  }

  // Tracks only what is needed to compare a printed call increment with the wager it answers.
  // An unknown amount convention or an all-in makes the street's amounts unreliable, so nothing is guessed.
  function checkAmounts(hand, issues) {
    const playerFor = (action) => hand.players.find((player) => player.id === action.actorId) || hand.players.find((player) => player.name && player.name === action.actorName);
    for (const street of TYPES.STREETS) {
      const contributions = new Map();
      let highest = 0;
      let reliable = true;
      if (street === "preflop") {
        const blindRows = hand.actions.preflop.filter((action) => action.type === "blind" && action.amountBb !== null);
        for (const player of hand.players) {
          const posted = blindRows.length ? blindRows.find((row) => row.actorId === player.id || (row.actorName && row.actorName === player.name))?.amountBb : DEFAULT_BLINDS_BB[player.position];
          if (posted) contributions.set(player.id, posted);
        }
        highest = Math.max(0, ...contributions.values());
      }
      hand.actions[street].forEach((action, index) => {
        if (!PLAY_ACTIONS.has(action.type) || !reliable) return;
        const player = playerFor(action);
        if (!player) return;
        const current = contributions.get(player.id) || 0;
        if (action.type === "allin") {
          reliable = false;
        } else if ((action.type === "bet" || action.type === "raise") && action.amountKind === "street-total" && action.amountBb !== null) {
          contributions.set(player.id, action.amountBb);
          highest = Math.max(highest, action.amountBb);
        } else if (action.type === "bet" || action.type === "raise") {
          reliable = false;
        } else if (action.type === "call") {
          const needed = highest - current;
          if (action.amountKind === "increment" && action.amountBb !== null && action.amountBb < needed - AMOUNT_TOLERANCE_BB) {
            issues.push(makeIssue("undersized-call", "error", actionField(street, index, "amountBb"), `Call of ${action.amountBb} bb is less than the ${needed} bb needed to match the wager.`));
          } else if (action.amountKind === "increment" && action.amountBb !== null && action.amountBb > needed + AMOUNT_TOLERANCE_BB) {
            issues.push(makeIssue("oversized-call", "error", actionField(street, index, "amountBb"), `Call of ${action.amountBb} bb is more than the ${needed} bb needed to match the wager.`));
          }
          contributions.set(player.id, highest);
        }
      });
    }
  }

  function engineCode(message) {
    return ENGINE_ERRORS.find(([pattern]) => pattern.test(message))?.[1] || "replay-failed";
  }

  function replayFieldFor(entry, code) {
    const [scope, index] = String(entry.key || "").split(":");
    if (scope === "board") return `board.${index}`;
    return actionField(scope, index, code === "missing-amount" ? "amountBb" : undefined);
  }

  function replay(hand, strictReplay, blockingFields, issues) {
    let converted;
    try {
      converted = ADAPTER.fromImportedHand(LEGACY.toLegacy(hand), { heroName: hand.hero.name, strict: strictReplay });
    } catch (error) {
      issues.push(makeIssue("replay-failed", "error", null, `The hand could not be replayed: ${error.message}`, false));
      return null;
    }
    for (const entry of converted.unresolved) {
      const code = entry.key.startsWith("board:") ? "illegal-board" : engineCode(entry.message);
      const field = replayFieldFor(entry, code);
      // An earlier layer already flagged this action (or its amount): don't report the same problem twice.
      const [scope, index] = String(entry.key).split(":");
      if (blockingFields.has(field) || (scope !== "board" && blockingFields.has(actionField(scope, index)))) continue;
      issues.push(makeIssue(code, "error", field, entry.message));
    }
    return converted;
  }

  function reconcilePots(hand, converted, issues) {
    const reconciled = {};
    if (!converted) return reconciled;
    for (const street of TYPES.STREETS) {
      const recognized = hand.streetPots[street];
      const replayed = converted.streetPotsBb?.[street];
      if (recognized === null || replayed === undefined) continue;
      const tolerance = potTolerance(recognized);
      const difference = Math.round((recognized - replayed) * 1e6) / 1e6;
      const matched = Math.abs(difference) <= tolerance + 1e-9;
      reconciled[street] = { recognized, replayed, difference, tolerance, matched };
      if (!matched) {
        issues.push(makeIssue("pot-mismatch", "warning", `streetPots.${street}`, `Displayed ${street} pot ${recognized} bb differs from the replayed ${replayed} bb by more than ${tolerance} bb.`));
      }
    }
    return reconciled;
  }

  function aggregateConfidence(hand, allIssues) {
    const values = Object.values(hand.confidence.fields || {}).map(Number).filter(Number.isFinite);
    let overall = values.length ? Math.min(...values) : Number(hand.confidence.overall) || 0;
    if (allIssues.some((issue) => issue.severity === "error")) overall = Math.min(overall, BLOCKING_CONFIDENCE_CAP);
    else if (allIssues.length) overall = Math.min(overall, RECOVERABLE_CONFIDENCE_CAP);
    return { overall, level: TYPES.confidenceLevel(overall) };
  }

  function validate(input, options = {}) {
    if (!ADAPTER || !LEGACY) throw new Error("Builder models and the legacy adapter must load before the import validator.");
    const hand = TYPES.normalizeParsedHand(input);
    const strictReplay = options.strictReplay !== false;

    const blockingIssues = [];
    checkCards(hand, blockingIssues);
    checkActors(hand, blockingIssues);
    const blockingFields = new Set(blockingIssues.map((issue) => issue.field));

    const replayIssues = [];
    checkAmounts(hand, replayIssues);
    const converted = replay(hand, strictReplay, blockingFields, replayIssues);
    const reconciledPots = reconcilePots(hand, converted, replayIssues);

    const all = [...blockingIssues, ...replayIssues];
    const confidence = aggregateConfidence(hand, all);
    const valid = !all.some((issue) => issue.severity === "error");
    const known = new Set(hand.warnings.map((warning) => `${warning.code}|${warning.field}`));
    const warnings = [...hand.warnings, ...all.filter((issue) => !known.has(`${issue.code}|${issue.field}`))];
    const validated = TYPES.normalizeParsedHand({
      ...hand,
      warnings,
      confidence: { ...hand.confidence, overall: confidence.overall },
      validation: { valid, blockingIssues, replayIssues, reconciledPots },
    });
    return { hand: validated, valid, confidence, warnings: all, blockingIssues, replayIssues, reconciledPots };
  }

  const api = Object.freeze({ validate, potTolerance });
  root.PokerCoachImportValidator = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
