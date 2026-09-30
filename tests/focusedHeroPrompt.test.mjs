import assert from "node:assert/strict";
import { buildFocusedActionRepairPrompt, buildFocusedHeroHandPrompt } from "../src/analysis/pipeline.js";

const prompt = buildFocusedHeroHandPrompt({ heroHand: ["Js", "Ks"], heroName: "MauroG27129" });

assert.doesNotMatch(prompt, /Js|Ks|MauroG27129/);
assert.match(prompt, /bottom-center/i);
assert.match(prompt, /playerName/);
assert.match(prompt, /confidence/);
assert.match(prompt, /evidence/);

const actionPrompt = buildFocusedActionRepairPrompt();
assert.match(actionPrompt, /bottom-center/i);
assert.match(actionPrompt, /player.*position/i);
assert.match(actionPrompt, /chronological/i);
assert.match(actionPrompt, /return|refund/i);

console.log("focused hero prompt tests passed");
