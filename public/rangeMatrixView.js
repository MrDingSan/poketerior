(function attachRangeMatrixView(root) {
  const RANKS = "AKQJT98765432".split("");
  const clamp = (value) => Math.max(0, Math.min(1, Number(value) || 0));

  function handLabel(row, column) {
    if (row === column) return `${RANKS[row]}${RANKS[column]}`;
    return row < column ? `${RANKS[row]}${RANKS[column]}s` : `${RANKS[column]}${RANKS[row]}o`;
  }

  function normalizeRangeData(input) {
    const available = Boolean(input && (input.weights || input.actionFrequencies));
    const weights = {};
    const actionFrequencies = {};
    const cells = [];
    for (let row = 0; row < 13; row += 1) {
      for (let column = 0; column < 13; column += 1) {
        const label = handLabel(row, column);
        weights[label] = clamp(input?.weights?.[label]);
        const frequency = input?.actionFrequencies?.[label] || {};
        actionFrequencies[label] = { aggressive: clamp(frequency.aggressive), call: clamp(frequency.call), fold: clamp(frequency.fold) };
        cells.push({ label, row, column, weight: weights[label], frequencies: actionFrequencies[label] });
      }
    }
    return { available, weights, actionFrequencies, cells, percentage: input?.percentage ?? null, comboCount: input?.comboCount ?? null };
  }

  function renderRangeMatrix(container, data, options = {}) {
    const normalized = normalizeRangeData(data);
    if (!normalized.available) { container.innerHTML = '<p class="analysis-empty">Run analysis to populate this panel.</p>'; return normalized; }
    container.innerHTML = normalized.cells.map((cell) => `<div class="range-cell${cell.weight ? " has-weight" : ""}" style="--range-weight:${cell.weight}" title="${cell.label}: ${Math.round(cell.weight * 100)}%"><span>${cell.label}</span></div>`).join("");
    container.setAttribute("aria-label", options.label || "Poker range matrix");
    return normalized;
  }

  const api = { RANKS, normalizeRangeData, renderRangeMatrix };
  root.PokerCoachRangeMatrixView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
