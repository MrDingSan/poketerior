(function attachPostflopAnalysisView(root) {
  const TABS = ["Ranges", "Equity", "AI Analysis", "Breakdown"];

  function createPostflopAnalysisView(options) {
    const container = options.root;
    const rangeMatrix = options.rangeMatrixView || root.PokerCoachRangeMatrixView;
    let data = null;
    let activeTab = "Ranges";

    function renderRanges(panel) {
      if (!data) {
        panel.innerHTML = '<div class="postflop-analysis-empty"><strong>Ready when you are</strong><span>Complete the board and action path, then choose Analyze Street to populate ranges, board texture, and range evolution.</span></div>';
        return;
      }
      panel.innerHTML = '<div class="postflop-range-layout"><section><h3>Estimated Range</h3><div class="range-matrix"></div></section><section><h3>Board Texture</h3><div class="board-texture"></div></section><section><h3>Range Evolution</h3><div class="range-evolution"></div></section></div>';
      rangeMatrix.renderRangeMatrix(panel.querySelector(".range-matrix"), data?.villainRange, { label: "Estimated opponent range" });
      panel.querySelector(".board-texture").textContent = data?.boardTexture || "Run analysis to populate this panel.";
      panel.querySelector(".range-evolution").textContent = data?.rangeHistory?.length ? data.rangeHistory.map((item) => item.label || item.street).join(" → ") : "Run analysis to populate this panel.";
    }

    function renderPanel(panel) {
      if (activeTab === "Ranges") return renderRanges(panel);
      if (activeTab === "Equity" && data?.equity) {
        const hero = Number(data.equity.hero || 0); const villain = Number(data.equity.villain ?? 100 - hero);
        panel.innerHTML = `<div class="equity-summary"><h3>Hand Equity</h3><div><span>Hero</span><strong>${hero}%</strong><i style="width:${hero}%"></i></div><div><span>Opponent range</span><strong>${villain}%</strong><i style="width:${villain}%"></i></div></div>`;
        return;
      }
      const content = activeTab === "AI Analysis" ? data?.aiAnalysis : data?.breakdown;
      panel.innerHTML = content ? `<div class="analysis-copy">${typeof content === "string" ? content : JSON.stringify(content)}</div>` : '<div class="postflop-analysis-empty"><strong>Analysis pending</strong><span>Choose Analyze Street after completing the current decision.</span></div>';
    }

    function render() {
      container.innerHTML = `<div class="postflop-analysis-tabs" role="tablist">${TABS.map((tab) => `<button type="button" role="tab" data-analysis-tab="${tab}" aria-selected="${tab === activeTab}">${tab}</button>`).join("")}</div><div class="postflop-analysis-panel" role="tabpanel"></div>`;
      renderPanel(container.querySelector(".postflop-analysis-panel"));
    }
    container.addEventListener("click", (event) => { const tab = event.target.closest("[data-analysis-tab]"); if (tab) { activeTab = tab.dataset.analysisTab; render(); } });
    const setData = (nextData) => { data = nextData; render(); };
    render();
    return { setData, getData: () => data, render };
  }
  root.PokerCoachPostflopAnalysisView = { createPostflopAnalysisView };
})(typeof window !== "undefined" ? window : globalThis);
