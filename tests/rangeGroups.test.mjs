import assert from "node:assert/strict";
import { applyGuardrailFixes, checkGroupDecisions, checkListSummary, codeListSummary, classifyCombo, groupRangeByBoard, parseRangeCombos, rangeTextFromCombos, villainLine } from "../src/analysis/rangeGroups.js";
import { runLLMRangeInterpreter, validateRangeGroupDecisions } from "../src/analysis/pipeline.js";

// Facts are per combo: on 8s 3s Th Js the three live T9s combos are three different hands.
const turnBoard = ["8s", "3s", "Th", "Js"];
assert.deepEqual(classifyCombo(["Tc", "9c"], turnBoard), { made: "second pair", draw: "open-ended straight draw", key: "second pair|open-ended straight draw" });
assert.equal(classifyCombo(["Ts", "9s"], turnBoard).made, "flush", "two spades on a three-spade board is a made flush, not a draw");
assert.equal(classifyCombo(["7c", "7s"], turnBoard).draw, "combo draw", "one spade plus the open-ender is a combo draw");
assert.equal(classifyCombo(["9c", "8c"], turnBoard).draw, "open-ended straight draw", "98s without a spade has no flush draw");
assert.equal(classifyCombo(["Ah", "Kh"], turnBoard).draw, "gutshot");
assert.equal(classifyCombo(["8c", "8d"], turnBoard).made, "set");
assert.equal(classifyCombo(["Kh", "Qh"], ["Ah", "Jh", "Tc"]).made, "straight");
assert.equal(classifyCombo(["7h", "2h"], ["Ah", "Jh", "Tc"]).draw, "flush draw");
assert.equal(classifyCombo(["Kh", "2h"], ["Ah", "Jh", "Tc"]).draw, "combo draw", "nut flush draw plus the Q gutshot");
assert.equal(classifyCombo(["Kc", "Qc"], ["Ah", "Jh", "Th"]).draw, "", "KQ already made the straight; no straight draw is reported on top");
assert.equal(classifyCombo(["Kh", "Qc"], ["Ah", "Jh", "Th"]).draw, "nut flush draw", "a made straight can still hold a flush draw");
// A four-flush on the board alone is nobody's draw.
assert.equal(classifyCombo(["Kc", "7d"], ["2h", "5h", "9h", "Jh"]).draw, "");
assert.equal(classifyCombo(["2c", "3d"], ["Ah", "Kh", "Qh", "Jh", "Th"]).made, "plays the board");

// rangeText rebuilt from combos re-parses to exactly those combos under the same dead cards.
const dead = ["As", "3h", ...turnBoard];
const some = parseRangeCombos("T9s,88,AKo", dead).filter(([a]) => a !== "Tc");
const text = rangeTextFromCombos(some, dead);
assert.deepEqual(new Set(parseRangeCombos(text, dead).map((combo) => combo.join(""))), new Set(some.map((combo) => combo.join(""))));
assert.match(text, /Td9d/, "a partial class is written as exact combos");
assert.match(text, /\b88\b/, "a complete class is written by name");

const groups = groupRangeByBoard(parseRangeCombos("88,T9s,98s,87s,JTo", dead), turnBoard);
assert.equal(groups[0].label, "flush", "groups are ordered strongest first");
assert.ok(groups.every((group, index) => group.id === `G${index + 1}`));

// Validation rejects answers the code cannot turn into a range.
const ids = ["G1", "G2"];
assert.equal(validateRangeGroupDecisions({ text: '{"decisions":[{"group":"G1","decision":"keep","why":"x"}]}' }, ids).valid, true);
assert.equal(validateRangeGroupDecisions({ text: '{"decisions":[{"group":"G9","decision":"keep"}]}' }, ids).valid, false, "unknown group id");
assert.equal(validateRangeGroupDecisions({ text: '{"decisions":[{"group":"G1","decision":"drop"}]}' }, ids).valid, false, "dropping everything");
assert.equal(validateRangeGroupDecisions({ text: '{"decisions":[{"group":"G1","decision":"mixed"}]}' }, ids).valid, false);

