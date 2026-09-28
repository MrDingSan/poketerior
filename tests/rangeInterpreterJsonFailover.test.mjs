import assert from "node:assert/strict";
import { runLLMRangeInterpreter } from "../src/analysis/pipeline.js";

const validRange = {
  street: "turn",
  rangeText: "JJ,55,AJs,KJs,QJs,AcQc,AcTc",
  summary: "Villain retains made hands and club draws after calling the turn raise.",
  confidence: "medium",
  comparisonToRuleBased: "",
  streetSummaries: [
    { street: "preflop", reasoning: "CO called a three-bet.", rangeText: "JJ-55,AQs-ATs,KQs-KJs,QJs,AQo" },
    { street: "flop", reasoning: "The flop checked through.", rangeText: "JJ-55,AQs-AJs,KQs-KJs,QJs" },
    { street: "turn", reasoning: "Bet-call retains value and club draws.", rangeText: "JJ,55,AJs,KJs,QJs,AcQc,AcTc" },
  ],
  weightedGroups: [],
  keyDrivers: ["Villain called a turn raise."],
  caveats: ["No player-specific read."],
};

let malformedWasRejected = false;
let providerInput;
const controller = new AbortController();
const result = await runLLMRangeInterpreter(
  {
    spot: {
      street: "turn",
      heroPosition: "BTN",
      villainPosition: "CO",
      heroHand: "Ad 5d",
      board: "3c Ks Jd 5c",
    },
    math: {},
    rootDir: process.cwd(),
    config: {},
    signal: controller.signal,
  },
  {
    callProvider: async (input) => {
      providerInput = input;
      const { validate } = input;
      const malformed = { text: '{"street":"turn","rangeText":"JJ",}' };
      malformedWasRejected = validate(malformed).valid === false;
      return { text: JSON.stringify(validRange), provider: "test", model: "fallback" };
    },
  },
);

assert.equal(malformedWasRejected, true, "malformed model JSON must be rejected during provider failover");
assert.equal(providerInput.maxTokens, 4096);
assert.equal(providerInput.timeoutMs, 45000);
assert.equal(providerInput.signal, controller.signal);
assert.deepEqual(result.rangeInterpretation, validRange);

console.log("rangeInterpreterJsonFailover tests passed");
