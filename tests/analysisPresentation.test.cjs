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

const {
  extractRecommendedAction,
  summarizeReasoning,
  extractSection,
  blurb,
  boardNote,
  parseMarkdownTable,
  actionTone,
  verdictAgreement,
} = loadBrowserModule("analysisPresentation.js", "PokerCoachAnalysisPresentation");

const nemotronOutput = `1. **Recommendation: Bet** (choose "Bet" from the legal actions [Check, Bet]).
2. **Numerical reasoning**
| Item | Value |
|------|-------|
| Hero equity vs. villain range | ≈48.1% |
| Pot size (before any bet) | **18.7 bb** |
3. **Why**
Villain's capped range folds many overcards. A small bet denies 48.1% of the equity cheaply. Later streets get harder.`;

assert.equal(extractRecommendedAction(nemotronOutput, ["Check", "Bet"]), "Bet", "reads the LLM's own verdict, not the local heuristic");
assert.equal(extractRecommendedAction(nemotronOutput, ["Check", "Fold"]), null, "ignores verdicts outside the legal actions");
assert.equal(extractRecommendedAction("Recommendation - call the shove.", []), "Call");
assert.equal(extractRecommendedAction("Recommended action: all-in", ["Fold", "All-in"]), "All-in");
assert.equal(extractRecommendedAction("No verdict here.", ["Bet"]), null);

const summary = summarizeReasoning(nemotronOutput);
assert.equal(
  summary,
  "Villain's capped range folds many overcards. A small bet denies 48.1% of the equity cheaply.",
  "summary skips the recommendation line, tables, and headings and does not split on decimals",
);
assert.doesNotMatch(summary, /\b2\.$/, "summary must not end with a dangling list number");

const lines = nemotronOutput.split("\n");
const table = parseMarkdownTable(lines, 2);
assert.deepEqual([...table.header], ["Item", "Value"]);
assert.equal(table.rows.length, 2);
assert.deepEqual([...table.rows[1]], ["Pot size (before any bet)", "**18.7 bb**"]);
assert.equal(table.end, 6);
assert.equal(parseMarkdownTable(lines, 0), null, "non-table lines are not tables");

assert.equal(actionTone("Bet"), "aggressive");
assert.equal(actionTone("check"), "passive");
assert.equal(actionTone("Fold"), "fold");
assert.equal(verdictAgreement("Bet", "bet"), "agree");
assert.equal(verdictAgreement("Check", "Bet"), "disagree");
assert.equal(verdictAgreement("Check", null), null);

console.log("analysis presentation checks passed");

// Shape of a live Nemotron flop answer (TsTh on 8h 2s Qh): numbered sections, boilerplate, range bullets.
const liveOutput = `1. **Recommendation:** **Bet**
*(Legal actions at this node are Check or Bet; we select Bet.)*
2. **Numerical reasoning**
| Item | Value |
|------|-------|
| Hero's equity vs. villain's range | **62.18 %** |
| Key blockers | - Removes 5 of the 6 TT combos.<br>- Blocks ATs, KTs. |
3. **Villain range interpretation for the exact action sequence**
- Preflop: Villain opened from UTG with a wide "loose" range (all pocket pairs, suited aces).
- Flop (8♥ 2♠ Q♥): The board is Q-high, two-tone, and disconnected.
4. **How the retrieved study context applies**
The retrieved snippets are generic templates and principle statements; they do not contain specific strategic advice for this spot. Consequently, the recommendation relies on standard poker theory: betting for value when you have a clear equity advantage and can extract value from worse hands while charging draws.
5. **Caveats / uncertainties**
- The range confidence is marked medium; a tighter premium-only opening range would shift more weight to JJ-AA.`;

const liveSummary = summarizeReasoning(liveOutput);
assert.match(liveSummary, /betting for value when you have a clear equity advantage/, "summary keeps the strategic sentence");
assert.doesNotMatch(liveSummary, /Legal actions|snippets|Villain opened|confidence is marked/, "summary drops boilerplate, range description, and caveats");
assert.equal(extractRecommendedAction(liveOutput, ["Check", "Bet"]), "Bet");
const liveTable = parseMarkdownTable(liveOutput.split("\n"), 3);
assert.match(liveTable.rows[1][1], /<br>/, "cell line breaks survive parsing for the renderer to split");

// Second live shape: study-context section echoes prompt instructions; a "Bottom line" closes the caveats.
const echoOutput = `1. **Recommendation:** **Bet**
4. **How the retrieved study context applies**
The retrieved snippets are generic templates. They remind us to:
- Clearly state villain's range before and after each action (done in section 3).
- Consider position, stack depth, and street – here we are out of position (SB) on the flop.
5. **Caveats / uncertainties**
- Bet sizing: any positive-EV bet is preferable to a check given our >60 % equity.
**Bottom line:** With 60.75 % equity, a strong blocker effect, and a positive EV for a modest bet, the optimal first-action on this flop is to bet. Checking would forfeit value and give the villain free realization of their equity.`;
assert.equal(
  summarizeReasoning(echoOutput),
  "With 60.75 % equity, a strong blocker effect, and a positive EV for a modest bet, the optimal first-action on this flop is to bet. Checking would forfeit value and give the villain free realization of their equity.",
  "an explicit bottom line wins over heuristics",
);
assert.equal(summarizeReasoning(echoOutput.replace(/\*\*Bottom line:\*\*.*$/s, "")), "", "instruction echoes and meta sections never become the summary");

