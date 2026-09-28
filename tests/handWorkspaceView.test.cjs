const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const sandbox = { globalThis: {
  PokerCoachImportDecisionModel: { selectableDecisionKeys: () => [] },
} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("public/handWorkspaceView.js", "utf8"), sandbox);
const view = sandbox.globalThis.PokerCoachHandWorkspaceView;

const converted = {
  sourceHand: {
    heroName: "Hero",
    heroHand: ["Ah", "Kh"],
    players: [{ name: "Hero", position: "SB", stackBb: 91, isHero: true }, { name: "V", position: "UTG", stackBb: 91 }],
    board: { flop: ["Qh", "7s", "4h"], turn: null, river: null },
    streets: {
      preflop: { actions: [{ actor: "V", position: "UTG", action: "raise", amountBb: 2.5 }] },
      flop: { actions: [{ actor: "Hero", position: "SB", action: "check", amountBb: null }] },
      turn: { actions: [] }, river: { actions: [] },
    },
  },
  actionIndex: {
    "preflop:0": { street: "preflop", actor: "UTG", recordedAction: { actor: "V", action: "raise", amountBb: 2.5 } },
    "flop:0": { street: "flop", actor: "SB", recordedAction: { actor: "Hero", action: "check", amountBb: null } },
  },
  postflopState: { potUnits: 190, players: { SB: { stackUnits: 910 }, UTG: { stackUnits: 910 } } },
  warnings: [], unresolved: [],
};

function testRendersSharedBuilderStructureAndDecisionButtons() {
  const html = view.renderWorkspaceMarkup({ converted, selectedDecisionKey: "flop:0" });
  assert.match(html, /class="postflop-layout import-builder-layout hand-stage"/);
  assert.match(html, /class="street-navigator"/);
  assert.match(html, /class="poker-table import-builder-table"/);
  assert.match(html, /data-decision-key="preflop:0"/);
  assert.match(html, /data-decision-key="flop:0"[^>]+aria-pressed="true"/);
  assert.match(html, /Hero.*SB/s);
  assert.doesNotMatch(html, />V</, "imported table must not expose player names");
  assert.match(html, /aria-label="Ah"/);
  assert.match(html, /aria-label="Kh"/);
  assert.match(html, /board-card board-card--h is-red/, "heart cards must receive the red card class");
  assert.match(html, /data-analyze-imported="flop:0"/);
}

function testUnsafeAttributionKeepsReplayButtonsSelectable() {
  const html = view.renderWorkspaceMarkup({ converted, selectedDecisionKey: null });
  assert.match(html, /data-decision-key="preflop:0"[^>]*aria-pressed="false"(?![^>]* disabled)/);
  assert.match(html, /data-decision-key="flop:0"[^>]*aria-pressed="false"(?![^>]* disabled)/);
}

function testTimelineFlattensStreetsAndUsesPositionRoleLabels() {
  const html = view.renderWorkspaceMarkup({ converted, selectedDecisionKey: null });
  assert.match(html, /class="timeline-street-label" data-timeline-street="preflop">Preflop/);
  assert.match(html, /class="timeline-street-label" data-timeline-street="flop">Flop/);
  assert.match(html, /data-action-role="villain"[^>]*><strong data-action-description>Villain · raise 2.5 bb<\/strong><small>UTG<\/small>/);
  assert.match(html, /data-action-role="hero"[^>]*><strong data-action-description>Hero · check<\/strong><small>SB<\/small>/);
  assert.doesNotMatch(html, />V raise 2\.5 bb</, "timeline must not expose imported names");
  assert.doesNotMatch(html, /<section><h3>/, "streets must remain in one expanded horizontal rail");
}

