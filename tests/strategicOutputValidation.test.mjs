import assert from "node:assert/strict";
import { validateStrategicOutput } from "../src/analysis/strategicOutputValidation.js";

const validHarrington = `
## Situation
Hero is in position on the flop and may check or bet.
## Key Evidence
Hero has ace-high with two overcards and no direct draw.
## Candidate Actions
Checking controls the pot. Betting can fold out some better ace-high hands.
## Recommendation
Check with medium confidence.
## Caveats
Villain tendencies could change the preferred action.
`;

assert.equal(
  validateStrategicOutput({ text: validHarrington, format: "harrington", completion: { finishReason: "STOP" } }).valid,
  true,
);

const numberedHarrington = validHarrington
  .replace("## Situation", "### 1. Situation")
  .replace("## Key Evidence", "### 2. Key Evidence")
  .replace("## Candidate Actions", "### 3. Candidate Actions")
  .replace("## Recommendation", "### 4. Recommendation")
  .replace("## Caveats", "### 5. Harrington-style Caveat");
assert.equal(
  validateStrategicOutput({ text: numberedHarrington, format: "harrington", completion: { finishReason: "STOP" } }).valid,
  true,
);

const repeatedIncident = `## Situation\nFlop decision.\n## Key Evidence\n${"If a Q comes, you have J-T-9-8-Q, no. ".repeat(12)}\n## Candidate Actions\nCheck or bet.\n## Recommendation\nCheck.\n## Caveats\nUnknown reads.`;
{
  const result = validateStrategicOutput({ text: repeatedIncident, format: "harrington", completion: { finishReason: "STOP" } });
  assert.equal(result.valid, false);
  assert.match(result.reasons.join(" "), /repeat/i);
}

{
  const result = validateStrategicOutput({ text: validHarrington, format: "harrington", completion: { finishReason: "MAX_TOKENS" } });
  assert.equal(result.valid, false);
  assert.match(result.reasons.join(" "), /MAX_TOKENS/i);
}

{
  const missingRecommendation = validHarrington.replace("## Recommendation", "## Preferred Line");
  const result = validateStrategicOutput({ text: missingRecommendation, format: "harrington", completion: { finishReason: "STOP" } });
  assert.equal(result.valid, false);
  assert.match(result.reasons.join(" "), /Recommendation/i);
}

assert.equal(
  validateStrategicOutput({
    text: "Checking keeps weaker hands available. Betting can also be reasonable because the board favors Hero's range.",
    format: "generic",
    completion: { finishReason: "STOP" },
  }).valid,
  true,
);

console.log("strategicOutputValidation tests passed");
