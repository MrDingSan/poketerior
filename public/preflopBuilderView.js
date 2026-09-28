(function attachPreflopBuilderView(root) {
  const SUITS = ["s", "h", "d", "c"];
  const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
  const SUIT_SYMBOLS = { s: "♠", h: "♥", d: "♦", c: "♣" };
  const SUIT_NAMES = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };
  const RANK_NAMES = { A: "Ace", K: "King", Q: "Queen", J: "Jack", T: "Ten" };
  const SETTINGS_KEY = "pokerCoach.manualBuilder.settings.v1";

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function cardMarkup(card, className = "mini-card") {
    if (!card) return `<span class="${className} card-back" aria-hidden="true"></span>`;
    const [rank, suit] = card;
    const red = suit === "h" || suit === "d";
    return `<span class="${className}${red ? " is-red" : ""}" aria-label="${RANK_NAMES[rank] || rank} of ${SUIT_NAMES[suit]}"><b>${rank === "T" ? "10" : rank}</b><i>${SUIT_SYMBOLS[suit]}</i></span>`;
  }

  function updateCardSelection(selectedCards, card) {
    if (selectedCards.includes(card)) {
      return selectedCards.filter((selected) => selected !== card);
    }
    if (selectedCards.length < 2) return [...selectedCards, card];
    return [selectedCards[1], card];
  }

  function orderCards(cards) {
    return [...cards].sort((left, right) => RANKS.indexOf(left[0]) - RANKS.indexOf(right[0]));
  }

  function timelineActions(state) {
    return state.actions;
  }

  function actionChanged(existing, replacement) {
    return existing?.type !== replacement?.type
      || Number(existing?.targetUnits) !== Number(replacement?.targetUnits);
  }

  function seatMarkup(state, position, model) {
    const seat = state.seats[position];
    const isHero = state.heroPosition === position;
    const cards = isHero && state.heroCards.length === 2
      ? orderCards(state.heroCards).map((card) => cardMarkup(card)).join("")
      : `${cardMarkup(null)}${cardMarkup(null)}`;
    return `
      <button class="poker-seat seat-${position.toLowerCase()}${isHero ? " is-hero" : ""}${state.currentActor === position ? " is-current" : ""}${seat.folded ? " is-folded" : ""}" type="button" data-seat="${position}" aria-pressed="${isHero}">
        <span class="seat-cards">${cards}</span>
        <strong>${isHero ? "Hero" : position}${isHero ? ` <small>(${position})</small>` : ""}</strong>
        <span>${state.settings.startingStackBb} bb</span>
        ${isHero ? '<span class="hero-star" aria-label="Hero seat">★</span>' : ""}
      </button>`;
  }

  function commitmentMarkup(state, position, model) {
    const contribution = state.contributions[position];
    if (!contribution) return "";
    return `<span class="table-commitment commitment-${position.toLowerCase()}" aria-label="${position} has committed ${model.formatBb(contribution)} big blinds"><i aria-hidden="true">●</i><b>${model.formatBb(contribution)} bb</b></span>`;
  }

  function actionLabel(action, model, previousContribution = 0) {
    const labels = { fold: "Fold", check: "Check", call: "Call", raise: "Raise", allin: "All-in" };
    const amount = action.type === "call"
      ? ` +${model.formatBb(action.targetUnits - previousContribution)} bb`
      : ["raise", "allin"].includes(action.type) ? ` to ${model.formatBb(action.targetUnits)} bb` : "";
    return `${labels[action.type] || action.type}${amount}`;
  }

  function createPreflopBuilderView({ root: builderRoot, model, initialState, onStateChange, onAnalyze, onContinueFlop }) {
    if (!builderRoot || !model) throw new Error("Pre-flop builder root and model are required.");
    let state = initialState;
    let draftCards = [...state.heroCards];
    let cardTrigger = null;
    let sizingOpen = false;
    let editingIndex = null;
    let inlineError = "";

    const table = builderRoot.querySelector("#preflopTable");
    const nextPanel = builderRoot.querySelector("#nextActionPanel");
    const timeline = builderRoot.querySelector("#preflopTimeline");
    const potDisplay = builderRoot.querySelector("#preflopPotDisplay");
    const dialog = builderRoot.querySelector("#heroCardDialog");
    const picker = builderRoot.querySelector("#cardPickerGrid");
    const selectedPreview = builderRoot.querySelector("#selectedCardsPreview");
    const confirmCards = builderRoot.querySelector("#confirmHeroCardsBtn");
    const analyzeButton = builderRoot.querySelector("#analyzePreflopBtn");
    const continueButton = builderRoot.querySelector("#continueFlopBtn");
    const gameType = builderRoot.querySelector("#builderGameType");
    const startingStack = builderRoot.querySelector("#builderStartingStack");
    const opponentProfile = builderRoot.querySelector("#builderOpponentProfile");
    const assumptions = builderRoot.querySelector("#opponentAssumptions");
    const intelligence = builderRoot.querySelector("#rangeIntelligenceSummary");

    function assumptionsFromState(source = state) {
      return Object.fromEntries(model.POSITIONS.map((position) => [position, source.seats[position].assumption]));
    }

    function replayWith(overrides = {}) {
      return model.replayState({
        settings: overrides.settings || state.settings,
        heroPosition: overrides.heroPosition || state.heroPosition,
        heroCards: overrides.heroCards || state.heroCards,
        actions: overrides.actions || state.actions,
        assumptions: overrides.assumptions || assumptionsFromState(),
      });
    }

    function notify() {
      onStateChange?.(state);
    }

    function renderTable() {
      table.innerHTML = `
        <div class="felt-brand" aria-hidden="true"><strong>PokerTerior</strong><small>PRIOR → ACTION → POSTERIOR</small><em class="table-pot">Pot · ${model.formatBb(state.potUnits)} bb</em></div>
        ${model.POSITIONS.map((position) => seatMarkup(state, position, model)).join("")}
        ${model.POSITIONS.map((position) => commitmentMarkup(state, position, model)).join("")}
      `;
    }

    function stateForActionEntry() {
      if (editingIndex === null) return state;
      return model.replayState({
        settings: state.settings,
        heroPosition: state.heroPosition,
        heroCards: state.heroCards,
        actions: state.actions.slice(0, editingIndex),
        assumptions: assumptionsFromState(),
      });
    }

    function renderNextAction() {
      const actionState = stateForActionEntry();
      const legal = model.legalActions(actionState);
      if (!legal.actor) {
        nextPanel.innerHTML = `
          <div class="next-action-heading"><span class="status-icon" aria-hidden="true">✓</span><div><span>Hand ready</span><h2>Pre-flop complete</h2></div></div>
          <p>The action is closed. Analyze now or edit an action below.</p>`;
        return;
      }
      const hero = legal.actor === state.heroPosition;
      nextPanel.innerHTML = `
        <div class="next-action-heading">
          <span class="status-icon" aria-hidden="true">${hero ? "★" : "→"}</span>
          <div><span>${editingIndex === null ? "Your Decision" : "Editing Decision"}</span><h2>${hero ? "Hero" : legal.actor} <small>(${legal.actor})</small></h2></div>
        </div>
        <p>${hero ? "Hero’s turn. What would you like to do?" : `${legal.actor} is next to act.`}</p>
        <div class="context-actions">
          ${legal.actions.map((action) => `<button type="button" class="context-action action-${action.type}" data-action-type="${action.type}"${action.targetUnits !== undefined ? ` data-target-units="${action.targetUnits}"` : ""}><strong>${escapeHtml(action.label)}</strong></button>`).join("")}
        </div>
        ${sizingOpen ? renderSizing(actionState, legal) : ""}
        ${inlineError ? `<p class="inline-error" role="alert">${escapeHtml(inlineError)}</p>` : ""}
      `;
    }

    function renderSizing(actionState, legal) {
      const raise = legal.actions.find((action) => action.type === "raise");
      if (!raise) return "";
      return `
        <div class="sizing-panel">
          <div class="sizing-panel-header">
            <span>Raise total (bb)</span>
            <button type="button" class="sizing-close" data-close-sizing aria-label="Cancel sizing">×</button>
          </div>
          <div class="quick-sizes">
            ${(raise.quickTargetsUnits || []).map((target) => `<button type="button" data-action-type="raise" data-target-units="${target}">${model.formatBb(target)}</button>`).join("")}
            <button type="button" data-action-type="allin" data-target-units="${raise.maxTargetUnits}">All-in</button>
          </div>
          <label for="customRaiseAmount">Custom total</label>
          <div class="custom-size-row"><input id="customRaiseAmount" type="number" min="${model.formatBb(raise.minTargetUnits)}" max="${model.formatBb(raise.maxTargetUnits)}" step="0.5" inputmode="decimal" placeholder="${model.formatBb(raise.minTargetUnits)}" /><button id="applyCustomRaiseBtn" type="button">Apply</button></div>
        </div>`;
    }

    function renderTimeline() {
      const displayedActions = timelineActions(state);
      const actionState = editingIndex === null ? state : stateForActionEntry();
      let replay = model.replayState({
        settings: state.settings,
        heroPosition: state.heroPosition,
        heroCards: state.heroCards,
        actions: [],
        assumptions: assumptionsFromState(),
      });
      const entries = displayedActions.map((action, index) => {
        const previousContribution = replay.contributions[action.actor];
        const markup = `<button type="button" class="timeline-action${editingIndex === index ? " is-current" : ""}" data-edit-index="${index}"><span>${index + 1}</span><b>${action.actor}</b><strong>${actionLabel(action, model, previousContribution)}</strong></button>`;
        replay = model.applyAction(replay, action);
        return markup;
      });
      if (editingIndex !== null) {
        // The selected historical action remains highlighted in the intact path.
      } else if (actionState.currentActor) {
        const actor = actionState.currentActor;
        const isHero = actor === state.heroPosition;
        entries.push(`<div class="timeline-action is-pending" aria-live="polite"><span>${displayedActions.length + 1}</span><b>${isHero ? "Hero" : actor}</b><strong>${isHero ? "Choose action" : "Action pending"}</strong></div>`);
        entries.push(`<div class="timeline-action is-future" aria-hidden="true"><span>…</span><b>Next</b><strong>Waiting</strong></div>`);
      } else {
        entries.push(`<div class="timeline-action is-complete"><span>✓</span><b>Round</b><strong>Complete</strong></div>`);
      }
      timeline.innerHTML = entries.join('<span class="timeline-arrow" aria-hidden="true">→</span>');
      potDisplay.textContent = `Pot: ${model.formatBb(state.potUnits)} bb`;
    }

    function renderAssumptions() {
      assumptions.innerHTML = model.POSITIONS
        .filter((position) => position !== state.heroPosition)
        .map((position) => `
          <label><span>${position}</span><select data-assumption-seat="${position}">
            ${["tight", "standard", "loose", "custom"].map((value) => `<option value="${value}" ${(state.seats[position].assumption || state.settings.opponentProfile) === value ? "selected" : ""}>${value[0].toUpperCase() + value.slice(1)}</option>`).join("")}
          </select></label>`).join("");
    }

    function renderPicker() {
      selectedPreview.innerHTML = draftCards.length
        ? draftCards.map((card) => cardMarkup(card, "selected-card")).join("")
        : '<span class="selected-card-empty">No cards selected</span>';
      confirmCards.disabled = draftCards.length !== 2;
      picker.innerHTML = SUITS.map((suit) => `
        <div class="card-suit-row" data-suit="${suit}">
          ${RANKS.map((rank) => {
            const card = `${rank}${suit}`;
            const selected = draftCards.includes(card);
            return `<button type="button" class="picker-card${selected ? " is-selected" : ""}${suit === "h" || suit === "d" ? " is-red" : ""}" data-card="${card}" aria-label="${RANK_NAMES[rank] || rank} of ${SUIT_NAMES[suit]}" aria-pressed="${selected}"><b>${rank === "T" ? "10" : rank}</b><i>${SUIT_SYMBOLS[suit]}</i></button>`;
          }).join("")}
        </div>`).join("");
    }

    function render() {
      renderTable();
      renderNextAction();
      renderTimeline();
      renderAssumptions();
      gameType.value = state.settings.gameType;
      startingStack.value = String(state.settings.startingStackBb);
      opponentProfile.value = state.settings.opponentProfile;
      const opponentProfileLabel = opponentProfile.options[opponentProfile.selectedIndex]?.text || "Standard";
      intelligence.textContent = `${opponentProfileLabel} baseline selected.`;
      const opponentAssumptionsValue = builderRoot.querySelector("#opponentAssumptionsValue");
      if (opponentAssumptionsValue) opponentAssumptionsValue.textContent = opponentProfileLabel;
      analyzeButton.disabled = !model.isAnalyzable(state);
      continueButton.disabled = !model.isAnalyzable(state) || !state.roundComplete;
    }

    function commitAction(type, targetUnits) {
      const actionState = stateForActionEntry();
      const legal = model.legalActions(actionState);
      try {
        const fallbackTarget = type === "fold" || type === "check"
          ? actionState.contributions[legal.actor]
          : legal.actions.find((item) => item.type === type)?.targetUnits;
        const replacement = {
          actor: legal.actor,
          type,
          targetUnits: Number(targetUnits ?? fallbackTarget ?? 0),
        };
        if (editingIndex === null || actionChanged(state.actions[editingIndex], replacement)) {
          state = model.applyAction(actionState, replacement);
        }
        editingIndex = null;
        sizingOpen = false;
        inlineError = "";
        render();
        notify();
      } catch (error) {
        inlineError = error.message;
        renderNextAction();
      }
    }

    table.addEventListener("click", (event) => {
      const seat = event.target.closest("[data-seat]");
      if (!seat) return;
      if (seat.dataset.seat === state.heroPosition) {
        cardTrigger = seat;
        draftCards = [...state.heroCards];
        renderPicker();
        dialog.showModal();
        picker.querySelector("button")?.focus();
        return;
      }
      state = model.setHero(state, seat.dataset.seat);
      render();
      notify();
    });

    nextPanel.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-sizing]")) {
        sizingOpen = false;
        inlineError = "";
        renderNextAction();
        return;
      }
      const actionButton = event.target.closest("[data-action-type]");
      if (actionButton) {
        const type = actionButton.dataset.actionType;
        if (type === "raise" && !actionButton.dataset.targetUnits) {
          event.stopPropagation();
          sizingOpen = true;
          inlineError = "";
          renderNextAction();
          return;
        }
        commitAction(type, actionButton.dataset.targetUnits);
        return;
      }
      if (event.target.closest("#applyCustomRaiseBtn")) {
        const input = nextPanel.querySelector("#customRaiseAmount");
        commitAction("raise", model.toUnits(input.value));
      }
    });

    timeline.addEventListener("click", (event) => {
      const action = event.target.closest("[data-edit-index]");
      if (!action) return;
      editingIndex = Number(action.dataset.editIndex);
      sizingOpen = false;
      inlineError = "";
      render();
    });

    document.addEventListener("click", (event) => {
      if (!sizingOpen || nextPanel.contains(event.target)) return;
      sizingOpen = false;
      inlineError = "";
      renderNextAction();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && sizingOpen) {
        sizingOpen = false;
        inlineError = "";
        renderNextAction();
      }
    });

    picker.addEventListener("click", (event) => {
      const button = event.target.closest("[data-card]");
      if (!button) return;
      const card = button.dataset.card;
      draftCards = updateCardSelection(draftCards, card);
      renderPicker();
    });

    builderRoot.querySelector("#clearSelectedCardsBtn").addEventListener("click", () => {
      draftCards = [];
      renderPicker();
    });

    dialog.addEventListener("close", () => cardTrigger?.focus());
    dialog.addEventListener("keydown", (event) => {
      if (event.key === "Escape") dialog.close("cancel");
    });
    confirmCards.addEventListener("click", (event) => {
      if (draftCards.length !== 2) {
        event.preventDefault();
        return;
      }
      state = model.setHeroCards(state, draftCards);
      render();
      notify();
    });

    function updateSettings() {
      const settings = {
        gameType: gameType.value,
        startingStackBb: Number(startingStack.value),
        opponentProfile: opponentProfile.value,
      };
      state = replayWith({ settings });
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
      render();
      notify();
    }
    gameType.addEventListener("change", updateSettings);
    startingStack.addEventListener("change", updateSettings);
    opponentProfile.addEventListener("change", updateSettings);

    assumptions.addEventListener("change", (event) => {
      const select = event.target.closest("[data-assumption-seat]");
      if (!select) return;
      const nextAssumptions = assumptionsFromState();
      nextAssumptions[select.dataset.assumptionSeat] = select.value;
      state = replayWith({ assumptions: nextAssumptions });
      render();
      notify();
    });

    analyzeButton.addEventListener("click", () => onAnalyze?.(state));
    continueButton.addEventListener("click", () => onContinueFlop?.(state));

    render();
    notify();

    return {
      getState: () => state,
      setState(nextState) { state = nextState; editingIndex = null; render(); notify(); },
      reset() { state = model.resetHand(state); editingIndex = null; render(); notify(); },
    };
  }

  root.PokerCoachPreflopBuilderView = {
    createPreflopBuilderView,
    updateCardSelection,
    orderCards,
    timelineActions,
    actionChanged,
    SETTINGS_KEY,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
