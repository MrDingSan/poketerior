const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadBrowserModule(file, globalName) {
  const sandbox = { globalThis: {} };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../public", file), "utf8"), sandbox);
  return sandbox.globalThis[globalName];
}

const { createAnalysisTabs } = loadBrowserModule("analysisTabsView.js", "PokerCoachAnalysisTabsView");

function fakeElement(dataset) {
  const attributes = {};
  const classes = new Set();
  return {
    dataset,
    hidden: false,
    tabIndex: 0,
    setAttribute: (name, value) => { attributes[name] = value; },
    getAttribute: (name) => attributes[name],
    focus() { this.focused = true; },
    classList: {
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    closest() { return this; },
  };
}

function fakeRoot() {
  const names = ["ranges", "equity", "ai", "breakdown"];
  const tabs = names.map((name) => fakeElement({ analysisTab: name }));
  const panels = names.map((name) => fakeElement({ analysisPanel: name }));
  const listeners = {};
  return {
    tabs,
    panels,
    listeners,
    querySelectorAll: (selector) => (selector === "[data-analysis-tab]" ? tabs : panels),
    addEventListener: (type, handler) => { listeners[type] = handler; },
    contains: () => true,
  };
}

function memoryStorage(initial = {}) {
  const store = { ...initial };
  return { getItem: (key) => store[key] ?? null, setItem: (key, value) => { store[key] = value; }, store };
}

const root = fakeRoot();
const storage = memoryStorage();
const tabs = createAnalysisTabs({ root, storage });
assert.equal(tabs.active, "ranges", "defaults to the first tab");
assert.deepEqual(root.panels.map((panel) => panel.hidden), [false, true, true, true]);

root.listeners.click({ target: root.tabs[2] });
assert.equal(tabs.active, "ai");
assert.equal(root.tabs[2].getAttribute("aria-selected"), "true");
assert.equal(root.tabs[0].getAttribute("aria-selected"), "false");
assert.deepEqual(root.panels.map((panel) => panel.hidden), [true, true, false, true]);
assert.equal(storage.store["poketerior.analysisTab"], "ai", "remembers the chosen tab");

root.listeners.keydown({ target: root.tabs[2], key: "ArrowRight", preventDefault() {} });
assert.equal(tabs.active, "breakdown");
root.listeners.keydown({ target: root.tabs[3], key: "ArrowRight", preventDefault() {} });
assert.equal(tabs.active, "ranges", "arrow keys wrap around");

tabs.setBusy("ai", true);
assert.ok(root.tabs[2].classList.contains("is-busy"));
tabs.setBusy("ai", false);
assert.ok(!root.tabs[2].classList.contains("is-busy"));

const restored = createAnalysisTabs({ root: fakeRoot(), storage: memoryStorage({ "poketerior.analysisTab": "equity" }) });
assert.equal(restored.active, "equity", "restores the remembered tab");
const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
assert.equal(createAnalysisTabs({ root: fakeRoot(), storage: throwing }).active, "ranges", "blocked storage falls back safely");

console.log("analysis tabs view checks passed");
