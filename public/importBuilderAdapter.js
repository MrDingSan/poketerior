(function attachImportBuilderAdapter(root) {
  const PREFLOP = root.PokerCoachPreflopBuilderModel;
  const POSTFLOP = root.PokerCoachPostflopBuilderModel;
  const STREETS = ["preflop", "flop", "turn", "river"];
  const IGNORED = new Set(["blind", "ante", "refund", "win", "muck"]);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // A missing stack is unknown, not 0bb: Number(null) is 0, which would zero every seat's stack.
  function knownStack(player) {
    return player?.stackBb != null && player.stackBb !== "" && Number.isFinite(Number(player.stackBb));
  }

  function builderPosition(position) {
    const value = String(position || "").toUpperCase();
    if (value === "MP" || value === "UTG+1") return "HJ";
    return PREFLOP.POSITIONS.includes(value) ? value : null;
  }

  function playerForAction(hand, action) {
    return (hand.players || []).find((player) => player.name === action.actor) || null;
  }

  function actorPosition(hand, action) {
    return builderPosition(action.position) || builderPosition(playerForAction(hand, action)?.position);
  }

  function actionIndexFor(hand) {
    const index = {};
    for (const street of STREETS) {
      (hand.streets?.[street]?.actions || []).forEach((action, actionIndex) => {
        if (IGNORED.has(action.action)) return;
        index[`${street}:${actionIndex}`] = {
          street,
          index: actionIndex,
          actor: actorPosition(hand, action),
          recordedAction: clone(action),
        };
      });
    }
    return index;
  }

  function preflopAction(state, hand, action, key) {
    const actor = actorPosition(hand, action);
    if (!actor) throw new Error(`${key} has no supported actor position.`);
    const type = action.action === "bet" ? "raise" : action.action;
    const previous = state.contributions[actor];
    let targetUnits = previous;
    if (["raise", "allin"].includes(type)) {
      if (action.amountBb == null) throw new Error(`${key} needs an amount.`);
      targetUnits = PREFLOP.toUnits(action.amountBb);
    } else if (type === "call") {
      targetUnits = Math.min(state.highestContribution, PREFLOP.toUnits(state.settings.startingStackBb));
    }
    return { actor, type, targetUnits, importedKey: key };
  }

  function postflopAction(state, hand, action, key) {
    const actor = actorPosition(hand, action);
    if (!actor) throw new Error(`${key} has no supported actor position.`);
    const type = action.action === "raise" ? "raise" : action.action;
    const contribution = state.players[actor].streetContributionUnits;
    let targetStreetContributionUnits = contribution;
    if (["bet", "raise"].includes(type)) {
      if (action.amountBb == null) throw new Error(`${key} needs an amount.`);
      targetStreetContributionUnits = POSTFLOP.toPostflopUnits(action.amountBb);
    } else if (type === "call") {
      targetStreetContributionUnits = Math.min(
        state.highestStreetContributionUnits,
        contribution + state.players[actor].stackUnits,
      );
    } else if (type === "allin") {
      targetStreetContributionUnits = contribution + state.players[actor].stackUnits;
    }
    return { actor, type, targetStreetContributionUnits, importedKey: key };
  }

  // When exactly one player's seat is unreadable and exactly one seat is free, that player must sit there.
  function inferMissingSeat(hand) {
    const players = hand.players || [];
    const unresolved = players.filter((player) => !builderPosition(player.position));
    if (unresolved.length !== 1) return hand;
    const taken = new Set(players.map((player) => builderPosition(player.position)).filter(Boolean));
    const free = PREFLOP.POSITIONS.filter((position) => !taken.has(position));
    if (free.length !== 1) return hand;
    const patched = clone(hand);
    patched.players = patched.players.map((player) => (player.name === unresolved[0].name ? { ...player, position: free[0] } : player));
    return patched;
  }

  function fromImportedHand(inputHand, options = {}) {
    if (!PREFLOP || !POSTFLOP) throw new Error("Builder models must load before the import adapter.");
    const hand = inferMissingSeat(inputHand);
    const sourceHand = clone(hand);
    const hero = (hand.players || []).find((player) => player.name === options.heroName)
      || (hand.players || []).find((player) => player.isHero);
    const stackValues = (hand.players || []).filter(knownStack).map((player) => Number(player.stackBb));
    const startingStackBb = Number(options.startingStackBb) || Math.max(100, ...stackValues, 0);
    const stackUnitsByPosition = Object.fromEntries((hand.players || []).flatMap((player) => {
      const position = builderPosition(player.position);
      return position && knownStack(player) ? [[position, PREFLOP.toUnits(player.stackBb)]] : [];
    }));
    const deadPotBb = (hand.streets?.preflop?.actions || [])
      .filter((action) => action.action === "ante" && Number.isFinite(Number(action.amountBb)))
      .reduce((total, action) => total + Number(action.amountBb), 0);
    const deadPotUnits = PREFLOP.toUnits(deadPotBb);
    // A blind row from a seat other than SB/BB is a live post (CoinPoker "AUTOBB"); dropping it would make
    // that player's later check look illegal and block every decision after it.
    const postUnitsByPosition = {};
    for (const action of hand.streets?.preflop?.actions || []) {
      const position = builderPosition(actorPosition(hand, action));
      if (action.action !== "blind" || !position || ["SB", "BB"].includes(position) || !Number.isFinite(Number(action.amountBb))) continue;
      postUnitsByPosition[position] = (postUnitsByPosition[position] || 0) + PREFLOP.toUnits(Number(action.amountBb));
    }
    let preflopState = PREFLOP.createInitialState({
      settings: { gameType: "6max", startingStackBb, opponentProfile: options.opponentProfile || "loose" },
      heroPosition: builderPosition(hero?.position) || "SB",
      heroCards: hand.heroHand || [],
      stackUnitsByPosition,
      deadPotUnits,
      postUnitsByPosition,
    });
    const streetPotsBb = { preflop: preflopState.potUnits / 2 };
    const unresolved = [];
    const preflopActions = hand.streets?.preflop?.actions || [];
    for (let index = 0; index < preflopActions.length; index += 1) {
      const action = preflopActions[index];
      if (IGNORED.has(action.action)) continue;
      const key = `preflop:${index}`;
      try {
        const expectedActor = actorPosition(hand, action);
        // Strict imports never synthesize folds: a missing actor row must surface as an unresolved field.
        while (!options.strict && preflopState.currentActor && expectedActor && preflopState.currentActor !== expectedActor) {
          preflopState = PREFLOP.applyAction(preflopState, {
            actor: preflopState.currentActor,
            type: "fold",
            targetUnits: preflopState.contributions[preflopState.currentActor],
            automatic: true,
          });
        }
        preflopState = PREFLOP.applyAction(preflopState, preflopAction(preflopState, hand, action, key));
      } catch (error) {
        unresolved.push({ key, street: "preflop", index, message: error.message });
        break;
      }
    }

    // A snapshot of the reconstructed state as of the end of each street, so the
    // decision path can show the board/stacks as they stood at whichever node the
    // user selects instead of always showing the hand's final state.
    const postflopStateByStreet = {};
    let postflopState = null;
    if (preflopState.roundComplete) {
      postflopState = POSTFLOP.createFromPreflop(preflopState);
      for (const player of hand.players || []) {
        const position = builderPosition(player.position);
        if (!position || !knownStack(player)) continue;
        const committedBb = preflopState.contributions[position] / 2;
        postflopState.players[position].stackUnits = POSTFLOP.toPostflopUnits(Math.max(0, Number(player.stackBb) - committedBb));
      }
      for (const street of ["flop", "turn", "river"]) {
        const cards = street === "flop" ? hand.board?.flop || [] : [hand.board?.[street]].filter(Boolean);
        if (!cards.length) break;
        try {
          postflopState = POSTFLOP.setBoardCards(postflopState, street, cards);
          streetPotsBb[street] = postflopState.potUnits / POSTFLOP.toPostflopUnits(1);
        } catch (error) {
          unresolved.push({ key: `board:${street}`, street, index: -1, message: error.message });
          break;
        }
        const actions = hand.streets?.[street]?.actions || [];
        let stopped = false;
        const consumed = new Set();
        for (let index = 0; index < actions.length; index += 1) {
          const action = actions[index];
          if (IGNORED.has(action.action) || consumed.has(index)) continue;
          const key = `${street}:${index}`;
          try {
            const expectedActor = actorPosition(hand, action);
            // A bet can only open a street after every earlier live seat checked: use that seat's listed check if the
            // extraction placed it later, otherwise imply it.
            while (!options.strict && expectedActor && postflopState.currentActor && postflopState.currentActor !== expectedActor
              && postflopState.highestStreetContributionUnits === 0 && ["bet", "check"].includes(action.action)) {
              const skipped = postflopState.currentActor;
              const laterCheck = actions.findIndex((candidate, candidateIndex) => candidateIndex > index && !consumed.has(candidateIndex)
                && candidate.action === "check" && actorPosition(hand, candidate) === skipped);
              if (laterCheck >= 0) consumed.add(laterCheck);
              postflopState = POSTFLOP.applyAction(postflopState, { actor: skipped, type: "check", targetStreetContributionUnits: 0, automatic: laterCheck < 0 });
            }
            // Hand-history screenshots often show end-of-hand stacks, so a wager can exceed the displayed stack.
            const wagerUnits = ["bet", "raise"].includes(action.action) && action.amountBb != null ? POSTFLOP.toPostflopUnits(action.amountBb) : 0;
            const bettor = postflopState.players[expectedActor];
            if (bettor && wagerUnits > bettor.streetContributionUnits + bettor.stackUnits) bettor.stackUnits = wagerUnits - bettor.streetContributionUnits;
            postflopState = POSTFLOP.applyAction(postflopState, postflopAction(postflopState, hand, action, key));
          } catch (error) {
            unresolved.push({ key, street, index, message: error.message });
            stopped = true;
            break;
          }
        }
        postflopStateByStreet[street] = postflopState;
        if (stopped || !postflopState.streetComplete) break;
        postflopState = POSTFLOP.advanceStreet(postflopState);
      }
    }

    return {
      preflopState,
      postflopState,
      postflopStateByStreet,
      sourceHand,
      warnings: clone(hand.validationWarnings || hand.confidenceNotes || []),
      unresolved,
      actionIndex: actionIndexFor(hand),
      streetPotsBb,
    };
  }

  function rebuild(sourceHand) {
    return fromImportedHand(sourceHand, { heroName: sourceHand.heroName });
  }

  function truncateAfterStreet(source, street, keepTargetActions = true) {
    const rank = STREETS.indexOf(street);
    for (let index = rank + 1; index < STREETS.length; index += 1) {
      source.streets[STREETS[index]].actions = [];
    }
    if (rank < 3) source.board.river = null;
    if (rank < 2) source.board.turn = null;
    if (rank < 1) source.board.flop = [];
    if (!keepTargetActions) source.streets[street].actions = [];
    return STREETS.slice(Math.max(1, rank + 1));
  }

  function editImportedAction(converted, actionKey, replacement) {
    const entry = converted?.actionIndex?.[actionKey];
    if (!entry) throw new Error(`Unknown imported action ${actionKey}.`);
    const source = clone(converted.sourceHand);
    const existing = source.streets[entry.street].actions[entry.index];
    source.streets[entry.street].actions = [
      ...source.streets[entry.street].actions.slice(0, entry.index),
      { ...existing, ...replacement, userCorrected: true },
    ];
    const discardedStreets = truncateAfterStreet(source, entry.street);
    return { converted: rebuild(source), discardedStreets, correctedKey: actionKey };
  }

  function editImportedCards(converted, fieldKey, cards) {
    const source = clone(converted.sourceHand);
    const nextCards = [...cards];
    if (new Set(nextCards).size !== nextCards.length) throw new Error("Cards must be unique.");
    const elsewhere = [];
    if (fieldKey !== "hero") elsewhere.push(...(source.heroHand || []));
    if (fieldKey !== "flop") elsewhere.push(...(source.board?.flop || []));
    if (fieldKey !== "turn" && source.board?.turn) elsewhere.push(source.board.turn);
    if (fieldKey !== "river" && source.board?.river) elsewhere.push(source.board.river);
    if (nextCards.some((card) => elsewhere.includes(card))) throw new Error("That card is already in use.");
    if (fieldKey === "hero") {
      if (nextCards.length !== 2) throw new Error("Select exactly two Hero cards.");
      source.heroHand = nextCards;
    } else if (fieldKey === "flop") {
      if (nextCards.length !== 3) throw new Error("Select exactly three flop cards.");
      source.board.flop = nextCards;
      truncateAfterStreet(source, "flop", false);
    } else if (fieldKey === "turn" || fieldKey === "river") {
      if (nextCards.length !== 1) throw new Error(`Select exactly one ${fieldKey} card.`);
      source.board[fieldKey] = nextCards[0];
      truncateAfterStreet(source, fieldKey, false);
    } else {
      throw new Error("Choose Hero, flop, turn, or river cards to edit.");
    }
    source.userCorrections ||= {};
    source.userCorrections[fieldKey] = true;
    return { converted: rebuild(source), correctedKey: `cards:${fieldKey}` };
  }

  function changeImportedHero(converted, playerName) {
    const source = clone(converted.sourceHand);
    if (!(source.players || []).some((player) => player.name === playerName)) throw new Error("Choose an imported player as Hero.");
    source.heroName = playerName;
    source.players = source.players.map((player) => ({ ...player, isHero: player.name === playerName }));
    source.userCorrections ||= {};
    source.userCorrections.hero = true;
    return { converted: rebuild(source), correctedKey: "hero" };
  }

  const api = { fromImportedHand, builderPosition, actorPosition, editImportedAction, editImportedCards, changeImportedHero };
  root.PokerCoachImportBuilderAdapter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