// Third live shape: bare "Recommendation" heading, verdict in the paragraph, prompt echo in the text.
const paragraphOutput = `**1. Recommendation**
Given the legal actions **[Check, Bet]** and the fact that the hero is *not* facing an all-in, the optimal play is to **Bet**. (The local baseline also recommends a bet.) Provide a concise recommendation with justification (bet for value, EV +3.63 bb).
**2. Numerical reasoning**
| Item | Value |
|------|-------|
| Pot | 6 bb |
Because hero's equity (60.5 %) far exceeds the breakeven equity, betting extracts value from the many hands we dominate while only losing to the few hands that have us beat.
**3. Villain range interpretation for the exact action sequence**
Villain opened from UTG with a loose range (see rangeText).`;
assert.equal(extractRecommendedAction(paragraphOutput, ["Check", "Bet"]), "Bet", "verdict can sit in the paragraph under the heading");
assert.equal(extractRecommendedAction(paragraphOutput, ["Check", "Fold"]), null, "a bracketed legal-action list is not a verdict");
const paragraphSummary = summarizeReasoning(paragraphOutput);
assert.match(paragraphSummary, /betting extracts value from the many hands we dominate/);
assert.doesNotMatch(paragraphSummary, /Provide a concise|local baseline|Given the legal actions/);

// Fourth live shape: a formula-heavy blockers paragraph must not become the summary.
const formulaOutput = `1. **Recommendation:** **Bet**
2. **Numerical reasoning**
Expected value of a bet (assuming a standard half-pot bet = 3 bb) = EV = (equity x pot + fold equity) - cost = 3.705 bb (as given by the ev field). Important blockers: Hero holds Ts Th, which removes 5 combos of TT.
3. **Why**
Betting charges the weaker pairs and denies equity to overcards, because villain's range is capped on this Q-high board.`;
const formulaSummary = summarizeReasoning(formulaOutput);
assert.match(formulaSummary, /denies equity to overcards/, "advice beats arithmetic");
assert.doesNotMatch(formulaSummary, /EV =|3\.705/, "formulas are evidence, not the summary");

// Strategy cards show the recommendation section as a blurb and keep the rest behind a disclosure.
const harrington = `## Situation
Hero holds Ts Th on Qh 8h 2s out of position against a UTG opener.

## Key Evidence
Made hand: pair of tens, vulnerable to overcards and flush draws.

## Recommendation
Bet approximately half the pot for value and protection. Checking gives Villain a free card. Later streets need re-evaluation.

## Caveats
A read on Villain's tendency to float would change this.`;
assert.equal(extractSection(harrington, /^recommendation$/i), "Bet approximately half the pot for value and protection. Checking gives Villain a free card. Later streets need re-evaluation.");
assert.equal(blurb(harrington), "Bet approximately half the pot for value and protection. Checking gives Villain a free card.");
assert.equal(extractSection("**Recommendation**\nCheck back and reassess.\n**Caveats**\nNone.", /^recommendation$/i), "Check back and reassess.");
assert.equal(extractSection("Recommendation:\nBet small for value here.\nCaveats:\nNone.", /^recommendation$/i), "Bet small for value here.");
assert.equal(extractSection(harrington, /^nonexistent$/i), "");
assert.match(blurb("Situation:\nFlop, SB acts first.\nBottom line: With 60% equity, betting for value denies equity from overcards."), /betting for value denies equity/, "falls back to the general summary when there is no recommendation section");

// Board notes come only from the cards: flush structure, straight structure, pairing.
assert.equal(boardNote(["8h", "2s", "Qh"]), "Flush draw possible (two hearts). Few straight draws.");
assert.equal(boardNote(["Ah", "Kd", "2c"]), "No flush draw. Few straight draws.");
assert.equal(boardNote(["7s", "8s", "9d"]), "Flush draw possible (two spades). Straight draws likely.");
assert.equal(boardNote(["Ah", "2d", "5c"]), "No flush draw. Straight draws likely.", "an ace plays low for the wheel");
assert.equal(boardNote(["9h", "9d", "4c"]), "No flush draw. No real straight draws. Paired board: trips and full houses are possible.");
assert.equal(boardNote(["2h", "7h", "Jh"]), "Three hearts: two hearts in hand make a flush. Few straight draws.", "7 and J share the 7-J window");
assert.equal(boardNote(["2h", "8h", "Kh"]), "Three hearts: two hearts in hand make a flush. No real straight draws.");
assert.equal(boardNote(["8h", "2s", "Qh", "5h"]), "Three hearts: two hearts in hand make a flush. Few straight draws.");
assert.equal(boardNote(["8h", "2h", "Qh", "5h"]), "Four hearts on board: any heart makes a flush. Few straight draws.");
assert.equal(boardNote(["6c", "7d", "8h", "9s"]), "No flush draw. Four cards to a straight on board.", "four different suits");
assert.equal(boardNote(["6c", "7c", "8h", "Ks"]), "Flush draws possible. Straight draws likely.", "a two-suit turn keeps flush draws alive");
assert.equal(boardNote(["8h", "2s"]), "", "no note before the flop");

// A disclaimer about the retrieved study context is not advice, even though it mentions strategy words.
const disclaimerOutput = `1. **Recommendation:** **Bet**
4. **How the retrieved study context applies**
No specific strategic concepts (e.g., Harrington's cash-game advice) were directly applicable beyond the generic reminder to consider pot-odds, equity, and range composition.
5. **Why**
Because hero's equity is well above half, betting extracts value from worse pairs and denies equity to overcards on this Q-high board.`;
assert.equal(
  summarizeReasoning(disclaimerOutput),
  "Because hero's equity is well above half, betting extracts value from worse pairs and denies equity to overcards on this Q-high board.",
  "study-context disclaimers never become the verdict summary",
);
