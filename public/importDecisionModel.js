(function attachImportDecisionModel(global) {
  const IGNORED_ACTIONS = new Set(["blind", "ante", "refund", "win", "muck"]);
  const HIDDEN_DECISION_ACTIONS = new Set(["blind", "ante", "refund", "win", "muck", "fold"]);
  const ANALYZER_POSITIONS = new Set(["UTG", "MP", "CO", "BTN", "SB", "BB"]);

  function normalizeAnalyzerPosition(position) {
    if (!position) return null;
    const upper = String(position).trim().toUpperCase();
    const normalized = upper === "HJ" || upper === "UTG+1" ? "MP" : upper;
    return ANALYZER_POSITIONS.has(normalized) ? normalized : null;
  }

  function normalizePosition(position) {
    return normalizeAnalyzerPosition(position);
  }

  function playerByName(hand, name) {
    return (hand?.players || []).find((player) => player.name === name) || null;
  }

  function playerIdentity(name) {
    return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function importedActionsThroughTarget(hand, targetStreet, targetIndex) {
    const streetOrder = ["preflop", "flop", "turn", "river"];
    const targetStreetIndex = streetOrder.indexOf(targetStreet);
    return streetOrder.flatMap((street, streetIndex) => {
      if (targetStreetIndex === -1 || streetIndex > targetStreetIndex) return [];
      const actions = hand?.streets?.[street]?.actions || [];
      const limit = street === targetStreet ? targetIndex + 1 : actions.length;
      return actions.slice(0, limit).map((action) => ({ ...action, street }));
    });
  }

  function activeImportedOpponents(hand, targetStreet, targetIndex, heroName = "") {
    const resolvedHeroName = resolveImportedHeroName(hand, heroName);
    const heroIdentity = playerIdentity(resolvedHeroName);
    const folded = new Set(importedActionsThroughTarget(hand, targetStreet, targetIndex)
      .filter((action) => action.action === "fold")
      .map((action) => playerIdentity(action.actor)));
    return (hand?.players || [])
      .filter((player) => playerIdentity(player.name) !== heroIdentity)
      .filter((player) => !folded.has(playerIdentity(player.name)))
      .map((player) => ({
        name: player.name,
        position: normalizeAnalyzerPosition(player.position),
        displayPosition: String(player.position || "").trim().toUpperCase() || null,
      }));
  }

  function resolveImportedHeroName(hand, selectedName = "") {
    if (selectedName && playerByName(hand, selectedName)) return selectedName;
    if (hand?.heroName && playerByName(hand, hand.heroName)) return hand.heroName;
    return hand?.players?.find((player) => player.isHero)?.name || hand?.heroName || selectedName || "";
  }

  function actorPosition(hand, action) {
    return normalizePosition(action?.position) || normalizePosition(playerByName(hand, action?.actor)?.position);
  }

  function heroPosition(hand, heroName) {
    const resolvedHero = resolveImportedHeroName(hand, heroName);
    return normalizePosition(playerByName(hand, resolvedHero)?.position || hand?.players?.find((player) => player.isHero)?.position);
  }

  function isHeroImportedAction(hand, action, heroName = "") {
    const resolvedHero = resolveImportedHeroName(hand, heroName);
    const resolvedHeroPosition = heroPosition(hand, resolvedHero);
    return action?.actor === resolvedHero || Boolean(resolvedHeroPosition && actorPosition(hand, action) === resolvedHeroPosition);
  }

  function relevantImportedActionsForStreet(hand, street, heroName = "") {
    if (hand?.actionAttribution?.safe === false) return [];
    const actions = hand?.streets?.[street]?.actions || [];
    const visible = actions
      .map((action, index) => ({ action, index }))
      .filter(({ action }) => !HIDDEN_DECISION_ACTIONS.has(action.action));
    if (street === "preflop") {
      const firstHeroIndex = visible.findIndex(({ action }) => isHeroImportedAction(hand, action, heroName));
      return firstHeroIndex === -1 ? [] : visible.slice(firstHeroIndex);
    }
    return visible;
  }

  function importedStreetRowsForAnalysis(hand, street, targetStreet, targetIndex, heroName = "") {
    const actions = hand?.streets?.[street]?.actions || [];
    const streetOrder = ["preflop", "flop", "turn", "river"];
    const beforeTarget = streetOrder.indexOf(street) < streetOrder.indexOf(targetStreet);
    const sameStreet = street === targetStreet;
    const targetAction = sameStreet ? actions[targetIndex] : null;
    const isHeroTarget = targetAction && isHeroImportedAction(hand, targetAction, heroName);
    const max = beforeTarget ? actions.length : sameStreet ? targetIndex + (isHeroTarget ? 0 : 1) : 0;
    let hasAggression = false;
    return actions
      .slice(0, max)
      .filter((action) => !IGNORED_ACTIONS.has(action.action))
      .filter((action) => !(street === "preflop" && action.action === "fold"))
      .map((action) => {
        const importedAction = action.action;
        let mappedAction = importedAction;
        if (street === "preflop" && importedAction === "raise" && !hasAggression) mappedAction = "open";
        if (street === "preflop" && importedAction === "allin" && !hasAggression) mappedAction = "open";
        if (["open", "raise", "bet", "allin"].includes(mappedAction)) hasAggression = true;
        return {
          actor: actorPosition(hand, action) || "MP",
          action: mappedAction,
          amount: action.amountBb || "",
        };
      });
  }

  function buildImportedDecisionContext(hand, targetStreet, targetIndex, heroName = "") {
    if (hand?.actionAttribution?.safe === false) {
      throw new Error("Action attribution could not be verified for this import.");
    }
    const resolvedHeroName = resolveImportedHeroName(hand, heroName);
    const heroPlayer = playerByName(hand, resolvedHeroName);
    const actions = hand?.streets?.[targetStreet]?.actions || [];
    const target = actions[targetIndex];
    if (!heroPlayer) throw new Error("Selected hero is missing from the imported player list.");
    if (!target) throw new Error("Clicked imported action is missing.");

    const displayHeroPosition = String(heroPlayer.position || "").toUpperCase();
    const normalizedHeroPosition = normalizeAnalyzerPosition(displayHeroPosition);
    if (!normalizedHeroPosition) throw new Error(`Unsupported imported hero position ${displayHeroPosition || "unknown"}.`);

    const targetIsHero = isHeroImportedAction(hand, target, resolvedHeroName);
    let hasAggression = false;
    const actionsThroughTarget = actions
      .slice(0, targetIndex + (targetIsHero ? 0 : 1))
      .filter((action) => !IGNORED_ACTIONS.has(action.action))
      .filter((action) => !(targetStreet === "preflop" && action.action === "fold"))
      .map((action) => {
        let mappedAction = action.action;
        if (targetStreet === "preflop" && ["raise", "allin"].includes(mappedAction) && !hasAggression) {
          mappedAction = "open";
        }
        if (["open", "raise", "bet", "allin"].includes(mappedAction)) hasAggression = true;
        return {
          actorName: action.actor || null,
          actor: actorPosition(hand, action) || "MP",
          action: mappedAction,
          amount: action.amountBb || "",
        };
      });

    const targetPosition = actorPosition(hand, target);
    const aggressiveActions = new Set(["open", "bet", "raise", "allin"]);
    const activeOpponents = activeImportedOpponents(hand, targetStreet, targetIndex, resolvedHeroName);
    const activeOpponentByName = new Map(activeOpponents.map((opponent) => [playerIdentity(opponent.name), opponent]));
    const fullHistory = importedActionsThroughTarget(hand, targetStreet, targetIndex);
    const mostRecentActiveOpponentAggressor = [...fullHistory]
      .reverse()
      .find((action) =>
        activeOpponentByName.has(playerIdentity(action.actor)) &&
        ["bet", "raise", "allin"].includes(action.action));
    const targetOpponent = !targetIsHero ? activeOpponentByName.get(playerIdentity(target.actor)) : null;
    const mostRecentOpponentAggressor = [...actionsThroughTarget]
      .reverse()
      .find((row) => row.actor !== normalizedHeroPosition && aggressiveActions.has(row.action));
    const mostRecentOpponent = [...actionsThroughTarget]
      .reverse()
      .find((row) => row.actor !== normalizedHeroPosition);
    const fallbackOpponent = activeOpponents.find((opponent) => opponent.position) || null;
    const primaryVillain = targetOpponent?.position
      ? targetOpponent
      : activeOpponentByName.get(playerIdentity(mostRecentActiveOpponentAggressor?.actor)) ||
        (activeOpponents.length === 1 ? activeOpponents[0] : null) ||
        fallbackOpponent;
    const primaryVillainPosition = primaryVillain?.position ||
      mostRecentOpponentAggressor?.actor ||
      (!targetIsHero ? targetPosition : mostRecentOpponent?.actor || null);
    const primaryVillainName = primaryVillain?.name || targetOpponent?.name || null;

    return {
      heroName: resolvedHeroName,
      heroPosition: normalizedHeroPosition,
      displayHeroPosition,
      targetActor: target.actor || null,
      targetPosition,
      targetAction: target.action,
      targetAmount: target.amountBb || "",
      targetIsHero,
      recordedHeroAction: targetIsHero ? target.action : null,
      recordedHeroAmount: targetIsHero ? (target.amountBb || "") : "",
      actionsThroughTarget,
      heroHasResponded: targetIsHero,
      activeOpponents,
      primaryVillainName,
      primaryVillainPosition,
    };
  }

  function decisionNodeForImportedContext(context, streetLabel = "Flop") {
    const targetPosition = context?.targetPosition || "Opponent";
    const targetAction = context?.targetAction || "action";
    const amountText = context?.targetAmount === "" || context?.targetAmount == null
      ? ""
      : ` ${context.targetAmount}bb`;

    if (context?.targetIsHero) {
      const precedingAction = context.actionsThroughTarget?.[context.actionsThroughTarget.length - 1];
      const facingAllIn = precedingAction?.action === "allin";
      const facingBet = facingAllIn || ["bet", "raise", "open"].includes(precedingAction?.action);
      return {
        street: streetLabel,
        title: `${streetLabel} Node: Decision before Hero ${targetAction}`,
        description: `Evaluate Hero's options immediately before the recorded ${targetAction}${amountText}.`,
        facingBet,
        facingAllIn,
        terminal: false,
        importedTargetIsHero: true,
        recordedHeroAction: context.recordedHeroAction,
        recordedHeroAmount: context.recordedHeroAmount,
      };
    }

    if (["bet", "raise", "allin"].includes(targetAction)) {
      const pressure = targetAction === "allin" ? "all-in" : targetAction;
      return {
        street: streetLabel,
        title: `${streetLabel} Node: Hero facing ${targetPosition} ${pressure}`,
        description: `${targetPosition} ${targetAction}${amountText} and Hero has the next unresolved decision.`,
        facingBet: true,
        facingAllIn: targetAction === "allin",
        importedTargetIsHero: false,
      };
    }

    return {
      street: streetLabel,
      title: `${streetLabel} Node: Hero after ${targetPosition} ${targetAction}`,
      description: `${targetPosition} ${targetAction}${amountText}; Hero has the next unresolved decision.`,
      facingBet: false,
      facingAllIn: false,
      importedTargetIsHero: false,
    };
  }

  function validateImportedDecisionNode(context, node = {}) {
    const errors = [];
    if (!context?.heroPosition) errors.push("Imported hero position is unsupported.");
    if (!context?.primaryVillainPosition) errors.push("Imported primary villain position is unsupported.");
    if (context?.heroPosition && context.heroPosition === context.primaryVillainPosition) {
      errors.push("Imported hero and primary villain positions must differ.");
    }
    if (node.legalActions?.includes("Review")) {
      errors.push("Review is a UI label, not a legal imported poker action.");
    }
    if (!context?.targetIsHero && ["bet", "raise", "allin"].includes(context?.targetAction) && !node.facingBet) {
      errors.push("Hero must face unresolved aggression from the clicked opponent action.");
    }
    return { valid: errors.length === 0, errors };
  }

  function previousActionLine(hand, street, targetIndex, formatAction) {
    const actions = hand?.streets?.[street]?.actions || [];
    return actions
      .slice(0, targetIndex)
      .filter((action) => !HIDDEN_DECISION_ACTIONS.has(action.action))
      .map(formatAction)
      .join(" -> ");
  }

  function pointKind(hand, street, action, heroName = "", streetRows = []) {
    const isHero = isHeroImportedAction(hand, action, heroName);
    if (street === "preflop" && isHero && streetRows[0]?.action === action) {
      return {
        label: "First Hero Decision",
        button: "Analyze Point",
        className: "hero-decision hero-action-cell",
      };
    }
    if (isHero) {
      return {
        label: "Review Hero Action",
        button: "Review Point",
        className: "review-decision hero-action-cell",
      };
    }
    return {
      label: "Villain Key Action",
      button: "Analyze Point",
      className: "villain-decision",
    };
  }

  function priorOpponentPosition(hand, targetStreet, targetIndex, heroName = "") {
    const resolvedHeroPosition = heroPosition(hand, heroName);
    const targetActions = hand?.streets?.[targetStreet]?.actions || [];
    const previous = targetActions
      .slice(0, targetIndex)
      .reverse()
      .find((action) => !HIDDEN_DECISION_ACTIONS.has(action.action) && actorPosition(hand, action) !== resolvedHeroPosition);
    if (previous) return actorPosition(hand, previous);

    const streetOrder = ["preflop", "flop", "turn", "river"];
    const priorStreets = streetOrder.slice(0, streetOrder.indexOf(targetStreet)).reverse();
    for (const street of priorStreets) {
      const prior = (hand?.streets?.[street]?.actions || [])
        .slice()
        .reverse()
        .find((action) => !HIDDEN_DECISION_ACTIONS.has(action.action) && actorPosition(hand, action) !== resolvedHeroPosition);
      if (prior) return actorPosition(hand, prior);
    }
    return null;
  }

  function selectableDecisionKeys(convertedHand) {
    if (convertedHand?.sourceHand?.actionAttribution?.safe === false) return [];
    const streetOrder = ["preflop", "flop", "turn", "river"];
    const firstUnresolved = convertedHand?.unresolved?.[0];
    return Object.entries(convertedHand?.actionIndex || {})
      .filter(([, entry]) => !HIDDEN_DECISION_ACTIONS.has(entry.recordedAction?.action))
      .filter(([key, entry]) => {
        if (!firstUnresolved) return true;
        const entryRank = streetOrder.indexOf(entry.street);
        const unresolvedRank = streetOrder.indexOf(firstUnresolved.street);
        const entryIndex = Number(key.split(":")[1]);
        return entryRank < unresolvedRank || (entryRank === unresolvedRank && entryIndex <= firstUnresolved.index);
      })
      .map(([key]) => key);
  }

  function sourceBeforeAction(convertedHand, entry) {
    const source = JSON.parse(JSON.stringify(convertedHand.sourceHand));
    const streetOrder = ["preflop", "flop", "turn", "river"];
    const targetRank = streetOrder.indexOf(entry.street);
    for (const [rank, street] of streetOrder.entries()) {
      source.streets[street] ||= { actions: [] };
      if (rank < targetRank) continue;
      source.streets[street].actions = rank === targetRank
        ? source.streets[street].actions.slice(0, entry.index)
        : [];
    }
    if (targetRank < 3) source.board.river = null;
    if (targetRank < 2) source.board.turn = null;
    if (targetRank < 1) source.board.flop = [];
    return source;
  }

  function decisionSnapshotForAction(convertedHand, actionKey) {
    const entry = convertedHand?.actionIndex?.[actionKey];
    if (!entry) throw new Error(`Unknown imported decision ${actionKey}.`);
    if (HIDDEN_DECISION_ACTIONS.has(entry.recordedAction?.action)) {
      throw new Error("That imported action is bookkeeping, not a decision point.");
    }
    if (!selectableDecisionKeys(convertedHand).includes(actionKey)) {
      throw new Error("That action cannot be analyzed until the earlier import warning is corrected.");
    }
    const adapter = global.PokerCoachImportBuilderAdapter;
    const preflop = global.PokerCoachPreflopBuilderModel;
    const postflop = global.PokerCoachPostflopBuilderModel;
    if (!adapter || !preflop || !postflop) throw new Error("Builder decision dependencies are unavailable.");
    const source = sourceBeforeAction(convertedHand, entry);
    const heroName = resolveImportedHeroName(source);
    const replayed = adapter.fromImportedHand(source, { heroName });
    const stateBefore = entry.street === "preflop" ? replayed.preflopState : replayed.postflopState;
    if (!stateBefore) throw new Error(`Could not replay state before ${actionKey}.`);
    const actor = playerByName(convertedHand.sourceHand, entry.recordedAction.actor);
    const position = entry.actor || normalizeAnalyzerPosition(actor?.position);
    const legal = entry.street === "preflop" ? preflop.legalActions(stateBefore) : postflop.legalActions(stateBefore);
    const warnings = [...(convertedHand.warnings || [])];
    if (!position || stateBefore.currentActor !== position) {
      warnings.push(`Could not safely attribute ${actionKey} to the expected actor.`);
    }
    return {
      decisionKey: actionKey,
      owner: {
        name: entry.recordedAction.actor || actor?.name || position || "Unknown",
        position,
        isHero: isHeroImportedAction(convertedHand.sourceHand, entry.recordedAction, heroName),
      },
      street: entry.street,
      stateBefore,
      recordedAction: JSON.parse(JSON.stringify(entry.recordedAction)),
      legalActions: legal.actions,
      warnings,
    };
  }

  global.PokerCoachImportDecisionModel = {
    activeImportedOpponents,
    actorPosition,
    buildImportedDecisionContext,
    decisionNodeForImportedContext,
    decisionSnapshotForAction,
    importedStreetRowsForAnalysis,
    isHeroImportedAction,
    normalizeAnalyzerPosition,
    pointKind,
    previousActionLine,
    priorOpponentPosition,
    relevantImportedActionsForStreet,
    resolveImportedHeroName,
    selectableDecisionKeys,
    validateImportedDecisionNode,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
