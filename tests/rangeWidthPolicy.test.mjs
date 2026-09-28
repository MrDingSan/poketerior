import assert from "node:assert/strict";
import { applyLockedPreflopRange, applyRangeRepair, buildRangeInterpretationPrompt, runLLMRangeInterpreter } from "../src/analysis/pipeline.js";
import { checkPreflopWidth, expectedPreflopBand } from "../src/analysis/rangeWidthPolicy.js";

const utgLoose = expectedPreflopBand({ villainAction: "open", villainPosition: "UTG", rangeMode: "loose" });
assert.deepEqual(utgLoose, { min: 15, max: 30, label: "loose UTG open" });
assert.equal(expectedPreflopBand({ villainAction: "open", villainPosition: "HJ", rangeMode: "tight" }).label, "tight MP open", "HJ uses the MP band");
assert.equal(expectedPreflopBand({ villainAction: "call_vs_open", villainPosition: "BB", rangeMode: "loose" }).min, 28, "big blind defends wider");
assert.equal(expectedPreflopBand({ villainAction: "limp", villainPosition: "UTG", rangeMode: "loose" }), null, "unknown actions are not banded");

const anyTwo = "22+,A2s+,K2s+,Q2s+,J2s+,T2s+,92s+,82s+,72s+,62s+,52s+,42s+,32s+,A2o+,K2o+,Q2o+,J2o+,T2o+,92o+,82o+,72o+,62o+,52o+,42o+,32o+";
const sane = "22+,A2s+,KTs+,QTs+,JTs,T9s,98s,87s,76s,65s,54s,43s,32s,AJo+,KQo";
const interpretation = (preflop) => ({
  street: "flop",
  rangeText: preflop,
  summary: "UTG open unchanged on the flop.",
  confidence: "medium",
  streetSummaries: [
    { street: "preflop", reasoning: "UTG opened.", rangeText: preflop },
    { street: "flop", reasoning: "Hero acts first.", rangeText: preflop },
  ],
  weightedGroups: [],
  keyDrivers: [],
  caveats: [],
});

const wide = checkPreflopWidth(interpretation(anyTwo), utgLoose);
assert.equal(wide.percent, 100);
assert.equal(wide.withinBand, false);
assert.equal(checkPreflopWidth(interpretation(sane), utgLoose).withinBand, true);

const spot = {
  street: "flop",
  heroPosition: "SB",
  villainPosition: "UTG",
  rangeMode: "loose",
  heroHand: "Ts Th",
  board: "8h 2s Qh",
  preflopActions: [{ actor: "UTG", action: "open", amount: 2.5 }, { actor: "SB", action: "call", amount: 2.5 }],
};
assert.match(buildRangeInterpretationPrompt({ spot, math: { villainAction: "open" } }), /cover 15–30% of all 1326 starting combos/);
assert.match(buildRangeInterpretationPrompt({ spot, math: {} }), /Never use placeholders or words: no "Kxs"/);

// An implausible range is repaired with a small ranges-only call; the first draft's prose is kept.
const calls2 = [];
const repairReply = { streetSummaries: [{ street: "preflop", rangeText: sane }, { street: "flop", rangeText: sane }] };
const replies = [interpretation(anyTwo), repairReply];
const retried = await runLLMRangeInterpreter(
  { spot, math: { villainAction: "open" }, rootDir: process.cwd(), config: {} },
  { callProvider: async (input) => { calls2.push(input); return { text: JSON.stringify(replies.shift()), provider: "test", model: "m" }; } },
);
assert.equal(calls2.length, 2);
assert.match(calls2[1].prompt, /Correction required: .*covers 100% of starting hands, which is too wide for a loose UTG open/);
assert.ok(calls2[1].maxTokens < calls2[0].maxTokens, "the repair call asks for far fewer tokens than the full interpretation");
assert.doesNotMatch(calls2[1].prompt, /weightedGroups/, "the repair call does not ask for the full explanation again");
assert.equal(retried.rangeInterpretation.rangeText, sane);
assert.equal(retried.rangeInterpretation.streetSummaries[1].reasoning, "Hero acts first.", "first-draft reasoning survives the repair");
assert.deepEqual(retried.rangeWidth.attempts, [100, 17.3]);
assert.equal(retried.rangeWidth.withinBand, true);

// When every attempt misses, the closest one is kept and flagged instead of looping forever.
let calls = 0;
const stubborn = await runLLMRangeInterpreter(
  { spot, math: { villainAction: "open" }, rootDir: process.cwd(), config: {} },
  { callProvider: async () => { calls += 1; return { text: JSON.stringify(interpretation(anyTwo)), provider: "test", model: "m" }; } },
);
assert.equal(calls, 3, "one ask plus two corrections");
assert.equal(stubborn.rangeWidth.withinBand, false);

// A locked preflop range is enforced and never re-sized.
let lockedPrompt = "";
const locked = await runLLMRangeInterpreter(
  { spot: { ...spot, lockedPreflopRange: { rangeText: sane } }, math: { villainAction: "open" }, rootDir: process.cwd(), config: {} },
  { callProvider: async ({ prompt }) => { lockedPrompt = prompt; return { text: JSON.stringify(interpretation(anyTwo)), provider: "test", model: "m" }; } },
);
assert.match(lockedPrompt, /Copy its rangeText unchanged into streetSummaries\[0\]\.rangeText/);
assert.equal(locked.rangeInterpretation.streetSummaries[0].rangeText, sane, "the model cannot re-roll a locked preflop range");
assert.equal(locked.rangeWidth.locked, true);
assert.equal(locked.rangeWidth.attempts.length, 1, "locked ranges are not re-asked");

// A failed repair call keeps the first draft instead of failing the whole range.
let repairCalls = 0;
const repairFails = await runLLMRangeInterpreter(
  { spot, math: { villainAction: "open" }, rootDir: process.cwd(), config: {} },
  { callProvider: async () => { repairCalls += 1; if (repairCalls > 1) throw new Error("provider down"); return { text: JSON.stringify(interpretation(anyTwo)), provider: "test", model: "m" }; } },
);
assert.equal(repairCalls, 2);
assert.equal(repairFails.rangeInterpretation.rangeText, anyTwo);
assert.equal(repairFails.rangeWidth.withinBand, false);

const repaired = applyRangeRepair(interpretation(anyTwo), { streetSummaries: [{ street: "flop", rangeText: "AA" }] });
assert.equal(repaired.rangeText, "AA", "the requested street's repaired range becomes the final range");
assert.equal(repaired.streetSummaries[0].rangeText, anyTwo, "streets missing from the repair are left as they were");

const preflopOnly = applyLockedPreflopRange({ street: "preflop", rangeText: "AA", streetSummaries: [] }, sane);
assert.equal(preflopOnly.rangeText, sane);
assert.equal(preflopOnly.streetSummaries[0].street, "preflop");

console.log("range width policy checks passed");
