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
assert.equal(providerInput.maxTokens, 8192, "the cap leaves room for long reasoning before the JSON");
assert.equal(providerInput.timeoutMs, 45000);
assert.equal(providerInput.signal, controller.signal);
assert.deepEqual(result.rangeInterpretation, validRange);

console.log("rangeInterpreterJsonFailover tests passed");

// A range answer with nothing for the street being analyzed is rejected so the next model gets a turn.
{
  const { validateRangeInterpreterOutput } = await import("../src/analysis/pipeline.js");
  const preflopOnly = { text: JSON.stringify({ streetSummaries: [{ street: "preflop", rangeText: "22+" }] }) };
  assert.equal(validateRangeInterpreterOutput(preflopOnly, "flop").valid, false);
  assert.equal(validateRangeInterpreterOutput(preflopOnly, "preflop").valid, true);
  assert.equal(validateRangeInterpreterOutput({ text: JSON.stringify({ rangeText: "AK" }) }, "flop").valid, true);
  console.log("missing-street range validation passed");
}
