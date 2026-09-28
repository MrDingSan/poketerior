const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { setInterval, clearInterval };
sandbox.globalThis = sandbox;
sandbox.window = sandbox; // like a browser, window is the global object
vm.createContext(sandbox);
for (const file of [
  "importProgressModel.js",
  "preflopBuilderModel.js",
  "postflopBuilderModel.js",
  "importBuilderAdapter.js",
  "import-engine/progressView.js",
  "importDecisionModel.js",
  "handWorkspaceView.js",
]) vm.runInContext(fs.readFileSync(path.join(__dirname, "../public", file), "utf8"), sandbox, { filename: file });
const view = sandbox.PokerCoachImportProgressView;
const progressModel = sandbox.PokeTeriorImportProgress;
const adapter = sandbox.PokerCoachImportBuilderAdapter;
const workspace = sandbox.PokerCoachHandWorkspaceView;
assert.ok(view, "PokerCoachImportProgressView must be attached");

function snapshotWith(mutate) {
  const progress = progressModel.createStageProgress({});
  mutate(progress);
  return progress.snapshot();
}

function partialSnapshot() {
  return snapshotWith((progress) => {
    progress.start("site"); progress.complete("site", { message: "Natural8 layout classic-tall-v1 detected." });
    progress.start("heroCards"); progress.complete("heroCards", { message: "Hero cards recognized." });
    progress.start("board"); progress.complete("board");
    progress.start("preflop"); progress.complete("preflop");
    progress.start("flop"); progress.warn("flop", { message: "Bet amount is uncertain.", fieldRefs: ["actions.flop.1.amountBb"] });
    // turn / river / validation / reconstruction / decisions remain pending
  });
}

function testProgressListShowsEveryStageWithTextNotJustColour() {
  const html = view.renderProgressMarkup(partialSnapshot());
  for (const stage of ["site", "heroCards", "board", "preflop", "flop", "turn", "river", "validation", "reconstruction", "decisions"]) {
    assert.match(html, new RegExp(`data-stage="${stage}"`), `${stage} row`);
  }
  assert.match(html, /<ol[^>]*class="import-stage-list"/);
  assert.match(html, /data-stage="site"[^>]*data-status="complete"/);
  assert.match(html, /data-stage="flop"[^>]*data-status="warning"/);
  assert.match(html, /data-stage="turn"[^>]*data-status="pending"/);
  for (const word of ["Complete", "Needs review", "Pending"]) assert.match(html, new RegExp(word), `status word ${word} is written out`);
  assert.equal((html.match(/aria-hidden="true"/g) || []).length >= 10, true, "decorative icons are hidden from assistive tech");
}

function testStatusTextLivesInAPoliteLiveRegion() {
  const html = view.renderProgressMarkup(partialSnapshot(), { stage: "flop", from: "running", to: "warning" });
  const live = html.match(/<div[^>]*aria-live="polite"[^>]*>([\s\S]*?)<\/div>/);
  assert.ok(live, "an aria-live=polite region exists");
  assert.match(live[1], /Flop actions/);
  assert.match(live[1], /needs review/i);
  assert.match(live[1], /Flop action 2 · amount/, "uncertainty names the exact field");
  const idle = view.renderProgressMarkup(snapshotWith(() => {}));
  assert.match(idle.match(/aria-live="polite"[^>]*>([\s\S]*?)<\/div>/)[1], /0 of 10/);
}

