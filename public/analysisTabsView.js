(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PokerCoachAnalysisTabsView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  const STORAGE_KEY = "poketerior.analysisTab";

  function readStoredTab(storage) {
    try {
      return storage?.getItem(STORAGE_KEY) || null;
    } catch {
      return null;
    }
  }

  function writeStoredTab(storage, tab) {
    try {
      storage?.setItem(STORAGE_KEY, tab);
    } catch {
      // Remembering the tab is a convenience only.
    }
  }

  function createAnalysisTabs({ root: container, storage = root?.localStorage } = {}) {
    const tabs = Array.from(container.querySelectorAll("[data-analysis-tab]"));
    const panels = Array.from(container.querySelectorAll("[data-analysis-panel]"));
    const names = tabs.map((tab) => tab.dataset.analysisTab);
    let active = null;

    function select(name, { focus = false, remember = true } = {}) {
      if (!names.includes(name)) return;
      active = name;
      for (const tab of tabs) {
        const selected = tab.dataset.analysisTab === name;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        tab.classList.toggle("is-active", selected);
        if (selected && focus) tab.focus();
      }
      for (const panel of panels) panel.hidden = panel.dataset.analysisPanel !== name;
      if (remember) writeStoredTab(storage, name);
    }

    function setBusy(name, busy) {
      const tab = tabs.find((item) => item.dataset.analysisTab === name);
      if (tab) tab.classList.toggle("is-busy", Boolean(busy));
    }

    container.addEventListener("click", (event) => {
      const tab = event.target.closest?.("[data-analysis-tab]");
      if (tab && container.contains(tab)) select(tab.dataset.analysisTab);
    });

    container.addEventListener("keydown", (event) => {
      const tab = event.target.closest?.("[data-analysis-tab]");
      if (!tab) return;
      const index = names.indexOf(tab.dataset.analysisTab);
      const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (step) {
        event.preventDefault();
        select(names[(index + step + names.length) % names.length], { focus: true });
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        select(names[event.key === "Home" ? 0 : names.length - 1], { focus: true });
      }
    });

    const stored = readStoredTab(storage);
    select(names.includes(stored) ? stored : names[0], { remember: false });

    return { select, setBusy, get active() { return active; } };
  }

  return { createAnalysisTabs };
});
