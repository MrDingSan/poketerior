const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/llmRangeGuard.js"), "utf8");
const sandbox = { window: {}, globalThis: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: "llmRangeGuard.js" });

const guard = sandbox.PokerCoachLLMRangeGuard;
assert.ok(guard, "LLM range guard should be attached to global scope");

const combos = {
  "AA": ["Ac Ad", "Ac Ah"],
  "KK": ["Kc Kd"],
  "QQ": ["Qc Qd"],
  "JJ": ["Jc Jd"],
  "TT": ["Tc Td"],
  "22": ["2c 2d"],
  "AQs": ["Ac Qc"],
  "AJs": ["Ac Jc", "As Js"],
  "A5s": ["Ac 5c", "As 5s"],
  "K2s": ["Kc 2c"],
  "Q5s": ["Qc 5c"],
  "76s": ["7c 6c"],
};

function parseRange(rangeText) {
  const labels = String(rangeText || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .flatMap((token) => {
      if (token === "QQ+") return ["QQ", "KK", "AA"];
      if (token === "JJ+") return ["JJ", "QQ", "KK", "AA"];
      return [token];
    });
  const seen = new Set();
  const rangeCombos = [];
  const breakdown = [];
  for (const label of labels) {
    const handCombos = combos[label] || [];
    const live = [];
    for (const combo of handCombos) {
      if (seen.has(combo)) continue;
      seen.add(combo);
      rangeCombos.push(combo.split(" "));
      live.push(combo.split(" "));
    }
    breakdown.push({ handClass: label, combos: live, liveCount: live.length });
  }
  return { combos: rangeCombos, breakdown };
}

function knownCardsThroughStreet() {
  return [];
}

function knownCardsForTurn() {
  return ["2d", "8c", "Qd", "7s"];
}

const interpretation = {
  street: "river",
  rangeText: "JJ+,AQs,76s",
  summary: "River widened incorrectly.",
  streetSummaries: [
    { street: "preflop", rangeText: "QQ+,AQs,76s", reasoning: "start" },
    { street: "flop", rangeText: "QQ+,AQs", reasoning: "narrow" },
    { street: "turn", rangeText: "QQ+", reasoning: "narrow more" },
    { street: "river", rangeText: "JJ+,AQs,76s", reasoning: "model widened" },
  ],
};

const sanitized = guard.sanitizeLLMRangeInterpretation({
  interpretation,
  parseRange,
  knownCardsThroughStreet,
});

assert.deepEqual(
  JSON.parse(JSON.stringify(sanitized.streetSummaries.map((item) => item.snapshot.combos))),
  [6, 5, 4, 4],
);
assert.deepEqual(
  JSON.parse(JSON.stringify(sanitized.streetSummaries.map((item) => item.rangeText))),
  ["QQ+,AQs,76s", "QQ,KK,AA,AQs", "QQ,KK,AA", "QQ,KK,AA"],
);
assert.equal(sanitized.rangeText, "QQ,KK,AA");
assert.match(sanitized.caveats.join(" "), /removed 3 combo/);

const badDrawNarrative = guard.sanitizeLLMRangeInterpretation({
  interpretation: {
    street: "turn",
    rangeText: "AJs,A5s",
    summary: "Villain has strong draws.",
    streetSummaries: [
      { street: "preflop", rangeText: "AJs,A5s", reasoning: "BTN open." },
      {
        street: "flop",
        rangeText: "AJs,A5s",
        reasoning: "Villain continues with overcards.",
      },
      {
        street: "turn",
        rangeText: "AJs,A5s",
        reasoning: "Villain raised the turn, narrowing their range to strong draws (AJs, A5s).",
      },
    ],
  },
  parseRange,
  knownCardsThroughStreet: knownCardsForTurn,
  comboFactCheck: () => ({ draw: false, flushDraw: false, straightDraw: "" }),
});

assert.equal(
  /strong draws/i.test(badDrawNarrative.streetSummaries[2].reasoning),
  false,
  "Unsupported strong-draw wording should be removed from street reasoning.",
);
assert.match(badDrawNarrative.streetSummaries[2].reasoning, /not verified as draws/i);
assert.match(badDrawNarrative.caveats.join(" "), /turn LLM draw claim was fact-checked/i);

const frozenFlop = guard.sanitizeLLMRangeInterpretation({
  interpretation: {
    street: "flop",
    rangeText: "QQ,AQs",
    summary: "Model incorrectly removed flop misses.",
    streetSummaries: [
      { street: "preflop", rangeText: "QQ+,AQs,76s", reasoning: "CO calls the 3-bet." },
      { street: "flop", rangeText: "QQ,AQs", reasoning: "Model invented a board-only continuation filter." },
    ],
  },
  parseRange,
  knownCardsThroughStreet,
  freezeCurrentStreetToPriorRange: true,
});

assert.equal(
  frozenFlop.rangeText,
  "QQ,KK,AA,AQs,76s",
  "a first-to-act Hero flop must retain the prior range rather than apply a board-only continuation filter",
);
assert.match(frozenFlop.caveats.join(" "), /prior-street range/i);

console.log("LLM range guard regression checks passed");
