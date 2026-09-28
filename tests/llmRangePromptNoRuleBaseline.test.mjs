import assert from "node:assert/strict";
import { buildRangeInterpretationPrompt, rangeInterpreterMathPayload } from "../src/analysis/pipeline.js";

const prompt = buildRangeInterpretationPrompt({
  spot: {
    street: "flop",
    rangeMode: "loose",
    heroPosition: "SB",
    villainPosition: "MP",
    actionLine: "MP open 2.2 -> SB raise 6.97 -> MP call 4.77",
    board: "Ah 2c 6s",
  },
  math: {
    rangeText: "22+,A2s+",
    rangeSource: "rule baseline",
    rangeSummary: "local range summary",
    rangeMode: "loose",
    villainAction: "call_vs_3bet",
    boardTexture: "A-high",
    legalActions: ["Check", "Bet"],
    pot: 18.2,
    call: 0,
  },
  harringtonTheory: [],
  selectedSkills: [],
});

assert.equal(prompt.includes("Rule-based"), false);
assert.equal(prompt.includes("rule-based"), false);
assert.equal(prompt.includes("Treat math.rangeText as the minimum preflop floor"), false);
assert.equal(prompt.includes("must use math.rangeText exactly"), false);
assert.equal(prompt.includes("22+,A2s+"), false, "LLM range interpreter should not receive local rule range text as an anchor.");
assert.match(prompt, /LLM range context payload JSON/);

const firstToActPrompt = buildRangeInterpretationPrompt({
  spot: {
    street: "flop",
    heroPosition: "BB",
    villainPosition: "CO",
    board: "9h 7c Jh",
    freezeToPriorStreetRange: true,
  },
  math: {},
  harringtonTheory: [],
  selectedSkills: [],
});
assert.match(
  firstToActPrompt,
  /Do not narrow the range for board texture, hypothetical continuation, or the withheld Hero action/,
  "a first-to-act Hero prompt must prohibit board-only range narrowing",
);

console.log("LLM range prompt rule-baseline removal checks passed");

const compactPayload = rangeInterpreterMathPayload({
  legalActions: ["Check", "Bet"],
  boardTexture: "A-high",
  rangeHistory: [{ street: "preflop", combos: Array.from({ length: 500 }, (_, index) => `combo-${index}`) }],
  finalComboList: Array.from({ length: 500 }, (_, index) => `combo-${index}`),
});
assert.deepEqual(compactPayload, {
  legalActions: ["Check", "Bet"],
  boardTexture: "A-high",
}, "range prompts must omit expanded range histories and combo lists");
