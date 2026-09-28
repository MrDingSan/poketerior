import assert from "node:assert/strict";
import {
  buildHarringtonPrompt,
  buildPokerSkillPrompt,
  strategicAnalysisMathPayload,
} from "../src/analysis/pipeline.js";
import { formatPokerSkillContext, selectPokerSkills } from "../src/analysis/pokerSkill.js";

const spot = {
  street: "flop",
  heroPosition: "CO",
  villainPosition: "UTG",
  heroHand: "Ah Jh",
  board: "Tc 9c 4s",
  actionLine: "UTG checks",
  legalActions: ["Check", "Bet"],
  recordedHeroAction: "check",
  recordedHeroAmount: null,
};

const unstableMath = {
  localBaselineRecommendation: "Raise",
  legalActions: ["Fold", "Call"],
  facingAllIn: false,
  equity: 0.79123,
  potOdds: 0.28456,
  ev: 20.055,
  confluence: 87,
  pot: 49.8,
  call: 11.23,
  rangeText: "22+,A2s+,K2s+",
  rangeSource: "loose BTN open floor",
  rangeSummary: "BTN opened, BB called; river bet.",
  boardTexture: "river broadway-heavy",
  combosTotal: 69,
  heroAheadCombos: 38,
  heroBehindCombos: 14,
  nearFlipCombos: 3,
  actionBuckets: { Value: 28, Draw: 12, Air: 0 },
  finalComboList: ["Ad Kd", "Qc Qd"],
  rangeHistory: [{ street: "flop", snapshot: { liveCount: 12, finalComboList: ["Ad Kd"] } }],
};

const sanitized = strategicAnalysisMathPayload(unstableMath);

for (const removedKey of [
  "localBaselineRecommendation",
  "equity",
  "potOdds",
  "ev",
  "confluence",
  "combosTotal",
  "heroAheadCombos",
  "heroBehindCombos",
  "nearFlipCombos",
  "actionBuckets",
  "finalComboList",
  "rangeText",
  "rangeSource",
  "rangeSummary",
  "rangeBaseCombos",
  "rangeTargetCombos",
  "rangeFinalTheoreticalCombos",
  "rangeLooseAdditions",
  "rangeBreakdown",
  "rangeHistory",
]) {
  assert.equal(Object.hasOwn(sanitized, removedKey), false, `${removedKey} should not be fed to strategic LLM prompts`);
}

assert.equal(sanitized.pot, 49.8);
assert.equal(sanitized.call, 11.23);
assert.equal(Object.hasOwn(sanitized, "rangeText"), false);

const harringtonPrompt = buildHarringtonPrompt({ spot, math: unstableMath, theory: [], styleExamples: [] });
const selectedSkills = selectPokerSkills({ spot, math: sanitized });
const pokerSkillPrompt = buildPokerSkillPrompt({ spot, math: unstableMath, selectedSkills });
const skillContext = formatPokerSkillContext(selectedSkills);

for (const text of [harringtonPrompt, pokerSkillPrompt, skillContext]) {
  assert.equal(text.includes('"equity"'), false);
  assert.equal(text.includes("0.79123"), false);
  assert.equal(text.includes('"potOdds"'), false);
  assert.equal(text.includes("0.28456"), false);
  assert.equal(text.includes('"ev"'), false);
  assert.equal(text.includes("20.055"), false);
  assert.equal(text.includes('"confluence"'), false);
  assert.equal(text.includes('"heroAheadCombos"'), false);
  assert.equal(text.includes("38 ahead / 14 behind"), false);
  assert.equal(text.includes("22+,A2s+,K2s+"), false);
  assert.equal(text.includes("loose BTN open floor"), false);
  assert.equal(text.includes("Range summary:"), false);
  assert.equal(text.includes("Anchor villain's continuing range to the app range model"), false);
}

assert.match(harringtonPrompt, /Strategic context payload JSON/);
assert.match(pokerSkillPrompt, /Strategic context payload JSON/);
assert.match(pokerSkillPrompt, /compare.*recorded Hero action/i);
assert.match(pokerSkillPrompt, /"recordedHeroAction": "check"/);
assert.doesNotMatch(pokerSkillPrompt, /Review.*candidate|candidate.*Review/i);
for (const text of [harringtonPrompt, pokerSkillPrompt]) {
  assert.match(text, /Authoritative Hero hand facts JSON/);
  assert.match(text, /"directStraightDraw": "none"/);
  assert.match(text, /"backdoorFlushDraw": false/);
  assert.doesNotMatch(text, /rangeHistory|liveCount|finalComboList/);
}

console.log("strategic prompt sanitization checks passed");