// End to end with a stubbed model: locked preflop and flop, one grouped call for the turn.
const prompts = [];
const result = await runLLMRangeInterpreter(
  {
    spot: {
      street: "turn",
      heroPosition: "BTN",
      villainPosition: "BB",
      heroHand: "As 3h",
      board: "8s 3s Th Js",
      allStreetActions: {
        preflop: [{ actor: "BTN", action: "raise", amount: 2.5 }, { actor: "BB", action: "call", amount: 2.5 }],
        flop: [{ actor: "BB", action: "check" }, { actor: "BTN", action: "bet", amount: 2.8 }, { actor: "BB", action: "call", amount: 2.8 }],
        turn: [{ actor: "BB", action: "check" }, { actor: "BTN", action: "bet", amount: 3.7 }, { actor: "BB", action: "raise", amount: 9.9 }],
      },
      lockedPreflopRange: { rangeText: "22+,T9s,98s,87s,JTs,JTo" },
      lockedPriorStreetRanges: [{ street: "flop", rangeText: "22-99,T9s,98s,87s,JTs,JTo" }],
    },
    math: {},
    rootDir: process.cwd(),
    config: { rangeGroupDecisions: true },
  },
  {
    callProvider: async ({ prompt, validate }) => {
      prompts.push(prompt);
      const table = [...prompt.matchAll(/^(G\d+) \| ([^|]+) \|/gm)].map(([, id, label]) => ({ id, label: label.trim() }));
      const decisions = table.map(({ id, label }) => ({
        group: id,
        decision: /set|two pair|flush|combo draw/.test(label) ? "keep" : "drop",
        why: `${label} reason`,
      }));
      const reply = { text: JSON.stringify({ decisions, actionsOnStreet: "check-raise", summary: "Strong.", confidence: "medium" }) };
      assert.equal(validate(reply).valid, true);
      return { ...reply, provider: "test", model: "stub" };
    },
  },
);
assert.equal(prompts.length, 1, "locked preflop and flop need no model call; only the turn is decided");
assert.match(prompts[0], /T9s \(Tc9c Td9d\)/, "the model sees exact combos for partial classes");
const turn = result.rangeInterpretation.streetSummaries.find((item) => item.street === "turn");
const turnCombos = new Set(parseRangeCombos(turn.rangeText, dead).map((combo) => combo.join("")));
assert.ok(turnCombos.has("Ts9s") && !turnCombos.has("Tc9c"), "T9s is split by suit: the flush stays, the pair + open-ender goes");
assert.ok(turnCombos.has("8c8d") && turnCombos.has("7c7s") && !turnCombos.has("7c7d"));
assert.match(turn.narrowing.kept, /pocket pair below top card \+ combo draw – 77 \(7c7s 7d7s 7h7s\)/);
assert.doesNotMatch(turn.narrowing.kept, /Tc9c/, "Kept never names a combo that is not in the range");
assert.match(turn.narrowing.removed, /Tc9c/);
const flop = result.rangeInterpretation.streetSummaries.find((item) => item.street === "flop");
assert.equal(flop.rangeText, "22-99,T9s,98s,87s,JTs,JTo", "a locked street keeps its text");
assert.match(flop.narrowing.removed, /overpair – JJ, QQ, KK, AA/, "a locked street still explains what it removed");
assert.ok(turn.narrowing.keptGroups.length && turn.narrowing.keptGroups.every((group) => group.why && group.label && group.combos > 0 && group.hands));
assert.equal(turn.narrowing.keptGroups.reduce((sum, group) => sum + group.combos, 0), turnCombos.size, "Kept rows add up to the range");
assert.ok(turn.narrowing.removedGroups.some((group) => group.hands.includes("Tc9c") && /reason$/.test(group.why)));
assert.ok(result.rangeInterpretation.caveats.some((line) => /flop: .*no per-group reasons/.test(line)), "a lock without stored reasons says so");

// A lock that carries its reasons shows them instead of an unexplained split.
const storedNarrowing = { actionsOnStreet: "check, call", keptGroups: [{ label: "set", role: "strong value", combos: 4, hands: "33, 88", why: "stored reason" }], removedGroups: [] };
const relocked = await runLLMRangeInterpreter(
  {
    spot: { ...result.debug.spot, lockedPriorStreetRanges: [{ street: "flop", rangeText: "22-99,T9s,98s,87s,JTs,JTo", narrowing: storedNarrowing, reasoning: "stored summary" }] },
    math: {},
    rootDir: process.cwd(),
    config: { rangeGroupDecisions: true },
  },
  { callProvider: async ({ prompt }) => ({ text: JSON.stringify({ decisions: [...prompt.matchAll(/^(G\d+) \|/gm)].map(([, id]) => ({ group: id, decision: "keep", why: "k" })) }), provider: "t", model: "m" }) },
);
const relockedFlop = relocked.rangeInterpretation.streetSummaries.find((item) => item.street === "flop");
assert.deepEqual(relockedFlop.narrowing, storedNarrowing);
assert.equal(relockedFlop.reasoning, "stored summary");

