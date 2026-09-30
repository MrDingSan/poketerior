(function attachPreflopBuilderModel(root) {
  const POSITIONS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
  const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];

  function orderCards(cards = []) {
    return [...cards].sort((left, right) => RANKS.indexOf(left[0]) - RANKS.indexOf(right[0]));
  }

  function toUnits(bb) {
    const units = Math.round(Number(bb) * 2);
    if (!Number.isFinite(units) || units < 0) {
      throw new Error("Amount must be a non-negative number.");
    }
    return units;
  }

  function formatBb(units) {
    const bb = Number(units) / 2;
    return Number.isInteger(bb) ? String(bb) : bb.toFixed(1);
  }

  function createSeats(stackUnits, assumptions = {}, stackUnitsByPosition = {}) {
    return Object.fromEntries(
      POSITIONS.map((position) => [
        position,
        {
          position,
          stackUnits: Number(stackUnitsByPosition[position] ?? stackUnits),
          assumption: assumptions[position] || null,
          folded: false,
          allin: false,
        },
      ]),
    );
  }

  function nextPendingActor(afterActor, pending, seats) {
    const start = afterActor ? POSITIONS.indexOf(afterActor) : -1;
    for (let offset = 1; offset <= POSITIONS.length; offset += 1) {
      const position = POSITIONS[(start + offset) % POSITIONS.length];
      if (pending.has(position) && !seats[position].folded && !seats[position].allin) return position;
    }
    return null;
  }

  function activePositions(seats) {
    return POSITIONS.filter((position) => !seats[position].folded && !seats[position].allin);
  }

  function replayState(input = {}) {
    const settings = {
      gameType: "6max",
      startingStackBb: 100,
      opponentProfile: "loose",
      ...(input.settings || {}),
    };
    const stackUnits = toUnits(settings.startingStackBb);
    const stackUnitsByPosition = input.stackUnitsByPosition || {};
    const deadPotUnits = Number(input.deadPotUnits || 0);
    const seats = createSeats(stackUnits, input.assumptions, stackUnitsByPosition);
    const contributions = Object.fromEntries(POSITIONS.map((position) => [position, 0]));
    contributions.SB = 1;
    contributions.BB = 2;
    // Live posts from other seats (a player posting a big blind to join, CoinPoker's "AUTOBB"): the chips
    // are in the pot and count toward that seat's wager, so it can check when the action comes back.
    const postUnitsByPosition = Object.fromEntries(
      Object.entries(input.postUnitsByPosition || {}).filter(([position, units]) => POSITIONS.includes(position) && !["SB", "BB"].includes(position) && Number(units) > 0),
    );
    for (const [position, units] of Object.entries(postUnitsByPosition)) contributions[position] = Number(units);
    let potUnits = 3 + deadPotUnits + Object.values(postUnitsByPosition).reduce((total, units) => total + Number(units), 0);
    let highestContribution = 2;
    let lastFullRaiseUnits = 2;
    let pending = new Set(POSITIONS);
    let currentActor = "UTG";
    let lastActor = null;

    for (const action of input.actions || []) {
      const seat = seats[action.actor];
      if (!seat) throw new Error(`Unknown position ${action.actor}.`);
      if (currentActor && action.actor !== currentActor) {
        throw new Error(`${currentActor} is next to act, not ${action.actor}.`);
      }
      const previousContribution = contributions[action.actor];
      const targetUnits = Number(action.targetUnits ?? previousContribution);
      if (!Number.isFinite(targetUnits) || targetUnits < previousContribution) {
        throw new Error("Action total cannot be below the player's existing contribution.");
      }
      if (targetUnits > seat.stackUnits) throw new Error("Action total cannot exceed the player's stack.");

      if (action.type === "fold") {
        seat.folded = true;
      } else if (action.type === "check") {
        if (previousContribution !== highestContribution) throw new Error("Cannot check while facing a wager.");
      } else if (action.type === "call") {
        if (previousContribution >= highestContribution) throw new Error("There is no wager to call.");
        if (targetUnits !== highestContribution && targetUnits !== seat.stackUnits) {
          throw new Error("Call total must match the current wager.");
        }
      } else if (action.type === "raise" || action.type === "allin") {
        if (targetUnits <= highestContribution) {
          throw new Error(`Minimum raise total is ${formatBb(highestContribution + lastFullRaiseUnits)} bb.`);
        }
        const raiseIncrement = targetUnits - highestContribution;
        if (action.type !== "allin" && raiseIncrement < lastFullRaiseUnits) {
          throw new Error(`Minimum raise total is ${formatBb(highestContribution + lastFullRaiseUnits)} bb.`);
        }
        if (raiseIncrement >= lastFullRaiseUnits) lastFullRaiseUnits = raiseIncrement;
      } else {
        throw new Error(`Unsupported action ${action.type}.`);
      }

      if (targetUnits > previousContribution) {
        potUnits += targetUnits - previousContribution;
        contributions[action.actor] = targetUnits;
      }
      if (action.type === "allin" || targetUnits >= seat.stackUnits) seat.allin = true;

      if (targetUnits > highestContribution) {
        highestContribution = targetUnits;
        pending = new Set(activePositions(seats).filter((position) => position !== action.actor));
      } else {
        pending.delete(action.actor);
      }
      for (const position of POSITIONS) {
        if (seats[position].folded || seats[position].allin) pending.delete(position);
      }

      lastActor = action.actor;
      const unfolded = POSITIONS.filter((position) => !seats[position].folded);
      currentActor = unfolded.length <= 1 ? null : nextPendingActor(lastActor, pending, seats);
    }

    const roundComplete = currentActor === null;
    const amountToCallUnits = currentActor
      ? Math.max(0, highestContribution - contributions[currentActor])
      : 0;
    return {
      settings,
      seats,
      heroPosition: input.heroPosition || "SB",
      heroCards: orderCards(input.heroCards || []),
      actions: (input.actions || []).map((action) => ({ ...action })),
      contributions,
      currentActor,
      highestContribution,
      potUnits,
      amountToCallUnits,
      roundComplete,
      lastFullRaiseUnits,
      stackUnitsByPosition: Object.fromEntries(POSITIONS.map((position) => [position, seats[position].stackUnits])),
      deadPotUnits,
      postUnitsByPosition,
      error: null,
    };
  }

  function createInitialState(options = {}) {
    const settings = {
      gameType: "6max",
      startingStackBb: 100,
      opponentProfile: "loose",
      ...(options.settings || {}),
    };
    const actions = options.example
      ? [
          { actor: "UTG", type: "raise", targetUnits: 5 },
          { actor: "HJ", type: "fold", targetUnits: 0, automatic: true },
          { actor: "CO", type: "fold", targetUnits: 0, automatic: true },
          { actor: "BTN", type: "fold", targetUnits: 0, automatic: true },
          { actor: "SB", type: "raise", targetUnits: 18 },
          { actor: "BB", type: "fold", targetUnits: 2, automatic: true },
          { actor: "UTG", type: "call", targetUnits: 18 },
        ]
      : [];
    return replayState({
      settings,
      heroPosition: options.heroPosition || "SB",
      heroCards: options.heroCards || (options.example ? ["Ah", "Kh"] : []),
      actions,
      assumptions: options.assumptions,
      stackUnitsByPosition: options.stackUnitsByPosition,
      deadPotUnits: options.deadPotUnits,
      postUnitsByPosition: options.postUnitsByPosition,
    });
  }

  function quickRaiseTargets(state) {
    const stackUnits = state.seats[state.currentActor].stackUnits;
    const base = state.highestContribution;
    const candidates = base <= 2
      ? [5, 6, 8, 10]
      : [Math.ceil(base * 3), Math.ceil(base * 3.6), base * 4, base * 5];
    return [...new Set(candidates)].filter(
      (target) => target >= base + state.lastFullRaiseUnits && target < stackUnits,
    );
  }

  function legalActions(state) {
    if (!state.currentActor || state.roundComplete) {
      return { actor: null, amountToCallUnits: 0, actions: [] };
    }
    const actor = state.currentActor;
    const contribution = state.contributions[actor];
    const stackUnits = state.seats[actor].stackUnits;
    const facing = state.highestContribution > contribution;
    const aggressionCount = state.actions.filter(
      (action) => action.type === "raise" || action.type === "allin",
    ).length;
    const raiseLabel = aggressionCount === 0 ? "Raise" : aggressionCount === 1 ? "3-Bet" : "Re-raise";
    const actions = facing
      ? [
          { type: "fold", label: "Fold" },
          { type: "call", label: `Call ${formatBb(state.highestContribution - contribution)} bb`, targetUnits: Math.min(state.highestContribution, stackUnits) },
          {
            type: "raise",
            label: raiseLabel,
            quickTargetsUnits: quickRaiseTargets(state),
            minTargetUnits: state.highestContribution + state.lastFullRaiseUnits,
            maxTargetUnits: stackUnits,
          },
          { type: "allin", label: "All-in", targetUnits: stackUnits },
        ]
      : [
          { type: "check", label: "Check", targetUnits: contribution },
          {
            type: "raise",
            label: raiseLabel,
            quickTargetsUnits: quickRaiseTargets(state),
            minTargetUnits: state.highestContribution + state.lastFullRaiseUnits,
            maxTargetUnits: stackUnits,
          },
          { type: "allin", label: "All-in", targetUnits: stackUnits },
        ];
    return {
      actor,
      amountToCallUnits: Math.max(0, state.highestContribution - contribution),
      actions,
    };
  }

  function applyAction(state, action) {
    if (!state.currentActor) throw new Error("The pre-flop betting round is complete.");
    if (action.actor !== state.currentActor) {
      throw new Error(`${state.currentActor} is next to act, not ${action.actor}.`);
    }
    return replayState({
      settings: state.settings,
      heroPosition: state.heroPosition,
      heroCards: state.heroCards,
      assumptions: Object.fromEntries(POSITIONS.map((position) => [position, state.seats[position].assumption])),
      stackUnitsByPosition: state.stackUnitsByPosition,
      deadPotUnits: state.deadPotUnits,
      postUnitsByPosition: state.postUnitsByPosition,
      actions: [...state.actions, { ...action }],
    });
  }

  function replaceAction(state, index, action) {
    if (!Number.isInteger(index) || index < 0 || index >= state.actions.length) {
      throw new Error("Choose an existing action to edit.");
    }
    const actions = state.actions.slice(0, index);
    const replayed = replayState({
      settings: state.settings,
      heroPosition: state.heroPosition,
      heroCards: state.heroCards,
      assumptions: Object.fromEntries(POSITIONS.map((position) => [position, state.seats[position].assumption])),
      stackUnitsByPosition: state.stackUnitsByPosition,
      deadPotUnits: state.deadPotUnits,
      postUnitsByPosition: state.postUnitsByPosition,
      actions,
    });
    return applyAction(replayed, { ...action, actor: replayed.currentActor });
  }

  function setHero(state, position) {
    if (!POSITIONS.includes(position)) throw new Error("Choose a valid Hero position.");
    return replayState({
      settings: state.settings,
      heroPosition: position,
      heroCards: state.heroCards,
      actions: state.actions,
      assumptions: Object.fromEntries(POSITIONS.map((seat) => [seat, state.seats[seat].assumption])),
      stackUnitsByPosition: state.stackUnitsByPosition,
      deadPotUnits: state.deadPotUnits,
      postUnitsByPosition: state.postUnitsByPosition,
    });
  }

  function setHeroCards(state, cards) {
    if (!Array.isArray(cards) || ![0, 2].includes(cards.length)) {
      throw new Error("Select exactly two cards.");
    }
    if (new Set(cards).size !== cards.length) throw new Error("Hero cards must be unique.");
    if (cards.some((card) => !/^[2-9TJQKA][cdhs]$/.test(card))) {
      throw new Error("Choose valid poker cards.");
    }
    return replayState({
      settings: state.settings,
      heroPosition: state.heroPosition,
      heroCards: cards,
      actions: state.actions,
      assumptions: Object.fromEntries(POSITIONS.map((seat) => [seat, state.seats[seat].assumption])),
      stackUnitsByPosition: state.stackUnitsByPosition,
      deadPotUnits: state.deadPotUnits,
      postUnitsByPosition: state.postUnitsByPosition,
    });
  }

  function resetHand(state) {
    return createInitialState({
      empty: true,
      settings: state.settings,
      heroPosition: state.heroPosition,
      heroCards: [],
      assumptions: Object.fromEntries(POSITIONS.map((seat) => [seat, state.seats[seat].assumption])),
      stackUnitsByPosition: state.stackUnitsByPosition,
      deadPotUnits: state.deadPotUnits,
    });
  }

  function isAnalyzable(state) {
    return Boolean(
      POSITIONS.includes(state.heroPosition)
        && state.heroCards.length === 2
        && new Set(state.heroCards).size === 2
        && state.actions.some((action) => !action.automatic && action.actor !== state.heroPosition),
    );
  }

  function toLegacyPreflopInput(state) {
    let aggressionSeen = false;
    const preflopActions = state.actions.map((action) => {
      let legacyAction = action.type;
      if (action.type === "raise" && !aggressionSeen) legacyAction = "open";
      if (action.type === "raise" || action.type === "allin") aggressionSeen = true;
      return {
        actor: action.actor,
        action: legacyAction,
        amount: Number(formatBb(action.type === "fold" ? action.targetUnits || 0 : action.targetUnits || 0)),
      };
    });
    const villain = state.actions.find(
      (action) => action.actor !== state.heroPosition && !action.automatic && action.type !== "fold",
    );
    return {
      heroPosition: state.heroPosition,
      heroHand: state.heroCards.join(" "),
      villainPosition: villain?.actor || POSITIONS.find((position) => position !== state.heroPosition),
      preflopActions,
      preflopPotBb: state.potUnits / 2,
      preflopCallBb: state.amountToCallUnits / 2,
    };
  }

  const api = {
    POSITIONS,
    orderCards,
    toUnits,
    formatBb,
    replayState,
    createInitialState,
    legalActions,
    applyAction,
    replaceAction,
    setHero,
    setHeroCards,
    resetHand,
    isAnalyzable,
    toLegacyPreflopInput,
  };
  root.PokerCoachPreflopBuilderModel = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
