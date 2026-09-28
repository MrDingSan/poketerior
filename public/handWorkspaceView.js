(function attachHandWorkspaceView(root) {
  const STREETS = ["preflop", "flop", "turn", "river"];
  const SUITS = { s: "♠", h: "♥", d: "♦", c: "♣" };

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function cardMarkup(card) {
    if (!card) return '<span class="board-card-slot is-future" aria-hidden="true"></span>';
    const rank = card[0] === "T" ? "10" : card[0];
    const suit = card[1];
    const red = suit === "h" || suit === "d";
    return `<span class="board-card board-card--${escapeHtml(suit)}${red ? " is-red" : ""}" aria-label="${escapeHtml(card)}"><b>${rank}</b><i>${SUITS[suit] || suit}</i></span>`;
  }

  function actionLabel(source, action) {
    const amount = action.amountBb == null ? "" : ` ${action.amountBb} bb`;
    const player = (source.players || []).find((candidate) => candidate.name === action.actor)
      || (source.players || []).find((candidate) => candidate.position === action.position);
    const position = action.position || player?.position || "Unknown";
    const role = player?.isHero || action.actor === source.heroName ? "Hero" : "Villain";
    return { position, role, text: `${action.action}${amount}` };
  }

  function renderStreetNavigation(source, selectedStreet) {
    const streetButtons = STREETS.map((street) => {
      const available = (source.streets?.[street]?.actions || []).length || (street !== "preflop" && (street === "flop" ? source.board?.flop?.length : source.board?.[street]));
      return `<button type="button" data-import-street="${street}"${street === selectedStreet ? ' aria-current="step"' : ""}${available ? "" : " disabled"}><span></span><strong>${street[0].toUpperCase() + street.slice(1)}</strong></button>`;
    }).join("");
    return `<nav class="street-navigator" aria-label="Imported hand streets">${streetButtons}<button type="button" disabled><span></span><strong>Results</strong></button></nav>`;
  }

  function renderTable(converted, selectedStreet) {
    const source = converted.sourceHand;
    const streetIndex = STREETS.indexOf(selectedStreet);
    const board = [
      ...(streetIndex >= 1 ? source.board?.flop || [] : []),
      streetIndex >= 2 ? source.board?.turn : null,
      streetIndex >= 3 ? source.board?.river : null,
    ].filter(Boolean);
    // Show the board/stacks as they stood at the selected street rather than the
    // hand's final state, so navigating the decision path actually moves the table.
    const streetState = selectedStreet === "preflop" ? null : converted.postflopStateByStreet?.[selectedStreet];
    const statePlayers = streetState?.players || {};
    const potBb = converted.streetPotsBb?.[selectedStreet]
      ?? (converted.postflopState ? converted.postflopState.potUnits / 10 : converted.preflopState.potUnits / 2);
    const TABLE_SLOTS = ["utg", "hj", "co", "btn", "sb", "bb"];
    const players = source.players || [];
    const resolvedSlots = new Set(
      players
        .map((player) => String(player.position || "").toLowerCase().replace("mp", "hj"))
        .filter((slot) => TABLE_SLOTS.includes(slot)),
    );
    const openSlots = TABLE_SLOTS.filter((slot) => !resolvedSlots.has(slot));
    let nextOpenSlotIndex = 0;
    return `<section class="poker-table import-builder-table" aria-label="Imported poker table">
      <div class="postflop-pot">Pot <strong>${potBb} bb</strong></div>
      <div class="board-card-slots">${[0, 1, 2, 3, 4].map((index) => cardMarkup(board[index])).join("")}</div>
      <div class="postflop-seats">${players.map((player) => {
        let position = String(player.position || "").toLowerCase().replace("mp", "hj");
        if (!TABLE_SLOTS.includes(position)) {
          // The imported hand couldn't resolve this player's seat (e.g. OCR
          // missed it); assign whichever canonical slot is still free so the
          // seat renders at a real position instead of colliding with another.
          position = openSlots[nextOpenSlotIndex] || "btn";
          nextOpenSlotIndex += 1;
        }
        const modeled = statePlayers[String(player.position || "").toUpperCase().replace("MP", "HJ")];
        const stack = modeled ? modeled.stackUnits / 10 : player.stackBb;
        const holeCards = player.isHero
          ? `<span class="import-seat-cards">${(source.heroHand || []).map(cardMarkup).join("")}</span>`
          : '<span class="import-seat-cards"><span class="mini-card card-back" aria-hidden="true"></span><span class="mini-card card-back" aria-hidden="true"></span></span>';
        const role = player.isHero ? "Hero" : "Villain";
        return `<div class="postflop-seat postflop-seat--${escapeHtml(position)}${player.isHero ? " is-hero" : ""}">${holeCards}<strong>${role}</strong><small>${escapeHtml(player.position || "Unknown")}</small><span>${stack == null ? "Stack unknown" : `${stack} bb`}</span></div>`;
      }).join("")}</div>
    </section>`;
  }

  function renderTimeline(converted, selectedDecisionKey) {
    const actions = STREETS.flatMap((street) => (converted.sourceHand.streets?.[street]?.actions || [])
      .map((action, index) => ({ street, index, action })));
    let previousStreet = null;
    // Each villain keeps one color for the whole hand: index them by first appearance, keyed by seat.
    const villainSeats = [];
    // Decisions that depend on an unresolved replay entry wait for its correction; earlier ones stay selectable.
    const blocked = root.PokerCoachImportProgressView?.blockedDecisionKeys(converted) || new Set();
    return `<section class="panel postflop-timeline-panel import-builder-timeline" aria-label="Imported decision path">
      <div class="section-title"><span>Decision path</span><strong>Complete Hand Timeline</strong></div>
      <div class="import-timeline-streets">${actions.map(({ street, index, action }) => {
        const key = `${street}:${index}`;
        const enabled = Boolean(converted.actionIndex?.[key]) && !blocked.has(key);
        const label = actionLabel(converted.sourceHand, action);
        let villainAttr = "";
        if (label.role === "Villain") {
          if (!villainSeats.includes(label.position)) villainSeats.push(label.position);
          villainAttr = ` data-villain="${villainSeats.indexOf(label.position)}"`;
        }
        const marker = street === previousStreet ? "" : `<button type="button" class="timeline-street-label" data-timeline-street="${street}">${street === "preflop" ? "Preflop" : street[0].toUpperCase() + street.slice(1)}</button>`;
        previousStreet = street;
        return `${marker}<button class="timeline-action street-action import-timeline-action action-role-${label.role.toLowerCase()}${key === selectedDecisionKey ? " is-selected" : ""}" type="button" data-decision-key="${key}" data-action-street="${street}" data-action-role="${label.role.toLowerCase()}"${villainAttr} aria-pressed="${key === selectedDecisionKey}"${enabled ? "" : " disabled"}><strong data-action-description>${label.role} · ${escapeHtml(label.text)}</strong><small>${escapeHtml(label.position)}</small></button>`;
      }).join("")}</div>
    </section>`;
  }

  function renderWorkspaceMarkup({ converted, selectedDecisionKey = null, visibleStreet = null }) {
    if (!converted) return '<div class="import-builder-empty"><strong>Import a screenshot to build the complete hand.</strong><p>The table, board, streets, and decision path will appear here.</p></div>';
    const selectedStreet = selectedDecisionKey?.split(":")[0] || visibleStreet || (converted.postflopState?.street === "results" ? "river" : converted.postflopState?.street) || "preflop";
    const selectedEntry = selectedDecisionKey ? converted.actionIndex?.[selectedDecisionKey] : null;
    const selectedAction = selectedEntry?.recordedAction;
    const canAnalyzeSelected = selectedDecisionKey && (root.PokerCoachImportDecisionModel?.selectableDecisionKeys(converted) || Object.keys(converted.actionIndex || {})).includes(selectedDecisionKey);
    const editForm = selectedAction ? `<form class="import-action-editor" data-import-edit-form="${escapeHtml(selectedDecisionKey)}">
      <label><span>Recorded action</span><select name="action">${["check", "bet", "call", "raise", "fold", "allin"].map((type) => `<option value="${type}"${type === selectedAction.action ? " selected" : ""}>${type}</option>`).join("")}</select></label>
      <label><span>Amount (bb)</span><input name="amountBb" type="number" min="0" step="0.1" value="${selectedAction.amountBb == null ? "" : escapeHtml(selectedAction.amountBb)}" /></label>
      <p class="import-edit-warning">Applying a correction removes incompatible later actions and streets.</p>
      <button class="secondary-btn" type="submit">Apply correction</button>
    </form>` : "";
    const firstUnresolved = converted.unresolved?.[0];
    const unresolvedNotice = firstUnresolved
      ? `<p class="import-edit-warning" role="alert">Replay stopped at ${escapeHtml(String(firstUnresolved.key).replace(":", " · action "))}: ${escapeHtml(firstUnresolved.message)} Later actions stay locked until this action is corrected.</p>`
      : "";
    return `<div class="postflop-layout import-builder-layout hand-stage">
      ${renderStreetNavigation(converted.sourceHand, selectedStreet)}
      <div class="postflop-main"><div class="postflop-table-workspace">${renderTable(converted, selectedStreet)}${renderTimeline(converted, selectedDecisionKey)}</div>
      <aside class="postflop-rail"><section class="panel import-decision-panel" aria-live="polite"><span class="section-kicker">Your Decision</span><h2>${selectedDecisionKey ? escapeHtml(selectedDecisionKey.replace(":", " · action ")) : "Choose a timeline decision"}</h2><p>${selectedDecisionKey && !canAnalyzeSelected ? "Replay is ready. Correct the recorded action to enable analysis." : "Review the reconstructed state, then launch the same street analysis used by Manual Builder."}</p>${unresolvedNotice}${editForm}</section>${selectedDecisionKey ? `<button class="primary-btn analyze-street-btn" type="button" data-analyze-imported="${escapeHtml(selectedDecisionKey)}"${canAnalyzeSelected ? "" : " disabled"}>Analyze Street →</button>` : ""}</aside></div>
    </div>`;
  }

  function createHandWorkspaceView({ root: workspaceRoot, onSelectDecision, onAnalyzeDecision, onEditAction, onStreetChange }) {
    if (!workspaceRoot) throw new Error("A hand workspace root is required.");
    let viewModel = { converted: null, selectedDecisionKey: null };
    // Re-rendering replaces the timeline element, so carry its horizontal scroll over.
    const render = () => {
      const previous = workspaceRoot.querySelector?.(".import-timeline-streets");
      const scrollLeft = previous ? previous.scrollLeft : 0;
      workspaceRoot.innerHTML = renderWorkspaceMarkup(viewModel);
      const next = workspaceRoot.querySelector?.(".import-timeline-streets");
      if (next && scrollLeft) next.scrollLeft = scrollLeft;
    };
    const onClick = (event) => {
      const button = event.target.closest?.("[data-decision-key]");
      if (button && !button.disabled) {
        viewModel = {
          ...viewModel,
          selectedDecisionKey: button.dataset.decisionKey,
          visibleStreet: button.dataset.actionStreet,
        };
        render();
        onSelectDecision?.(button.dataset.decisionKey);
      }
      const analyzeButton = event.target.closest?.("[data-analyze-imported]");
      if (analyzeButton && !analyzeButton.disabled) onAnalyzeDecision?.(analyzeButton.dataset.analyzeImported, analyzeButton);
      const streetButton = event.target.closest?.("[data-import-street]");
      if (streetButton && !streetButton.disabled) {
        viewModel = { ...viewModel, visibleStreet: streetButton.dataset.importStreet };
        render();
        onStreetChange?.(streetButton.dataset.importStreet);
      }
      const timelineStreetButton = event.target.closest?.("[data-timeline-street]");
      if (timelineStreetButton && !timelineStreetButton.disabled) {
        viewModel = { ...viewModel, visibleStreet: timelineStreetButton.dataset.timelineStreet };
        render();
        onStreetChange?.(timelineStreetButton.dataset.timelineStreet);
      }
    };
    const onSubmit = (event) => {
      const form = event.target;
      if (!form?.dataset?.importEditForm) return;
      event.preventDefault();
      const rawAmount = form.elements.amountBb.value;
      onEditAction?.(form.dataset.importEditForm, {
        action: form.elements.action.value,
        amountBb: rawAmount === "" ? null : Number(rawAmount),
      });
    };
    workspaceRoot.addEventListener("click", onClick);
    workspaceRoot.addEventListener("submit", onSubmit);
    return {
      setSession(next) {
        viewModel = { ...viewModel, ...next };
        render();
      },
      getSelectedDecisionKey: () => viewModel.selectedDecisionKey,
      getVisibleStreet: () => viewModel.visibleStreet,
      destroy: () => {
        workspaceRoot.removeEventListener("click", onClick);
        workspaceRoot.removeEventListener("submit", onSubmit);
      },
    };
  }

  root.PokerCoachHandWorkspaceView = { createHandWorkspaceView, renderWorkspaceMarkup, cardMarkup };
})(typeof window !== "undefined" ? window : globalThis);