const strong = result.rangeInterpretation.weightedGroups.find((group) => group.label === "strong value");
assert.ok(parseRangeCombos(strong.rangeText, dead).length > 0);
assert.equal(result.rangeInterpretation.rangeText, turn.rangeText);

// Flag off keeps the old single-call path.
let oldPathCalls = 0;
await runLLMRangeInterpreter(
  { spot: { street: "flop", heroHand: "As 3h", board: "8s 3s Th" }, math: {}, rootDir: process.cwd(), config: {} },
  { callProvider: async () => { oldPathCalls += 1; return { text: JSON.stringify({ street: "flop", rangeText: "22+", streetSummaries: [{ street: "flop", rangeText: "22+" }] }), provider: "t", model: "m" }; } },
);
assert.equal(oldPathCalls, 1);

// Guardrails.
assert.equal(villainLine([{ actor: "BB", action: "check" }, { actor: "BTN", action: "bet" }, { actor: "BB", action: "raise" }], "BB"), "raise");
assert.equal(villainLine([{ actor: "BB", action: "check" }, { actor: "BTN", action: "bet" }, { actor: "BB", action: "call" }], "BB"), "call");
assert.equal(villainLine([{ actor: "BTN", action: "bet" }], "BB"), "none");
const guardGroups = [
  { id: "G1", made: "flush", draw: "", label: "flush" },
  { id: "G2", made: "no pair", draw: "", label: "no pair" },
  { id: "G3", made: "no pair", draw: "gutshot", label: "gutshot (no pair)" },
];
const raiseDrop = checkGroupDecisions(guardGroups, [{ group: "G1", decision: "drop", why: "x" }], "raise");
assert.equal(raiseDrop[0].fix, "keep");
assert.equal(checkGroupDecisions(guardGroups, [{ group: "G2", decision: "keep", why: "floats" }], "call")[0].fix, "drop");
assert.deepEqual(checkGroupDecisions(guardGroups, [{ group: "G3", decision: "keep", why: "Gutshot has equity to call." }], "call"), [], "a draw may call");
assert.equal(checkGroupDecisions(guardGroups, [{ group: "G1", decision: "keep", why: "Flush draws have equity." }], "raise")[0].fix, null, "made flush described as a draw");
assert.deepEqual(checkGroupDecisions(guardGroups, [{ group: "G2", decision: "drop", why: "No pair and no draw folds." }], "call"), []);
const fixed = applyGuardrailFixes([{ group: "G1", decision: "drop", why: "x" }], raiseDrop);
assert.equal(fixed[0].decision, "keep");
assert.match(fixed[0].why, /^Kept by rule/);

// In the pipeline: a bad answer gets one retry carrying the errors; if the retry is still wrong, code fixes it.
const guardPrompts = [];
const guarded = await runLLMRangeInterpreter(
  { spot: { ...result.debug.spot, lockedPriorStreetRanges: [{ street: "flop", rangeText: "22-99,T9s,98s,87s,JTs,JTo" }] }, math: {}, rootDir: process.cwd(), config: { rangeGroupDecisions: true } },
  {
    callProvider: async ({ prompt }) => {
      guardPrompts.push(prompt);
      const table = [...prompt.matchAll(/^(G\d+) \| ([^|]+) \|/gm)].map(([, id, label]) => ({ id, label: label.trim() }));
      // Drops the made flush on a check-raise both times.
      const decisions = table.map(({ id, label }) => ({ group: id, decision: label === "flush" ? "drop" : "keep", why: `${label} ok` }));
      return { text: JSON.stringify({ decisions }), provider: "t", model: "m" };
    },
  },
);
assert.equal(guardPrompts.length, 2, "one retry");
assert.match(guardPrompts[1], /It broke these rules[\s\S]*\(flush\): villain raised/);
const guardedTurn = guarded.rangeInterpretation.streetSummaries.find((item) => item.street === "turn");
assert.ok(new Set(parseRangeCombos(guardedTurn.rangeText, dead).map((combo) => combo.join(""))).has("Ts9s"), "the flush is back in the range");
assert.match(guardedTurn.narrowing.keptGroups.find((group) => group.label === "flush").why, /^Kept by rule/);
assert.equal(guarded.debug.guardrails[0].line, "raise");
assert.ok(guarded.rangeInterpretation.caveats.some((line) => /corrected by poker-logic rules/.test(line)));

