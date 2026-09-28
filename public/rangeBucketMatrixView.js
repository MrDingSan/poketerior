// Renders villain's range groups (strong value / thin value / draws / air, from the LLM interpretation)
// as a GTO-Wizard-style 13x13 matrix, colored by bucket, with a hover-to-isolate legend.
(function attachRangeBucketMatrixView(root) {
  const RANKS = "AKQJT98765432".split("");
  const RANGE_NOTATION = root.PokerCoachRangeNotation || (typeof require === "function" ? require("./rangeNotation.js") : null);

  const BUCKET_COLORS = [
    { match: /strong/i, color: "#0f6e56" },
    { match: /thin|showdown/i, color: "#185fa5" },
    { match: /draw|semi.?bluff/i, color: "#534ab7" },
    { match: /air|bluff/i, color: "#5f5e5a" },
  ];
  const FALLBACK_COLORS = ["#0f6e56", "#185fa5", "#534ab7", "#5f5e5a", "#993c1d", "#994a35"];

  function colorForLabel(label, index) {
    const found = BUCKET_COLORS.find((entry) => entry.match.test(label || ""));
    return found ? found.color : FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  }

  function handLabel(row, column) {
    if (row === column) return `${RANKS[row]}${RANKS[column]}`;
    return row < column ? `${RANKS[row]}${RANKS[column]}s` : `${RANKS[column]}${RANKS[row]}o`;
  }

  // Assigns each of the 169 hand classes to the first group whose rangeText contains it (groups are
  // checked in the order the LLM returned them: strong value first, air/bluffs last), so an overlap
  // like KTs appearing in both "thin value" and "draws" resolves to whichever bucket is more specific.
  function classifyGroups(groups) {
    const buckets = groups.map((group, index) => {
      const parsed = RANGE_NOTATION ? RANGE_NOTATION.parseRange(group.rangeText || "", []) : { classes: [] };
      return {
        label: group.label || `Group ${index + 1}`,
        reasoning: group.reasoning || "",
        color: colorForLabel(group.label, index),
        classes: new Set(parsed.classes || []),
      };
    });
    const assignment = new Map();
    for (const bucket of buckets) {
      for (const handClass of bucket.classes) {
        if (!assignment.has(handClass)) assignment.set(handClass, bucket);
      }
    }
    return { buckets, assignment };
  }

  function renderBucketMatrix(container, groups, options = {}) {
    if (!container) return null;
    const list = Array.isArray(groups) ? groups.filter((group) => group && group.rangeText) : [];
    if (!list.length) {
      container.innerHTML = `<p class="analysis-empty">${options.emptyMessage || "The LLM did not return weighted range groups."}</p>`;
      return null;
    }
    const { buckets, assignment } = classifyGroups(list);
    const cellsHtml = [];
    for (let row = 0; row < 13; row += 1) {
      for (let column = 0; column < 13; column += 1) {
        const label = handLabel(row, column);
        const bucket = assignment.get(label);
        if (bucket) {
          cellsHtml.push(
            `<div class="rbm-cell" data-bucket="${cssEscape(bucket.label)}" style="background:${bucket.color}" title="${label}: ${escapeHtml(bucket.label)}"><span>${label}</span></div>`,
          );
        } else {
          cellsHtml.push(`<div class="rbm-cell is-unassigned" title="${label}: not in range"><span>${label}</span></div>`);
        }
      }
    }
    const legendHtml = buckets
      .map(
        (bucket) => `
          <span class="rbm-legend-item" data-bucket="${cssEscape(bucket.label)}"${bucket.reasoning ? ` title="${cssEscape(bucket.reasoning)}"` : ""}>
            <i class="rbm-swatch" style="background:${bucket.color}"></i>${escapeHtml(bucket.label)}
          </span>`,
      )
      .join("");
    container.innerHTML = `
      <div class="rbm-grid" role="img" aria-label="${escapeHtml(options.label || "Villain range matrix by action bucket")}">${cellsHtml.join("")}</div>
      <div class="rbm-legend">${legendHtml}</div>
    `;
    const grid = container.querySelector(".rbm-grid");
    container.querySelectorAll(".rbm-legend-item").forEach((item) => {
      const key = item.getAttribute("data-bucket");
      item.addEventListener("mouseenter", () => {
        grid.querySelectorAll(".rbm-cell").forEach((cell) => {
          cell.classList.toggle("is-dimmed", cell.getAttribute("data-bucket") !== key);
        });
      });
      item.addEventListener("mouseleave", () => {
        grid.querySelectorAll(".rbm-cell").forEach((cell) => cell.classList.remove("is-dimmed"));
      });
    });
    return { buckets, assignment };
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }
  function cssEscape(value) {
    return escapeHtml(value).replace(/"/g, "&quot;");
  }

  const api = { renderBucketMatrix, handLabel, classifyGroups };
  root.PokerCoachRangeBucketMatrixView = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