function testSameVillainKeepsTheSameColorAcrossStreets() {
  const multiStreet = JSON.parse(JSON.stringify(converted));
  multiStreet.sourceHand.players.push({ name: "W", position: "BB", stackBb: 91 });
  multiStreet.sourceHand.streets = {
    preflop: { actions: [
      { actor: "V", position: "UTG", action: "raise", amountBb: 2.5 },
      { actor: "W", position: "BB", action: "call", amountBb: 1.5 },
      { actor: "Hero", position: "SB", action: "call", amountBb: 2 },
    ] },
    flop: { actions: [{ actor: "W", position: "BB", action: "check", amountBb: null }, { actor: "Hero", position: "SB", action: "bet", amountBb: 2 }] },
    turn: { actions: [{ actor: "W", position: "BB", action: "check", amountBb: null }] },
    river: { actions: [{ actor: "W", position: "BB", action: "check", amountBb: null }] },
  };
  multiStreet.actionIndex = {};
  const html = view.renderWorkspaceMarkup({ converted: multiStreet, selectedDecisionKey: null });
  const seatColors = {};
  for (const match of html.matchAll(/data-action-role="villain" data-villain="(\d+)"[^>]*><strong data-action-description>[^<]*<\/strong><small>(\w+)<\/small>/g)) {
    (seatColors[match[2]] ||= new Set()).add(match[1]);
  }
  assert.equal(seatColors.BB.size, 1, "BB keeps one color from preflop through the river");
  assert.equal(seatColors.UTG.size, 1);
  assert.notEqual([...seatColors.BB][0], [...seatColors.UTG][0], "different villains get different colors");
  assert.equal([...seatColors.UTG][0], "0", "colors are assigned in order of first action");
  assert.doesNotMatch(html.match(/data-action-role="hero"[^>]*>/)?.[0] || "", /data-villain/, "Hero is never given a villain color");
}

function testHistoricalStreetHidesFutureBoardCards() {
  const html = view.renderWorkspaceMarkup({ converted, selectedDecisionKey: "preflop:0" });
  assert.doesNotMatch(html, /aria-label="Qh"/, "preflop reconstruction must not reveal flop cards");
  assert.match(html, />Results</, "hand progress must include the results step");
}

function testSelectedDecisionOverridesStaleVisibleStreet() {
  const turnHand = JSON.parse(JSON.stringify(converted));
  turnHand.sourceHand.board.turn = "2d";
  turnHand.sourceHand.streets.turn.actions = [{ actor: "V", position: "UTG", action: "bet", amountBb: 6 }];
  turnHand.actionIndex["turn:0"] = { street: "turn", actor: "UTG", recordedAction: { actor: "V", action: "bet", amountBb: 6 } };
  const html = view.renderWorkspaceMarkup({ converted: turnHand, selectedDecisionKey: "turn:0", visibleStreet: "preflop" });
  assert.match(html, /aria-label="2d"/, "a selected Turn decision must show its turn card despite stale navigation");
  assert.match(html, /data-import-street="turn" aria-current="step"/, "the selected decision must activate Turn navigation");
}

function testExplicitAnalyzeDelegatesSelectedDecision() {
  const analyzed = [];
  const root = {
    innerHTML: "", listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    removeEventListener() {},
  };
  const workspace = view.createHandWorkspaceView({
    root,
    onAnalyzeDecision: (key) => analyzed.push(key),
  });
  workspace.setSession({ converted, selectedDecisionKey: "flop:0" });
  root.listeners.click({
    target: {
      closest(selector) {
        return selector === "[data-analyze-imported]" ? { dataset: { analyzeImported: "flop:0" } } : null;
      },
    },
  });
  assert.deepEqual(analyzed, ["flop:0"]);
}

function testSelectingPostflopActionKeepsTheWorkspaceOnThatStreet() {
  const selected = [];
  const root = {
    innerHTML: "",
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    removeEventListener() {},
  };
  const workspace = view.createHandWorkspaceView({ root, onSelectDecision: (key) => selected.push(key) });
  workspace.setSession({ converted, selectedDecisionKey: "preflop:0", visibleStreet: "preflop" });
  root.listeners.click({
    target: {
      closest(selector) {
        return selector === "[data-decision-key]" ? { dataset: { decisionKey: "flop:0", actionStreet: "flop" } } : null;
      },
    },
  });
  assert.deepEqual(selected, ["flop:0"]);
  assert.equal(workspace.getSelectedDecisionKey(), "flop:0");
  assert.equal(workspace.getVisibleStreet(), "flop");
  assert.match(root.innerHTML, /data-import-street="flop" aria-current="step"/);
  assert.match(root.innerHTML, /aria-label="Qh"/, "the selected postflop street must keep its board visible");
}

