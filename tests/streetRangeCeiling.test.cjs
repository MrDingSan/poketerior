const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const lockSandbox = { globalThis: {} };
vm.createContext(lockSandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/streetRangeLock.js"), "utf8"), lockSandbox);
const { createStreetRangeLock } = lockSandbox.globalThis.PokerCoachStreetRangeLock;

const guardSandbox = {};
guardSandbox.globalThis = guardSandbox;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/llmRangeGuard.js"), "utf8"), guardSandbox);
const guard = guardSandbox.PokerCoachLLMRangeGuard;
// Values from a vm context have foreign prototypes; compare them as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));

const preflop = [["BTN", "raise", "2.5"], ["BB", "call", "2.5"]].map(([actor, action, amount]) => ({ actor, action, amount }));
const base = { rangeMode: "loose", heroPosition: "BTN", villainPosition: "BB", board: "Kh 7d 2c 9s" };

// Flop decision: BB checked to Hero.
const flopSpot = {
  ...base,
  street: "flop",
  allStreetActions: { preflop: preflop, flop: [{ actor: "BB", action: "check", amount: "" }] },
};
// Turn decision: BB checked, Hero bet, BB called on the flop; BB checked the turn.
const turnSpot = {
  ...base,
  street: "turn",
  allStreetActions: {
    preflop: preflop,
    flop: [
      { actor: "BB", action: "check", amount: "" },
      { actor: "BTN", action: "bet", amount: "2.8" },
      { actor: "BB", action: "call", amount: "2.8" },
    ],
    turn: [{ actor: "BB", action: "check", amount: "" }],
  },
};

const lock = createStreetRangeLock();
lock.remember(flopSpot, "flop", "22,33,KQs");

// The flop line grew, so there is no exact lock - but the earlier flop range still bounds it.
assert.deepEqual(plain(lock.priorLocks(turnSpot, "turn")), []);
assert.deepEqual(plain(lock.ceilings(turnSpot, "turn")), [{ street: "flop", rangeText: "22,33,KQs", unchanged: false }]);

// A different board or villain is a different hand.
assert.deepEqual(plain(lock.ceilings({ ...turnSpot, board: "Ah 7d 2c 9s" }, "turn")), []);
assert.deepEqual(plain(lock.ceilings({ ...turnSpot, villainPosition: "SB" }, "turn")), []);
// A line that diverges from the earlier one (BB bet instead of checking) is not bounded by it.
assert.deepEqual(
  plain(lock.ceilings({ ...turnSpot, allStreetActions: { ...turnSpot.allStreetActions, flop: [{ actor: "BB", action: "bet", amount: "2" }] } }, "turn")),
  [],
);
// Once the full flop line is locked it's a verbatim prior lock, and the shorter line still bounds it, so a
// stale lock saved wider than the earlier flop range (from before ceilings existed) gets capped too.
lock.remember(turnSpot, "flop", "22,33,44,KQs,AKo");
assert.deepEqual(plain(lock.priorLocks(turnSpot, "turn")), [{ street: "flop", rangeText: "22,33,44,KQs,AKo" }]);
assert.deepEqual(plain(lock.ceilings(turnSpot, "turn")), [{ street: "flop", rangeText: "22,33,KQs", unchanged: false }]);

// Guard: the LLM re-derives a wider flop range on the turn request; it gets capped to the earlier flop range.
const classes = {
  "22": [["2d", "2h"], ["2s", "2h"]],
  "33": [["3c", "3d"]],
  "44": [["4c", "4d"]],
  KQs: [["Kc", "Qc"]],
  AKo: [["Ac", "Kd"]],
};
function parseRange(text) {
  const combos = [];
  const breakdown = [];
  for (const token of String(text || "").split(",").map((item) => item.trim()).filter(Boolean)) {
    const exact = /^([2-9TJQKA][cdhs])([2-9TJQKA][cdhs])$/.exec(token);
    const live = exact ? [[exact[1], exact[2]]] : classes[token] || [];
    combos.push(...live);
    breakdown.push({ handClass: token, combos: live, liveCount: live.length, theoreticalCount: live.length });
  }
  return { combos, breakdown };
}
const result = guard.sanitizeLLMRangeInterpretation({
  interpretation: {
    street: "turn",
    streetSummaries: [
      { street: "preflop", rangeText: "22,33,44,KQs,AKo" },
      { street: "flop", rangeText: "22,33,44,KQs,AKo" },
      { street: "turn", rangeText: "22,44,KQs,AKo" },
    ],
  },
  parseRange,
  knownCardsThroughStreet: () => [],
  ceilings: [{ street: "flop", rangeText: "22,33,KQs" }],
});
const counts = plain(result.streetSummaries.map((item) => item.snapshot.combos));
assert.deepEqual(counts, [6, 4, 3]);
for (let index = 1; index < counts.length; index += 1) assert.ok(counts[index] <= counts[index - 1], "range must never grow");
assert.equal(result.streetSummaries[1].rangeText, "22,33,KQs");
assert.equal(result.streetSummaries[2].rangeText, "22,KQs");
assert.ok(result.caveats.some((caveat) => /flop range capped/.test(caveat)));

// No overlap at all: fall back to the earlier range rather than an empty one.
const disjoint = guard.sanitizeLLMRangeInterpretation({
  interpretation: { street: "flop", streetSummaries: [{ street: "preflop", rangeText: "22,33,44" }, { street: "flop", rangeText: "44" }] },
  parseRange,
  knownCardsThroughStreet: () => [],
  ceilings: [{ street: "flop", rangeText: "22" }],
});
assert.equal(disjoint.streetSummaries[1].snapshot.combos, 2);

// The shown range is what gets stored: a later (capped, narrower) result replaces the older one.
const relock = createStreetRangeLock();
relock.remember(flopSpot, "flop", "22,33,44,KQs");
relock.remember(flopSpot, "flop", "22,33");
assert.equal(relock.get(flopSpot, "flop").rangeText, "22,33");
assert.deepEqual(plain(relock.ceilings(turnSpot, "turn")), [{ street: "flop", rangeText: "22,33", unchanged: false }]);

// Only Hero acted since the earlier flop analysis (villain checked, Hero checked behind): villain's flop
// range can't have changed, and Hero's trailing actions aren't part of the line, so it's the very same
// remembered range - an exact lock, whichever decision was analyzed first.
const checkedBehind = {
  ...turnSpot,
  allStreetActions: {
    preflop,
    flop: [{ actor: "BB", action: "check", amount: "" }, { actor: "BTN", action: "check", amount: "" }],
    turn: [{ actor: "BB", action: "check", amount: "" }],
  },
};
assert.deepEqual(plain(relock.priorLocks(checkedBehind, "turn")), [{ street: "flop", rangeText: "22,33" }]);
assert.deepEqual(plain(relock.ceilings(checkedBehind, "turn")), []);
const early = createStreetRangeLock();
early.remember(checkedBehind, "flop", "22,KQs");
assert.equal(early.get(flopSpot, "flop").rangeText, "22,KQs", "flop decision reuses what the turn decision stored");
// Hero's bet that villain hasn't answered yet doesn't change villain's line either.
const heroBetPending = { ...flopSpot, allStreetActions: { preflop, flop: [{ actor: "BB", action: "check", amount: "" }, { actor: "BTN", action: "bet", amount: "2.8" }] } };
assert.equal(early.get(heroBetPending, "flop").rangeText, "22,KQs");

// Floors: a later point where villain DID act (check, bet, call) was analyzed first. The earlier point
// (after one check) must contain it.
const flopDecision = { ...flopSpot, street: "flop" };
const onlyCalled = createStreetRangeLock();
onlyCalled.remember(turnSpot, "flop", "KQs");
assert.deepEqual(plain(onlyCalled.floors(flopDecision, "flop")), [{ street: "flop", rangeText: "KQs", unchanged: false }]);
assert.deepEqual(plain(onlyCalled.floors(turnSpot, "flop")), [], "the exact line is a lock, not a floor");

// Guard: a model range that drops hands the later point kept gets them back (within the prior street).
const floored = guard.sanitizeLLMRangeInterpretation({
  interpretation: { street: "flop", streetSummaries: [{ street: "preflop", rangeText: "22,33,KQs" }, { street: "flop", rangeText: "33" }] },
  parseRange,
  knownCardsThroughStreet: () => [],
  floors: [{ street: "flop", rangeText: "22,KQs,AKo" }],
});
assert.equal(floored.streetSummaries[1].snapshot.combos, 4);
assert.equal(floored.streetSummaries[1].rangeText, "33,22,KQs");
assert.ok(floored.caveats.some((caveat) => /widened to include the 3 combos/.test(caveat)));

// Locks read when the response lands: another response for this hand already established the preflop
// and flop, so this one is made to agree even though its request went out before they existed.
const lockedLate = guard.sanitizeLLMRangeInterpretation({
  interpretation: {
    street: "turn",
    streetSummaries: [
      { street: "preflop", rangeText: "22,33,44,KQs,AKo" },
      { street: "flop", rangeText: "22,33,44" },
      { street: "turn", rangeText: "22,44" },
    ],
  },
  parseRange,
  knownCardsThroughStreet: () => [],
  locks: [{ street: "preflop", rangeText: "22,33,KQs" }, { street: "flop", rangeText: "22,KQs" }],
});
assert.deepEqual(plain(lockedLate.streetSummaries.map((item) => item.snapshot.combos)), [4, 3, 2]);
assert.equal(lockedLate.streetSummaries[0].rangeText, "22,33,KQs");
assert.equal(lockedLate.streetSummaries[1].rangeText, "22,KQs");
assert.ok(lockedLate.caveats.some((caveat) => /flop range kept as already established/.test(caveat)));

console.log("street range ceiling tests passed");

// An unreadable stage (text that parses to no combos) must not empty the streets after it.
const unreadable = guard.sanitizeLLMRangeInterpretation({
  interpretation: { street: "flop", streetSummaries: [{ street: "preflop", rangeText: "whatever villain likes" }, { street: "flop", rangeText: "22,KQs" }] },
  parseRange,
  knownCardsThroughStreet: () => [],
});
assert.deepEqual(plain(unreadable.streetSummaries.map((item) => item.snapshot.combos)), [0, 3]);
assert.ok(unreadable.caveats.some((caveat) => /could not be read/.test(caveat)));
console.log("unreadable-stage checks passed");

// The model answered with a preflop range and nothing for the flop: carry preflop forward instead of
// showing 0 combos and leaving the flop unlocked for the next decision to re-roll.
const missingFlop = guard.sanitizeLLMRangeInterpretation({
  interpretation: { street: "flop", streetSummaries: [{ street: "preflop", rangeText: "22,KQs" }] },
  parseRange,
  knownCardsThroughStreet: () => [],
});
assert.deepEqual(plain(missingFlop.streetSummaries.map((item) => item.snapshot.combos)), [3, 3]);
assert.equal(missingFlop.rangeText, "22,KQs");
assert.ok(missingFlop.caveats.some((caveat) => /missing from the model's answer/.test(caveat)));
console.log("missing-street checks passed");
