import assert from "node:assert/strict";
import { runHarringtonAnalysis } from "../src/analysis/pipeline.js";

const structured = {
  situation: "Hero faces a turn bet in position.",
  keyEvidence: "The price and action line favor caution.",
  candidateActions: "Fold and call are legal; raising is not.",
  recommendation: "Fold with medium confidence.",
  caveats: "A strong opponent read could change the decision.",
};
let providerInput;
const controller = new AbortController();
const result = await runHarringtonAnalysis(
  {
    spot: { street: "turn", heroHand: "Ad 5d", board: "3c Ks Jd 5c", legalActions: ["Fold", "Call"] },
    math: { legalActions: ["Fold", "Call"] },
    rootDir: process.cwd(),
    config: {},
    signal: controller.signal,
  },
  {
    callProvider: async (input) => {
      providerInput = input;
      const response = { text: JSON.stringify(structured), completion: { finishReason: "stop" } };
      assert.equal(input.validate(response).valid, true, "valid structured Harrington output must pass before failover");
      return { ...response, provider: "test", model: "test-model" };
    },
  },
);

assert.equal(providerInput.maxTokens, 2200);
assert.equal(providerInput.timeoutMs, 45000);
assert.equal(providerInput.signal, controller.signal);
assert.match(providerInput.prompt, /Return only valid JSON/);
assert.match(result.analysis, /## Situation\nHero faces a turn bet in position\./);
assert.match(result.analysis, /## Caveats\nA strong opponent read could change the decision\./);

console.log("structured Harrington output checks passed");