function testWarningControlsCarryFieldRefsAndExactLabels() {
  const html = view.renderProgressMarkup(partialSnapshot());
  assert.match(html, /<button[^>]*type="button"[^>]*data-import-field-ref="actions\.flop\.1\.amountBb"[^>]*>[^<]*Flop action 2 · amount/);
  const many = view.renderProgressMarkup(snapshotWith((progress) => {
    progress.start("heroCards"); progress.warn("heroCards", { fieldRefs: ["hero.cards"] });
    progress.start("board"); progress.warn("board", { fieldRefs: ["board.flop", "board.turn", "board.flop"] });
    progress.start("river"); progress.fail("river", { message: "OCR failed", fieldRefs: ["actions.river"] });
  }));
  assert.match(many, /data-import-field-ref="hero\.cards"[^>]*>[^<]*Hero cards/);
  assert.match(many, /data-import-field-ref="board\.flop"[^>]*>[^<]*Flop cards/);
  assert.match(many, /data-import-field-ref="board\.turn"[^>]*>[^<]*Turn card/);
  assert.equal((many.match(/data-import-field-ref="board\.flop"/g) || []).length, 1, "duplicate refs collapse to one control");
  assert.match(many, /data-import-field-ref="actions\.river"[^>]*>[^<]*River action/);
}

function testRefsForTheSameActionCollapseToTheMostSpecificControl() {
  const html = view.renderProgressMarkup(snapshotWith((progress) => {
    progress.start("river");
    progress.warn("river", { message: "low", fieldRefs: ["actions.river.1", "actions.river.1.amountBb", "actions.river.0"] });
  }));
  assert.equal((html.match(/data-import-field-ref="actions\.river\.1"/g) || []).length, 0, "the generic ref is dropped when the amount ref exists");
  assert.equal((html.match(/data-import-field-ref="actions\.river\.1\.amountBb"/g) || []).length, 1);
  assert.equal((html.match(/data-import-field-ref="actions\.river\.0"/g) || []).length, 1, "a different action keeps its own control");
}

function testUserSuppliedTextIsEscaped() {
  const html = view.renderProgressMarkup(snapshotWith((progress) => {
    progress.start("preflop");
    progress.warn("preflop", { message: '<img src=x onerror="alert(1)">', fieldRefs: ['actions.preflop.0"><script>'] });
  }));
  assert.ok(!/<img src=x/.test(html) && !/<script>/.test(html));
}

function testFieldRefsResolveToExistingCorrectionControls() {
  assert.deepEqual(JSON.parse(JSON.stringify(view.resolveFieldRef("hero.cards"))), { kind: "cards", field: "hero", inputId: "importHeroHandEdit" });
  assert.deepEqual(JSON.parse(JSON.stringify(view.resolveFieldRef("board.turn"))), { kind: "cards", field: "turn", inputId: "importTurnEdit" });
  assert.deepEqual(JSON.parse(JSON.stringify(view.resolveFieldRef("board.flop"))), { kind: "cards", field: "flop", inputId: "importFlopEdit" });
  assert.deepEqual(JSON.parse(JSON.stringify(view.resolveFieldRef("actions.river.2.amountBb"))), { kind: "action", decisionKey: "river:2", street: "river", index: 2, control: "amountBb" });
  assert.deepEqual(JSON.parse(JSON.stringify(view.resolveFieldRef("actions.flop.0"))), { kind: "action", decisionKey: "flop:0", street: "flop", index: 0, control: "action" });
  assert.deepEqual(JSON.parse(JSON.stringify(view.resolveFieldRef("actions.turn"))), { kind: "action", decisionKey: "turn:0", street: "turn", index: 0, control: "action" });
  assert.equal(view.resolveFieldRef("streetPots.flop"), null, "pot labels have no editing control");
  assert.equal(view.resolveFieldRef("nonsense"), null);
  assert.equal(view.fieldLabel("streetPots.flop"), "Flop pot");
  assert.equal(view.fieldLabel("mystery.field"), "mystery.field");
}

