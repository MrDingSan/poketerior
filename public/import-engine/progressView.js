(function attachImportProgressView(root) {
  const STREETS = ["preflop", "flop", "turn", "river"];
  const STREET_LABEL = { preflop: "Preflop", flop: "Flop", turn: "Turn", river: "River" };
  const STATUS_TEXT = { pending: "Pending", running: "In progress", complete: "Complete", warning: "Needs review", error: "Failed" };
  // Icons are decorative; the status word is always written out so state is never colour- or glyph-only.
  const STATUS_ICON = { pending: "○", running: "…", complete: "✓", warning: "!", error: "✕" };
  const CARD_CONTROLS = { hero: "importHeroHandEdit", flop: "importFlopEdit", turn: "importTurnEdit", river: "importRiverEdit" };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
  }

  const ACTION_REF = /^actions\.(preflop|flop|turn|river)\.(\d+)(?:\.(\w+))?$/;
  const STREET_REF = /^actions\.(preflop|flop|turn|river)$/;

  function fieldLabel(ref) {
    const text = String(ref || "");
    if (text === "hero.cards") return "Hero cards";
    const board = text.match(/^board\.(flop|turn|river)$/);
    if (board) return `${STREET_LABEL[board[1]]} ${board[1] === "flop" ? "cards" : "card"}`;
    const action = text.match(ACTION_REF);
    if (action) {
      const suffix = action[3] ? ` · ${action[3] === "amountBb" ? "amount" : action[3]}` : "";
      return `${STREET_LABEL[action[1]]} action ${Number(action[2]) + 1}${suffix}`;
    }
    const street = text.match(STREET_REF);
    if (street) return `${STREET_LABEL[street[1]]} action`;
    const pot = text.match(/^streetPots\.(preflop|flop|turn|river)$/);
    return pot ? `${STREET_LABEL[pot[1]]} pot` : text;
  }

  // Maps a canonical field reference onto the correction control the import UI already has.
  function resolveFieldRef(ref) {
    const text = String(ref || "");
    if (text === "hero.cards") return { kind: "cards", field: "hero", inputId: CARD_CONTROLS.hero };
    const board = text.match(/^board\.(flop|turn|river)$/);
    if (board) return { kind: "cards", field: board[1], inputId: CARD_CONTROLS[board[1]] };
    const action = text.match(ACTION_REF);
    if (action) return { kind: "action", decisionKey: `${action[1]}:${action[2]}`, street: action[1], index: Number(action[2]), control: action[3] || "action" };
    const street = text.match(STREET_REF);
    if (street) return { kind: "action", decisionKey: `${street[1]}:0`, street: street[1], index: 0, control: "action" };
    return null;
  }

  function liveText(snapshot, change) {
    const stage = change && snapshot.byId[change.stage];
    if (!stage) {
      const complete = snapshot.stages.filter((entry) => entry.status === "complete").length;
      return `${complete} of ${snapshot.stages.length} import steps complete.`;
    }
    const fields = stage.fieldRefs.length ? ` Check: ${stage.fieldRefs.map(fieldLabel).join(", ")}.` : "";
    return `${stage.label}: ${STATUS_TEXT[stage.status].toLowerCase()}. ${stage.message}${fields}`;
  }

  function renderProgressMarkup(snapshot, change) {
    const rows = snapshot.stages.map((stage) => `<li class="import-stage is-${stage.status}" data-stage="${stage.id}" data-status="${stage.status}"><span class="stage-icon" aria-hidden="true">${STATUS_ICON[stage.status]}</span><span class="stage-label">${escapeHtml(stage.label)}</span><span class="stage-status">${STATUS_TEXT[stage.status]}</span><span class="stage-message">${escapeHtml(stage.message)}</span></li>`).join("");
    const seen = new Set();
    const warnings = [];
    const refs = [];
    for (const stage of snapshot.stages) {
      if (stage.status === "warning" || stage.status === "error") refs.push(...stage.fieldRefs);
    }
    // One control per action: "actions.river.1" is redundant next to "actions.river.1.amountBb".
    const specific = new Set(refs.filter((ref) => /^actions\.\w+\.\d+\./.test(ref)).map((ref) => ref.split(".").slice(0, 3).join(".")));
    for (const ref of refs) {
      if (seen.has(ref) || specific.has(ref)) continue;
      seen.add(ref);
      const label = escapeHtml(fieldLabel(ref));
      warnings.push(resolveFieldRef(ref)
        ? `<li><button type="button" class="import-field-warning" data-import-field-ref="${escapeHtml(ref)}">${label} needs review</button></li>`
        : `<li><span class="import-field-warning">${label} needs review</span></li>`);
    }
    const total = snapshot.stages.length;
    const done = snapshot.stages.filter((stage) => stage.status === "complete").length;
    const percent = total ? Math.round((done / total) * 100) : 0;
    const busy = snapshot.stages.some((stage) => stage.status === "running");
    const head = `<div class="import-progress-head"><span>${busy || done < total ? "Reading your hand" : "Hand read"}</span><span>${done} of ${total} steps complete</span></div><div class="import-progress-bar" role="progressbar" aria-label="Import progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}"><span style="width:${percent}%"></span></div>`;
    const check = warnings.length
      ? `<div class="import-check"><div class="import-check-head"><strong>${warnings.length} ${warnings.length === 1 ? "field needs" : "fields need"} a quick check</strong><span>We weren't sure about ${warnings.length === 1 ? "this one" : "these"}. Tap one to fix it.</span></div><ul class="import-field-warnings" aria-label="Fields to review">${warnings.join("")}</ul></div>`
      : "";
    return `<section class="import-stage-panel" aria-label="Screenshot import progress">${head}<details class="import-stage-details"${busy ? " open" : ""}><summary>Import steps</summary><ol class="import-stage-list">${rows}</ol></details>${check}<div class="import-stage-live" role="status" aria-live="polite">${escapeHtml(liveText(snapshot, change))}</div></section>`;
  }

  // Decisions that depend on the first unresolved replay entry. The unresolved action itself stays selectable
  // (the state before it is known, and it is what the user must correct); a board problem blocks its whole street.
  function blockedDecisionKeys(converted) {
    const first = converted?.unresolved?.[0];
    if (!first) return new Set();
    const order = [];
    for (const street of STREETS) (converted.sourceHand?.streets?.[street]?.actions || []).forEach((action, index) => order.push(`${street}:${index}`));
    const [scope, index] = String(first.key).split(":");
    const start = scope === "board" ? order.findIndex((key) => key.startsWith(`${index}:`)) : order.indexOf(first.key) + 1;
    return new Set(start < 0 || (scope !== "board" && start === 0) ? [] : order.slice(start));
  }

  const api = Object.freeze({ fieldLabel, resolveFieldRef, renderProgressMarkup, blockedDecisionKeys });
  root.PokerCoachImportProgressView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