function testSelectedDecisionOffersCorrectionAndDelegatesSubmit() {
  const edits = [];
  const root = {
    innerHTML: "", listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    removeEventListener() {},
  };
  const workspace = view.createHandWorkspaceView({ root, onEditAction: (key, edit) => edits.push({ key, edit }) });
  workspace.setSession({ converted, selectedDecisionKey: "preflop:0" });
  assert.match(root.innerHTML, /data-import-edit-form="preflop:0"/);
  const form = {
    dataset: { importEditForm: "preflop:0" },
    elements: { action: { value: "raise" }, amountBb: { value: "3" } },
  };
  root.listeners.submit({ target: form, preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(edits)), [{ key: "preflop:0", edit: { action: "raise", amountBb: 3 } }]);
}

function testClickingTimelineStreetLabelNavigatesToThatStreet() {
  const streetsChanged = [];
  const root = {
    innerHTML: "",
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    removeEventListener() {},
  };
  const workspace = view.createHandWorkspaceView({ root, onStreetChange: (street) => streetsChanged.push(street) });
  workspace.setSession({ converted, selectedDecisionKey: null, visibleStreet: "preflop" });
  root.listeners.click({
    target: {
      closest(selector) {
        return selector === "[data-timeline-street]" ? { dataset: { timelineStreet: "flop" } } : null;
      },
    },
  });
  assert.deepEqual(streetsChanged, ["flop"]);
  assert.equal(workspace.getVisibleStreet(), "flop");
  assert.match(root.innerHTML, /data-import-street="flop" aria-current="step"/);
}

testRendersSharedBuilderStructureAndDecisionButtons();
testUnsafeAttributionKeepsReplayButtonsSelectable();
testTimelineFlattensStreetsAndUsesPositionRoleLabels();
testSameVillainKeepsTheSameColorAcrossStreets();
testHistoricalStreetHidesFutureBoardCards();
testSelectedDecisionOverridesStaleVisibleStreet();
testSelectingPostflopActionKeepsTheWorkspaceOnThatStreet();
testSelectedDecisionOffersCorrectionAndDelegatesSubmit();
testExplicitAnalyzeDelegatesSelectedDecision();
testClickingTimelineStreetLabelNavigatesToThatStreet();

(function testUnresolvedReplayExplainsWhyLaterActionsAreLocked() {
  const blocked = { ...converted, unresolved: [{ key: "preflop:0", street: "preflop", index: 0, message: "The pre-flop betting round is complete." }] };
  const html = view.renderWorkspaceMarkup({ converted: blocked, selectedDecisionKey: null });
  assert.match(html, /Replay stopped at preflop · action 0: The pre-flop betting round is complete\./);
})();

(function testRerenderKeepsTimelineScrollPosition() {
  let timeline = { scrollLeft: 0 };
  const root = {
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    removeEventListener() {},
    querySelector(selector) { return selector === ".import-timeline-streets" ? timeline : null; },
    set innerHTML(_html) { timeline = { scrollLeft: 0 }; },
    get innerHTML() { return ""; },
  };
  const workspace = view.createHandWorkspaceView({ root });
  workspace.setSession({ converted, selectedDecisionKey: null });
  timeline.scrollLeft = 640;
  root.listeners.click({
    target: {
      closest(selector) {
        return selector === "[data-decision-key]" ? { dataset: { decisionKey: "flop:0", actionStreet: "flop" } } : null;
      },
    },
  });
  assert.equal(timeline.scrollLeft, 640, "selecting a decision must not reset the timeline scroll");
  root.listeners.click({
    target: {
      closest(selector) {
        return selector === "[data-timeline-street]" ? { dataset: { timelineStreet: "preflop" } } : null;
      },
    },
  });
  assert.equal(timeline.scrollLeft, 640, "clicking a street label must not reset the timeline scroll");
})();
