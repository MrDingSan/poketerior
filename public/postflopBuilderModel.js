(function attachPostflopBuilderModel(root) {
  const POSITIONS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
  const POSTFLOP_ORDER = ["SB", "BB", "UTG", "HJ", "CO", "BTN"];
  const STREETS = ["flop", "turn", "river"];

  function toPostflopUnits(bb) {
    const units = Math.round(Number(bb) * 10);
    if (!Number.isFinite(units) || units < 0) throw new Error("Amount must be a non-negative number.");
    return units;
  }

  function formatPostflopBb(units) {
    const bb = Number(units) / 10;
    return Number.isInteger(bb) ? String(bb) : bb.toFixed(1);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function activePositions(players) {
    return POSTFLOP_ORDER.filter((position) => !players[position].folded && !players[position].allin);
  }

  function nextActivePostflopActor(players, dealerPosition = "BTN", afterActor = null) {
    const active = new Set(activePositions(players));
    if (!active.size) return null;
    const start = afterActor ? POSTFLOP_ORDER.indexOf(afterActor) : POSTFLOP_ORDER.indexOf(dealerPosition);
    for (let offset = 1; offset <= POSTFLOP_ORDER.length; offset += 1) {
      const position = POSTFLOP_ORDER[(start + offset) % POSTFLOP_ORDER.length];
      if (active.has(position)) return position;
    }
    return null;
  }

  function usedCards(state) {
    return [...state.heroCards, ...state.board.flop, state.board.turn, state.board.river].filter(Boolean);
  }

  function startStreet(state) {
    const next = clone(state);
    for (const position of POSITIONS) next.players[position].streetContributionUnits = 0;
    const active = activePositions(next.players);
    next.highestStreetContributionUnits = 0;
    next.lastFullRaiseUnits = 0;
    next.pendingActors = [...active];
    next.currentActor = nextActivePostflopActor(next.players, next.dealerPosition);
    next.streetComplete = active.length <= 1;
    next.handComplete = active.length <= 1;
    next.streetStart = {
      potUnits: next.potUnits,
      players: clone(next.players),
    };
    next.streetStarts ||= {};
    next.streetStarts[next.street] = clone(next.streetStart);
    return next;
  }

  function validateBoardCards(state, street, cards) {
    const required = street === "flop" ? 3 : 1;
    if (!STREETS.includes(street)) throw new Error("Choose flop, turn, or river.");
    if (state.street !== street) {
      const current = state.street[0].toUpperCase() + state.street.slice(1);
      throw new Error(`Complete the ${current} before entering ${street}.`);
    }
    if (!Array.isArray(cards) || cards.length !== required) {
      throw new Error(street === "flop" ? "Select exactly three flop cards." : `Select exactly one ${street} card.`);
    }
    if (cards.some((card) => !/^[2-9TJQKA][cdhs]$/.test(card))) throw new Error("Choose valid poker cards.");
    if (new Set(cards).size !== cards.length) throw new Error("Board cards must be unique.");
    const currentStreetCards = street === "flop" ? state.board.flop : [state.board[street]].filter(Boolean);
    const unavailable = new Set(usedCards(state).filter((card) => !currentStreetCards.includes(card)));
    if (cards.some((card) => unavailable.has(card))) throw new Error("That card is already in use.");
  }

  function setBoardCards(state, street, cards) {
    validateBoardCards(state, street, cards);
    const next = clone(state);
    if (street === "flop") next.board.flop = [...cards];
    else next.board[street] = cards[0];
    return startStreet(next);
  }

  function nextPendingActor(afterActor, pendingActors, players) {
    const pending = new Set(pendingActors);
    const start = POSTFLOP_ORDER.indexOf(afterActor);
    for (let offset = 1; offset <= POSTFLOP_ORDER.length; offset += 1) {
      const position = POSTFLOP_ORDER[(start + offset) % POSTFLOP_ORDER.length];
      if (pending.has(position) && !players[position].folded && !players[position].allin) return position;
    }
    return null;
  }

  function betSizePresets(state) {
    if (!state.currentActor) return [];
    const player = state.players[state.currentActor];
    const contribution = player.streetContributionUnits;
    const availableTarget = contribution + player.stackUnits;
    const fractions = [
      ["1/4", 0.25],
      ["1/3", 1 / 3],
      ["1/2", 0.5],
      ["2/3", 2 / 3],
      ["Pot", 1],
    ];
    return fractions.map(([fraction, ratio]) => ({
      fraction,
      amountUnits: Math.min(player.stackUnits, Math.round(state.potUnits * ratio)),
      targetStreetContributionUnits: Math.min(availableTarget, contribution + Math.round(state.potUnits * ratio)),
    }));
  }

  function legalActions(state) {
    if (!state.currentActor || state.streetComplete) return { actor: null, amountToCallUnits: 0, actions: [] };
    const actor = state.currentActor;
    const player = state.players[actor];
    const contribution = player.streetContributionUnits;
    const amountToCallUnits = Math.max(0, state.highestStreetContributionUnits - contribution);
    const allinTarget = contribution + player.stackUnits;
    if (!amountToCallUnits) {
      return {
        actor,
        amountToCallUnits: 0,
        actions: [
          { type: "check", label: "Check", targetStreetContributionUnits: contribution },
          { type: "bet", label: "Bet", presets: betSizePresets(state) },
          { type: "allin", label: "All-in", targetStreetContributionUnits: allinTarget },
        ],
      };
    }
    const callTarget = Math.min(state.highestStreetContributionUnits, allinTarget);
    const canRaise = allinTarget > state.highestStreetContributionUnits;
    const actions = [
      { type: "fold", label: "Fold", targetStreetContributionUnits: contribution },
      { type: "call", label: `Call ${formatPostflopBb(callTarget - contribution)} bb`, targetStreetContributionUnits: callTarget },
    ];
    if (canRaise) actions.push({ type: "raise", label: "Raise", presets: betSizePresets(state) });
    actions.push({ type: "allin", label: "All-in", targetStreetContributionUnits: allinTarget });
    return { actor, amountToCallUnits: callTarget - contribution, actions };
  }

  function applyAction(state, inputAction) {
    if (!state.currentActor || state.streetComplete) throw new Error("The current street is complete.");
    if (inputAction.actor !== state.currentActor) {
      throw new Error(`${state.currentActor} is next to act, not ${inputAction.actor}.`);
    }
    const next = clone(state);
    const actor = inputAction.actor;
    const player = next.players[actor];
    const previousContribution = player.streetContributionUnits;
    const availableTarget = previousContribution + player.stackUnits;
    const type = inputAction.type;
    let target = Number(inputAction.targetStreetContributionUnits ?? previousContribution);
    if (!Number.isFinite(target) || target < previousContribution) throw new Error("Action target is invalid.");
    if (target > availableTarget) throw new Error("Action target exceeds the player's stack.");

    if (type === "check") {
      if (previousContribution !== next.highestStreetContributionUnits) throw new Error("Cannot check while facing a wager.");
      target = previousContribution;
    } else if (type === "fold") {
      target = previousContribution;
      player.folded = true;
    } else if (type === "call") {
      if (previousContribution >= next.highestStreetContributionUnits) throw new Error("There is no wager to call.");
      const callTarget = Math.min(next.highestStreetContributionUnits, availableTarget);
      if (target !== callTarget) throw new Error(`Call target must be ${formatPostflopBb(callTarget)} bb.`);
    } else if (type === "bet") {
      if (next.highestStreetContributionUnits !== 0 || target <= previousContribution) throw new Error("A bet must open the street.");
    } else if (type === "raise") {
      if (target <= next.highestStreetContributionUnits) throw new Error("A raise must exceed the current wager.");
      const raiseIncrement = target - next.highestStreetContributionUnits;
      if (raiseIncrement < next.lastFullRaiseUnits) throw new Error("Raise size is below the minimum full raise.");
    } else if (type === "allin") {
      target = availableTarget;
    } else {
      throw new Error(`Unsupported action ${type}.`);
    }

    const potBeforeUnits = next.potUnits;
    const stackBeforeUnits = player.stackUnits;
    const incrementAmountUnits = target - previousContribution;
    player.streetContributionUnits = target;
    player.stackUnits -= incrementAmountUnits;
    next.potUnits += incrementAmountUnits;
    if (player.stackUnits === 0 || type === "allin") player.allin = true;

    const wasAggressive = target > next.highestStreetContributionUnits;
    if (wasAggressive) {
      const raiseIncrement = target - next.highestStreetContributionUnits;
      next.lastFullRaiseUnits = next.highestStreetContributionUnits === 0
        ? target
        : Math.max(next.lastFullRaiseUnits, raiseIncrement);
      next.highestStreetContributionUnits = target;
      next.pendingActors = activePositions(next.players).filter((position) => position !== actor);
    } else {
      next.pendingActors = next.pendingActors.filter((position) => position !== actor);
    }
    next.pendingActors = next.pendingActors.filter(
      (position) => !next.players[position].folded && !next.players[position].allin,
    );

    const action = {
      street: next.street,
      sequence: next.preflopActions.length + Object.values(next.streetActions).flat().length + 1,
      actor,
      type,
      incrementAmountUnits,
      targetStreetContributionUnits: target,
      potBeforeUnits,
      potAfterUnits: next.potUnits,
      stackBeforeUnits,
      stackAfterUnits: player.stackUnits,
      automatic: Boolean(inputAction.automatic),
    };
    next.streetActions[next.street].push(action);

    const livePlayers = POSITIONS.filter((position) => !next.players[position].folded);
    if (livePlayers.length <= 1) {
      next.handComplete = true;
      next.streetComplete = true;
      next.pendingActors = [];
      next.currentActor = null;
      return next;
    }
    next.currentActor = nextPendingActor(actor, next.pendingActors, next.players);
    next.streetComplete = next.currentActor === null;
    return next;
  }

  function replayPostflop(state, actions = state.streetActions[state.street]) {
    if (!state.streetStart) return clone(state);
    const replay = clone(state);
    replay.potUnits = state.streetStart.potUnits;
    replay.players = clone(state.streetStart.players);
    replay.streetActions[state.street] = [];
    replay.highestStreetContributionUnits = 0;
    replay.lastFullRaiseUnits = 0;
    replay.pendingActors = activePositions(replay.players);
    replay.currentActor = nextActivePostflopActor(replay.players, replay.dealerPosition);
    replay.streetComplete = false;
    replay.handComplete = false;
    return actions.reduce((current, action) => applyAction(current, action), replay);
  }

  function advanceStreet(state) {
    if (state.street === "results") throw new Error("The hand is already at Results.");
    if (!state.streetComplete) throw new Error(`Complete the ${state.street} action before continuing.`);
    const next = clone(state);
    if (next.handComplete || next.street === "river") {
      next.street = "results";
      next.currentActor = null;
      next.pendingActors = [];
      next.streetComplete = true;
      return next;
    }
    const nextIndex = STREETS.indexOf(next.street) + 1;
    next.street = STREETS[nextIndex];
    for (const position of POSITIONS) next.players[position].streetContributionUnits = 0;
    next.highestStreetContributionUnits = 0;
    next.lastFullRaiseUnits = 0;
    next.pendingActors = [];
    next.currentActor = null;
    next.streetStart = null;
    next.streetComplete = false;
    return next;
  }

  function streetRank(street) {
    if (street === "preflop") return -1;
    return STREETS.indexOf(street);
  }

  function keepBeforeStreet(record, street) {
    const targetRank = streetRank(street);
    return Object.fromEntries(
      Object.entries(record || {}).filter(([key]) => streetRank(key) < targetRank),
    );
  }

  function rewindToStreet(state, street) {
    if (!STREETS.includes(street)) throw new Error("Choose a post-flop street to edit.");
    const start = state.streetStarts?.[street];
    if (!start) throw new Error(`The ${street} has not started.`);
    const next = clone(state);
    const targetIndex = STREETS.indexOf(street);
    next.street = street;
    next.potUnits = start.potUnits;
    next.players = clone(start.players);
    for (let index = targetIndex; index < STREETS.length; index += 1) {
      next.streetActions[STREETS[index]] = [];
    }
    if (targetIndex <= 0) {
      next.board.turn = null;
      next.board.river = null;
    } else if (targetIndex === 1) {
      next.board.river = null;
    }
    next.rangesByStreet = keepBeforeStreet(next.rangesByStreet, street);
    next.analysisByStreet = keepBeforeStreet(next.analysisByStreet, street);
    next.streetStarts = Object.fromEntries(
      Object.entries(next.streetStarts).filter(([key]) => streetRank(key) <= targetIndex),
    );
    next.streetStart = clone(start);
    next.highestStreetContributionUnits = 0;
    next.lastFullRaiseUnits = 0;
    next.pendingActors = activePositions(next.players);
    next.currentActor = nextActivePostflopActor(next.players, next.dealerPosition);
    next.streetComplete = next.currentActor === null;
    next.handComplete = false;
    next.error = null;
    return next;
  }

  function replaceAction(state, street, index, replacement) {
    const existing = state.streetActions?.[street] || [];
    if (!Number.isInteger(index) || index < 0 || index >= existing.length) {
      throw new Error("Choose an existing post-flop action to edit.");
    }
    let next = rewindToStreet(state, street);
    const actions = [...existing.slice(0, index), replacement];
    for (const action of actions) {
      next = applyAction(next, { ...action, actor: next.currentActor });
    }
    return next;
  }

  function toLegacyAnalysisInput(state) {
    const actionsByStreet = Object.fromEntries(STREETS.map((street) => [
      street,
      state.streetActions[street].map((action) => ({
        actor: action.actor,
        action: action.type,
        amount: action.targetStreetContributionUnits / 10,
      })),
    ]));
    return {
      heroPosition: state.heroPosition,
      heroHand: state.heroCards.join(" "),
      boardCards: state.board.flop.join(" "),
      turnCard: state.board.turn || "",
      riverCard: state.board.river || "",
      potSize: state.potUnits / 10,
      street: state.street === "results" ? "river" : state.street,
      actionsByStreet,
    };
  }

  function createFromPreflop(preflopState) {
    if (!preflopState?.roundComplete) throw new Error("Complete pre-flop action before continuing.");
    const players = Object.fromEntries(POSITIONS.map((position) => {
      const committedUnits = Number(preflopState.contributions[position] || 0) * 5;
      const startingStackUnits = Number(preflopState.seats[position].stackUnits) * 5;
      return [position, {
        position,
        stackUnits: Math.max(0, startingStackUnits - committedUnits),
        folded: Boolean(preflopState.seats[position].folded),
        allin: Boolean(preflopState.seats[position].allin || committedUnits >= startingStackUnits),
        streetContributionUnits: 0,
        assumption: preflopState.seats[position].assumption || null,
      }];
    }));
    return {
      settings: { ...preflopState.settings },
      heroPosition: preflopState.heroPosition,
      heroCards: [...preflopState.heroCards],
      dealerPosition: "BTN",
      players,
      board: { flop: [], turn: null, river: null },
      street: "flop",
      potUnits: Number(preflopState.potUnits) * 5,
      currentActor: null,
      streetActions: { flop: [], turn: [], river: [] },
      preflopActions: preflopState.actions.map((action) => ({ ...action })),
      opponentProfiles: Object.fromEntries(POSITIONS.map((position) => [position, preflopState.seats[position].assumption || null])),
      rangesByStreet: {},
      analysisByStreet: {},
      highestStreetContributionUnits: 0,
      lastFullRaiseUnits: 0,
      pendingActors: [],
      streetStart: null,
      streetStarts: {},
      streetComplete: false,
      handComplete: false,
      error: null,
    };
  }

  const api = {
    POSITIONS,
    POSTFLOP_ORDER,
    STREETS,
    toPostflopUnits,
    formatPostflopBb,
    clone,
    activePositions,
    nextActivePostflopActor,
    usedCards,
    startStreet,
    setBoardCards,
    betSizePresets,
    legalActions,
    applyAction,
    replayPostflop,
    advanceStreet,
    rewindToStreet,
    replaceAction,
    toLegacyAnalysisInput,
    createFromPreflop,
  };
  root.PokerCoachPostflopBuilderModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
