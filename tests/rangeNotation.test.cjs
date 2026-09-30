const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/rangeNotation.js"), "utf8"), sandbox);
const { expandToken, parseRange, rangeWidth } = sandbox.globalThis.PokerCoachRangeNotation;
const classes = (token) => {
  const expanded = expandToken(token);
  return expanded ? [...expanded].map((item) => (item.combo ? item.combo.join("") : item)).sort() : null;
};

assert.deepEqual(classes("98s-54s"), ["54s", "65s", "76s", "87s", "98s"], "connector runs expand along the diagonal");
assert.deepEqual(classes("54s-T9s"), ["54s", "65s", "76s", "87s", "98s", "T9s"]);
assert.deepEqual(classes("64s-97s"), ["64s", "75s", "86s", "97s"], "one-gapper runs keep their gap");
assert.deepEqual(classes("KQs-KTs"), ["KJs", "KQs", "KTs"], "same-top-card dashes are kicker ranges");
assert.equal(classes("Kxs+").length, 11, "Kxs+ means every suited king");
assert.deepEqual(classes("Kxs"), classes("K2s+"));
assert.deepEqual(classes("AK"), ["AKo", "AKs"], "a bare hand class means suited and offsuit");
assert.deepEqual(classes("AQ+"), ["AKo", "AKs", "AQo", "AQs"], "AQ+ is not a pair range");
assert.deepEqual(classes("T9s+"), ["T9s"], "+ after a non-pair raises only the kicker");
assert.deepEqual(classes("22+").length, 13);
assert.deepEqual(classes("TT-77"), ["77", "88", "99", "TT"]);
assert.deepEqual(classes("AhKh"), ["AhKh"]);
assert.equal(classes("broadways"), null);

const parsed = parseRange("22+, Kxs+, 98s-54s, suited Kx, AK", ["Ts", "Th"]);
assert.deepEqual([...parsed.unrecognized], ["suited Kx"], "unknown tokens are reported, not silently dropped");
assert.ok(parsed.classes.includes("K2s") && parsed.classes.includes("54s") && parsed.classes.includes("AKo"));
assert.equal(parsed.breakdown.find((item) => item.handClass === "TT").liveCount, 1, "hero's two tens leave only TcTd");

// Live Nemotron UTG opens that the old parser misread or that should be flagged as implausibly wide.
assert.equal(rangeWidth("22+,A2s+,Kxs+,Qxs+,Jxs+,T9s-T5s,98s-54s,87s-43s,76s-32s,65s,AKo-ATo,KJo-KTo,QJo,JTo").combos, 390);
assert.equal(rangeWidth("22+,A2s+,K2s+,Q2s+,J2s+,T2s+,92s+,82s+,72s+,62s+,52s+,42s+,32s+,A2o+,K2o+,Q2o+,J2o+,T2o+,92o+,82o+,72o+,62o+,52o+,42o+,32o+").percent, 100);
assert.equal(Math.round(rangeWidth("22+,A2s+,KTs+,QTs+,JTs,T9s,98s,87s,76s,65s,54s,43s,32s,AJo+,KQo").percent), 17);

console.log("range notation checks passed");

// A big blind checking its option in a limped pot came back as "all hands"; unparsed, it read as zero
// combos and emptied every later street. Words for an unrestricted range mean every starting hand.
for (const words of ["all hands", "any two", "Any Two Cards", "random", "100%"]) {
  const parsed = parseRange(words, []);
  assert.equal(parsed.combos.length, 1326, words);
  assert.equal(parsed.classes.length, 169, words);
  assert.deepEqual([...parsed.unrecognized], [], words);
}
assert.equal(parseRange("allin", []).combos.length, 0, "only whole-token matches");
console.log("unrestricted-range word checks passed");