function legacyHand(mutate) {
  const seats = [["Opener", "UTG"], ["HJ", "HJ"], ["CO", "CO"], ["BTN", "BTN"], ["Hero", "SB"], ["BB", "BB"]];
  const act = (actor, position, action, amountBb = null) => ({ actor, position, action, amountBb });
  const hand = {
    heroName: "Hero", heroHand: ["Ah", "Kh"],
    players: seats.map(([name, position]) => ({ name, position, stackBb: 100, isHero: name === "Hero" })),
    board: { flop: ["Qh", "7s", "4h"], turn: "Jc", river: "2d" },
    streets: {
      preflop: { actions: [act("Opener", "UTG", "raise", 2.5), act("HJ", "HJ", "fold"), act("CO", "CO", "fold"), act("BTN", "BTN", "fold"), act("Hero", "SB", "raise", 9), act("BB", "BB", "fold"), act("Opener", "UTG", "call", 6.5)] },
      flop: { actions: [act("Hero", "SB", "check"), act("Opener", "UTG", "bet", 5), act("Hero", "SB", "call", 5)] },
      turn: { actions: [act("Hero", "SB", "check"), act("Opener", "UTG", "bet", 8.2), act("Hero", "SB", "call", 8.2)] },
      river: { actions: [act("Hero", "SB", "check"), act("Opener", "UTG", "bet", 9), act("Hero", "SB", "call", 9)] },
    },
  };
  if (mutate) mutate(hand);
  return hand;
}

const enabledKeys = (html) => Array.from(html.matchAll(/data-decision-key="([^"]+)"[^>]*?(disabled)?>/g)).filter((match) => !match[2]).map((match) => match[1]);
const disabledKeys = (html) => Array.from(html.matchAll(/<button[^>]*data-decision-key="([^"]+)"[^>]*\sdisabled/g)).map((match) => match[1]);

function testUnresolvedBoundaryBlocksOnlyDependentLaterDecisions() {
  const complete = adapter.fromImportedHand(legacyHand(), { heroName: "Hero" });
  assert.equal(view.blockedDecisionKeys(complete).size, 0);

  const partial = adapter.fromImportedHand(legacyHand((hand) => { hand.streets.river.actions[1].amountBb = null; }), { heroName: "Hero" });
  assert.equal(partial.unresolved[0].key, "river:1");
  const blocked = view.blockedDecisionKeys(partial);
  assert.deepEqual(Array.from(blocked).sort(), ["river:2"], "only actions after the unresolved one depend on it");

  const html = workspace.renderWorkspaceMarkup({ converted: partial, selectedDecisionKey: null });
  assert.ok(enabledKeys(html).includes("preflop:0"), "earlier decisions stay selectable");
  assert.ok(enabledKeys(html).includes("flop:1"));
  assert.ok(enabledKeys(html).includes("turn:2"));
  assert.ok(enabledKeys(html).includes("river:0"));
  assert.ok(enabledKeys(html).includes("river:1"), "the unresolved action itself stays selectable so it can be corrected");
  assert.deepEqual(disabledKeys(html), ["river:2"], "only the dependent later decision is disabled");
}

function testABoardProblemBlocksThatStreetAndLater() {
  const partial = adapter.fromImportedHand(legacyHand((hand) => { hand.board.turn = "Qh"; }), { heroName: "Hero" });
  assert.equal(partial.unresolved[0].key, "board:turn");
  const blocked = Array.from(view.blockedDecisionKeys(partial)).sort();
  assert.deepEqual(blocked, ["river:0", "river:1", "river:2", "turn:0", "turn:1", "turn:2"]);
  const html = workspace.renderWorkspaceMarkup({ converted: partial });
  assert.ok(enabledKeys(html).includes("flop:2"));
  assert.ok(!enabledKeys(html).includes("turn:0"));
}

function testProgressiveDisplayWhenLaterStagesArePending() {
  const html = view.renderProgressMarkup(partialSnapshot());
  assert.match(html, /data-stage="river"[^>]*data-status="pending"/);
  assert.match(html, /Hero cards recognized\./, "completed stages keep their message while later ones are pending");
}

testProgressListShowsEveryStageWithTextNotJustColour();
testStatusTextLivesInAPoliteLiveRegion();
testWarningControlsCarryFieldRefsAndExactLabels();
testRefsForTheSameActionCollapseToTheMostSpecificControl();
testUserSuppliedTextIsEscaped();
testFieldRefsResolveToExistingCorrectionControls();
testUnresolvedBoundaryBlocksOnlyDependentLaterDecisions();
testABoardProblemBlocksThatStreetAndLater();
testProgressiveDisplayWhenLaterStagesArePending();
console.log("import V2 partial UI tests passed");
