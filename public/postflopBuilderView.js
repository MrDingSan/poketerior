(function attachPostflopBuilderView(root) {
  const RANKS = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
  const SUITS = [{ code: "s", symbol: "♠" }, { code: "h", symbol: "♥" }, { code: "d", symbol: "♦" }, { code: "c", symbol: "♣" }];
  const STREET_KEYS = ["preflop", "flop", "turn", "river", "results"];
  const POSITIONS = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
  const RANK_NAMES = { A: "Ace", K: "King", Q: "Queen", J: "Jack", T: "Ten", 9: "Nine", 8: "Eight", 7: "Seven", 6: "Six", 5: "Five", 4: "Four", 3: "Three", 2: "Two" };
  const SUIT_NAMES = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };
  const cardAriaLabel = (card) => card ? `${RANK_NAMES[card[0]]} of ${SUIT_NAMES[card.slice(-1)]}` : "Empty community card";
  const orderCards = (cards = []) => [...cards].sort(
    (left, right) => RANKS.indexOf(left[0]) - RANKS.indexOf(right[0]),
  );
  const cardMarkup = (card) => {
    if (!card) return "";
    const suit = SUITS.find((entry) => entry.code === card.slice(-1));
    return `<span class="board-card board-card--${suit.code}"><b>${card[0]}</b><i>${suit.symbol}</i></span>`;
  };

  function createPostflopBuilderView(options) {
    const container = options.root;
    const model = options.model || root.PokerCoachPostflopBuilderModel;
    if (!container || !model) throw new Error("Post-flop builder requires a root and model.");
    const find = (selector) => container.querySelector(selector);
    const el = {
      navigator: find("#streetNavigator"), board: find("#boardCardSlots"), seats: find("#postflopSeats"), pot: find("#postflopPot"),
      next: find("#postflopNextAction"), timeline: find("#postflopTimeline"), dialog: find("#postflopCardDialog"),
      picker: find("#postflopCardPickerGrid"), selected: find("#postflopSelectedCards"), help: find("#postflopCardPickerHelp"), clear: find("#clearBoardCardsBtn"),
      confirm: find("#confirmBoardCardsBtn"), advance: find("#postflopAdvanceBtn"), analyze: find("#postflopAnalyzeBtn"),
    };
    let state = options.initialState || null;
    let draftCards = [];
    let pendingAggressiveAction = null;
    let panelMessage = "";
    let pickerOpener = null;
    const notify = () => { if (typeof options.onStateChange === "function") options.onStateChange(state); };

    function renderNavigator() {
      const current = state ? STREET_KEYS.indexOf(state.street) : 0;
      el.navigator.innerHTML = STREET_KEYS.map((street, index) => {
        const status = index < current ? "is-complete" : index === current ? "is-current" : "is-future";
        return `<button type="button" class="street-step ${status}" data-street-target="${street}" ${index > current || index === 0 || index === 4 ? "disabled" : ""}><span>${index < current ? "✓" : index + 1}</span><b>${street === "preflop" ? "Pre-flop" : street[0].toUpperCase() + street.slice(1)}</b></button>`;
      }).join("");
    }

    function renderBoard() {
      const cards = state ? [...state.board.flop, state.board.turn, state.board.river].filter(Boolean) : [];
      el.board.innerHTML = Array.from({ length: 5 }, (_, index) => {
        const card = cards[index];
        const street = index < 3 ? "flop" : index === 3 ? "turn" : "river";
        const enabled = state && state.street === street && !card;
        return `<button class="board-card-slot${card ? " has-card" : ""}" type="button" data-street="${street}" ${enabled ? "" : "disabled"} aria-label="${card ? cardAriaLabel(card) : `Select ${street} card`}">${cardMarkup(card)}<span>${card ? "" : "+"}</span></button>`;
      }).join("");
    }

    function renderSeats() {
      if (!state) { el.seats.innerHTML = ""; return; }
      el.seats.innerHTML = POSITIONS.map((position) => {
        const player = state.players[position];
        const hero = position === state.heroPosition;
        const status = player.folded ? " is-folded" : state.currentActor === position ? " is-acting is-current" : "";
        const chips = player.streetContributionUnits ? `<div class="felt-commitment"><i></i>${model.formatPostflopBb(player.streetContributionUnits)} bb</div>` : "";
        return `<div class="postflop-seat postflop-seat--${position.toLowerCase()}${hero ? " is-hero" : ""}${status}"><strong>${hero ? "★ Hero" : position} <small>(${position})</small></strong>${hero ? `<div class="hero-hole-cards">${orderCards(state.heroCards).map(cardMarkup).join("")}</div>` : ""}<span>${model.formatPostflopBb(player.stackUnits)} bb${player.allin ? " · All-in" : ""}</span>${chips}</div>`;
      }).join("");
    }

    function renderTimeline() {
      if (!state) { el.timeline.innerHTML = ""; return; }
      const actions = [
        ...state.preflopActions.map((action) => ({ ...action, street: "preflop" })),
        ...Object.entries(state.streetActions).flatMap(([street, entries]) => entries.map((action) => ({ ...action, street }))),
      ];
      let previousStreet = null;
      const completed = actions.map((action, index) => {
        const street = action.street || "preflop";
        const label = street !== previousStreet ? `<div class="timeline-street-label" data-timeline-street="${street}">${street === "preflop" ? "Pre-flop" : street[0].toUpperCase() + street.slice(1)}</div>` : "";
        previousStreet = street;
        const isHero = action.actor === state.heroPosition;
        const isFold = action.type === "fold";
        return `${label}<button type="button" class="timeline-action street-action${isFold ? " is-fold" : ""}" data-postflop-edit="${index}" data-action-street="${street}" data-action-role="${isHero ? "hero" : "villain"}" data-action-type="${action.type}"><span>${index + 1}</span><strong>${action.actor}</strong><small>${action.type}${action.incrementAmountUnits ? ` ${model.formatPostflopBb(action.incrementAmountUnits)} bb` : ""}</small></button>`;
      }).join("");
      const pendingIsHero = state.currentActor === state.heroPosition;
      const pending = state.currentActor ? `<div class="timeline-action street-action is-pending" data-action-role="${pendingIsHero ? "hero" : "villain"}"><span>${actions.length + 1}</span><strong>${state.currentActor}</strong><small>To act</small></div>` : "";
      el.timeline.innerHTML = completed + pending || '<p class="muted">Choose board cards to begin the flop.</p>';
    }

    function focusTimelineOnCurrentStreet() {
      const target = el.timeline.querySelector(".street-action.is-pending")
        || el.timeline.querySelector(`[data-timeline-street="${state?.street}"]`);
      if (!target) return;
      const focus = () => target.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      if (typeof root.requestAnimationFrame === "function") root.requestAnimationFrame(focus);
      else focus();
    }

    function renderNextAction() {
      if (!state) { el.next.innerHTML = "<p>Finish pre-flop to begin.</p>"; return; }
      const boardReady = state.street === "results" || (state.street === "flop" ? state.board.flop.length === 3 : Boolean(state.board[state.street]));
      el.next.classList.toggle("is-board-prompt", !boardReady);
      if (!boardReady) {
        const streetLabel = state.street.charAt(0).toUpperCase() + state.street.slice(1);
        el.next.innerHTML = `<div class="section-title"><span>${streetLabel}</span><strong>Select board cards</strong></div><p>Add the ${state.street} ${state.street === "flop" ? "cards" : "card"} on the table.</p>`;
        return;
      }
      const legal = model.legalActions(state);
      const actions = legal.actions.map((action) => {
        const variant = action.type === "call" ? " postflop-action-call" : ["bet", "raise", "allin"].includes(action.type) ? " postflop-action-aggressive" : "";
        return `<button type="button" class="postflop-action${variant}" data-postflop-action="${action.type}" data-target="${action.targetStreetContributionUnits ?? ""}">${action.label}</button>`;
      }).join("");
      const sizes = pendingAggressiveAction ? model.betSizePresets(state).map((preset) => `<button type="button" class="postflop-size" data-postflop-size="${preset.targetStreetContributionUnits}"><b>${preset.fraction}</b><span>${model.formatPostflopBb(preset.amountUnits)} bb</span></button>`).join("") : "";
      const hero = state.currentActor === state.heroPosition;
      const heading = state.currentActor ? (hero ? "Your Decision" : "Villain Decision") : "Street complete";
      const subtext = state.currentActor
        ? (hero ? "Hero’s turn. What would you like to do?" : `${state.currentActor} is next to act.`)
        : "";
      el.next.innerHTML = `<div class="section-title"><span>${heading}</span><strong>${hero ? "★ Hero" : state.currentActor || "Street complete"}</strong></div>${subtext ? `<p>${subtext}</p>` : ""}${panelMessage ? `<p class="postflop-message">${panelMessage}</p>` : ""}<div class="postflop-actions">${actions}</div>${pendingAggressiveAction ? `<div class="postflop-sizing"><div class="postflop-sizing-header"><span>${pendingAggressiveAction} sizing</span><button type="button" class="postflop-sizing-close" data-close-sizing aria-label="Cancel sizing">×</button></div><div class="postflop-size-grid">${sizes}</div><label>Custom total (bb)<input id="postflopCustomSize" type="number" min="0" step="0.1"></label></div>` : ""}`;
    }

    function render() {
      container.classList.toggle("is-active", Boolean(state)); container.classList.toggle("is-hidden", !state);
      renderNavigator(); renderBoard(); renderSeats(); renderTimeline(); focusTimelineOnCurrentStreet(); renderNextAction();
      el.pot.textContent = state ? `${model.formatPostflopBb(state.potUnits)} bb` : "0 bb";
      el.analyze.hidden = !state || !state.currentActor || state.currentActor !== state.heroPosition;
      el.advance.disabled = !state || !state.streetComplete;
      el.advance.textContent = state && state.street === "river" ? "View Results" : `Continue to ${state ? ({ flop: "Turn", turn: "River" }[state.street] || "Next Street") : "Next Street"}`;
    }

    function renderPicker() {
      const unavailable = new Set(model.usedCards(state));
      const required = state.street === "flop" ? 3 : 1;
      el.picker.innerHTML = SUITS.map((suit) => `<div class="card-suit-row" data-suit="${suit.code}">${RANKS.map((rank) => {
        const card = `${rank}${suit.code}`; const selected = draftCards.includes(card);
        const red = suit.code === "h" || suit.code === "d";
        return `<button type="button" class="picker-card suit-${suit.code}${red ? " is-red" : ""}${selected ? " is-selected" : ""}" data-card="${card}" aria-label="${cardAriaLabel(card)}" aria-pressed="${selected}" ${unavailable.has(card) && !selected ? "disabled" : ""}><b>${rank === "T" ? "10" : rank}</b><i>${suit.symbol}</i></button>`;
      }).join("")}</div>`).join("");
      el.selected.innerHTML = draftCards.map(cardMarkup).join("");
      el.help.textContent = `Select exactly ${required === 3 ? "three" : "one"} ${state.street} card${required === 3 ? "s" : ""}.`;
      el.confirm.disabled = draftCards.length !== required;
    }

    function openPicker() {
      if (!state || state.street === "results") return;
      draftCards = state.street === "flop" ? [...state.board.flop] : [state.board[state.street]].filter(Boolean);
      renderPicker(); el.dialog.showModal();
    }
    function commitAction(type, target) {
      state = model.applyAction(state, { actor: state.currentActor, type, targetStreetContributionUnits: Number(target) });
      pendingAggressiveAction = null; panelMessage = ""; notify(); render();
    }

    el.board.addEventListener("click", (event) => {
      const slot = event.target.closest(".board-card-slot:not([disabled])");
      if (slot) { pickerOpener = slot; openPicker(); }
    });
    el.picker.addEventListener("click", (event) => {
      const button = event.target.closest("[data-card]"); if (!button) return;
      const required = state.street === "flop" ? 3 : 1;
      draftCards = draftCards.includes(button.dataset.card) ? draftCards.filter((card) => card !== button.dataset.card) : [...draftCards, button.dataset.card].slice(-required);
      renderPicker();
    });
    el.clear.addEventListener("click", () => { draftCards = []; renderPicker(); });
    el.confirm.addEventListener("click", (event) => {
      event.preventDefault(); state = model.setBoardCards(state, state.street, draftCards); el.dialog.close();
      pendingAggressiveAction = null; panelMessage = ""; notify(); render();
    });
    el.dialog.addEventListener("close", () => pickerOpener?.focus());
    el.next.addEventListener("click", (event) => {
      if (event.target.closest("[data-close-sizing]")) { pendingAggressiveAction = null; renderNextAction(); return; }
      const size = event.target.closest("[data-postflop-size]"); if (size) return commitAction(pendingAggressiveAction, size.dataset.postflopSize);
      const action = event.target.closest("[data-postflop-action]"); if (!action) return;
      const type = action.dataset.postflopAction;
      if (type === "bet" || type === "raise") { event.stopPropagation(); pendingAggressiveAction = type; renderNextAction(); return; }
      commitAction(type, action.dataset.target || state.players[state.currentActor].streetContributionUnits);
    });
    el.next.addEventListener("change", (event) => {
      if (event.target.id === "postflopCustomSize" && pendingAggressiveAction) commitAction(pendingAggressiveAction, model.toPostflopUnits(event.target.value));
    });
    document.addEventListener("click", (event) => {
      if (!pendingAggressiveAction || el.next.contains(event.target)) return;
      pendingAggressiveAction = null;
      renderNextAction();
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && pendingAggressiveAction) { pendingAggressiveAction = null; renderNextAction(); }
    });
    el.advance.addEventListener("click", () => { state = model.advanceStreet(state); pendingAggressiveAction = null; notify(); render(); });
    el.analyze.addEventListener("click", () => { if (typeof options.onAnalyze === "function") options.onAnalyze(model.toLegacyAnalysisInput(state), state); });
    el.navigator.addEventListener("click", (event) => {
      const target = event.target.closest("[data-street-target]"); if (!target || target.disabled || !state) return;
      panelMessage = "Later cards, actions, and analysis were reset so you can edit this street.";
      state = model.rewindToStreet(state, target.dataset.streetTarget); notify(); render();
    });
    el.timeline.addEventListener("click", (event) => {
      const action = event.target.closest("[data-postflop-edit]"); if (!action || action.dataset.actionStreet === "preflop") return;
      panelMessage = "Edit this action, then rebuild the downstream decision path.";
      state = model.rewindToStreet(state, action.dataset.actionStreet); notify(); render();
    });

    const setState = (nextState) => { state = nextState; pendingAggressiveAction = null; render(); };
    const startFromPreflop = (preflopState) => { setState(model.createFromPreflop(preflopState)); notify(); return state; };
    const reset = () => { state = null; draftCards = []; pendingAggressiveAction = null; render(); };
    const editAction = (street, index, replacement) => { state = model.replaceAction(state, street, index, replacement); notify(); render(); return state; };
    render();
    return { getState: () => state, setState, startFromPreflop, reset, openPicker, editAction };
  }

  root.PokerCoachPostflopBuilderView = { createPostflopBuilderView, orderCards };
})(typeof window !== "undefined" ? window : globalThis);