// Summaries: the model's stand when they name the right list; otherwise one retry, then code writes them.
assert.match(turn.narrowing.keptSummary, /^Kept .*\(\d+ combos\)\.$/, "no model summary -> code summary");
assert.equal(guardedTurn.narrowing.keptSummary.startsWith("Kept "), true, "a rule flip replaces the model's summary");
assert.deepEqual(checkListSummary("Keeps sets.", [{ label: "set" }], [{ label: "no pair" }], "kept"), []);
assert.equal(checkListSummary("Keeps sets.", [{ label: "no pair" }], [{ label: "set" }], "kept").length, 1);
assert.equal(codeListSummary([{ label: "set", combos: [1, 2] }], "Removed"), "Removed set (2 combos).");
const summaryPrompts = [];
const summarized = await runLLMRangeInterpreter(
  { spot: { ...result.debug.spot, lockedPriorStreetRanges: [{ street: "flop", rangeText: "22-99,T9s,98s,87s,JTs,JTo" }] }, math: {}, rootDir: process.cwd(), config: { rangeGroupDecisions: true } },
  {
    callProvider: async ({ prompt }) => {
      summaryPrompts.push(prompt);
      const table = [...prompt.matchAll(/^(G\d+) \| ([^|]+) \|/gm)].map(([, id, label]) => ({ id, label: label.trim() }));
      const decisions = table.map(({ id, label }) => ({ group: id, decision: /flush|set|two pair|combo draw|straight$/.test(label) ? "keep" : "drop", why: "ok" }));
      // First answer claims the removed list includes sets; the retry fixes it.
      const removedSummary = summaryPrompts.length === 1 ? "Removes sets and weak pairs." : "Removes weak pairs and gutshots that would just call.";
      return { text: JSON.stringify({ decisions, keptSummary: "Keeps flushes, sets and combo draws for value and equity.", removedSummary }), provider: "t", model: "m" };
    },
  },
);
assert.equal(summaryPrompts.length, 2);
assert.match(summaryPrompts[1], /removedSummary names set/);
const summarizedTurn = summarized.rangeInterpretation.streetSummaries.find((item) => item.street === "turn");
assert.equal(summarizedTurn.narrowing.keptSummary, "Keeps flushes, sets and combo draws for value and equity.");
assert.equal(summarizedTurn.narrowing.removedSummary, "Removes weak pairs and gutshots that would just call.");

// Checking first to act narrows nothing: the range carries over (minus new-card blockers) with no model call.
assert.equal(villainLine([{ actor: "BB", action: "check" }], "BB"), "check-first");
assert.equal(villainLine([{ actor: "BTN", action: "check" }, { actor: "BB", action: "check" }], "BB"), "check", "checking behind is informative");
let riverCalls = 0;
const turnLock = { street: "turn", rangeText: "Jc9s,Jd9s,Jh9s,9c8c,9d8d,Qs8c,8c7c,8h7h" };
const river = await runLLMRangeInterpreter(
  {
    spot: {
      ...result.debug.spot,
      street: "river",
      board: "8s 3s Th Js 8h",
      allStreetActions: { ...result.debug.spot.allStreetActions, river: [{ actor: "BB", action: "check", amount: 0 }] },
      lockedPriorStreetRanges: [{ street: "flop", rangeText: "22-99,T9s,98s,87s,JTs,JTo" }, turnLock],
    },
    math: {},
    rootDir: process.cwd(),
    config: { rangeGroupDecisions: true },
  },
  { callProvider: async () => { riverCalls += 1; throw new Error("no model call expected"); } },
);
assert.equal(riverCalls, 0);
const riverDead = ["As", "3h", "8s", "3s", "Th", "Js", "8h"];
assert.deepEqual(
  new Set(parseRangeCombos(river.rangeInterpretation.rangeText, riverDead).map((combo) => combo.join(""))),
  new Set(["Jc9s", "Jd9s", "Jh9s", "9c8c", "9d8d", "Qs8c", "8c7c"]),
  "only the 8h combo drops out",
);
assert.match(river.rangeInterpretation.streetSummaries.at(-1).narrowing.keptSummary, /checked first/);

console.log("rangeGroups tests passed");
