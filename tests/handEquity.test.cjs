const assert = require("node:assert/strict");
require("../public/handEquity.js");

const { score, equityVsCombo, rangeMatchups } = globalThis.PokerCoachHandEquity;

// Hand ranking basics.
const board = ["2c", "7d", "9h", "Tc", "Js"];
assert.ok(score(["Kd", "Qh", ...board]) > score(["Ah", "Ad", ...board]), "a straight beats aces");
assert.ok(score(["Kd", "Qh", ...board]) > score(["8c", "8d", ...board]), "the K-high straight beats the J-high one (7-8-9-T-J)");
assert.equal(score(["3c", "4d", "Ah", "Kh", "Qh", "Jh", "Th"]), score(["5c", "6d", "Ah", "Kh", "Qh", "Jh", "Th"]), "both play a royal board");
assert.ok(score(["Ac", "Ad", "As", "5h", "5d", "2c", "3h"]) > score(["Kc", "Kd", "Ks", "Qh", "Qd", "2c", "3h"]), "full houses compare by trips");
assert.ok(score(["Ah", "2d", "3h", "4c", "5c", "9d", "Ks"]) > score(["Ah", "Kd", "Ks", "Kh", "5c", "9d", "2s"]), "a wheel straight beats trips");

// River: one board, equity is 1, 0 or a split.
assert.equal(equityVsCombo(["Ah", "Ad"], ["Kc", "Ks"], ["2c", "7d", "9h", "Tc", "3s"]).equity, 1);
assert.equal(equityVsCombo(["Kd", "Qh"], ["Kc", "Qs"], board).equity, 0.5);

// Turn: exact over the 44 rivers. AA vs KK on 2c 7d 9h Tc loses only to the two remaining kings.
const turn = equityVsCombo(["Ah", "Ad"], ["Kc", "Ks"], ["2c", "7d", "9h", "Tc"]);
assert.equal(turn.exact, true);
assert.equal(turn.equity, 42 / 44);

// Flop: exact over all 990 turn+river pairs, so repeated calls agree to the last digit.
const flopA = equityVsCombo(["Ah", "Ad"], ["Kc", "Ks"], ["2c", "7d", "9h"]);
const flopB = equityVsCombo(["Ah", "Ad"], ["Kc", "Ks"], ["2c", "7d", "9h"]);
assert.equal(flopA.exact, true);
assert.equal(flopA.equity, flopB.equity);
assert.ok(flopA.equity > 0.88 && flopA.equity < 0.94);

// Buckets: behind-but-live vs drawing dead are told apart, averages and the price line come from the same numbers.
const hero = ["As", "3h"];
const turnBoard = ["8s", "3s", "Th", "Js"];
const matchups = rangeMatchups(hero, [["Qc", "9c"], ["8c", "8d"], ["2d", "2h"], ["Kd", "Qd"]], turnBoard, { potOdds: 0.2 });
assert.equal(matchups.exact, true);
assert.deepEqual(matchups.buckets.ahead.map((item) => item.combo.join("")).sort(), ["2d2h", "KdQd"], "a pair of threes is ahead of deuces and of KQ's straight draw");
assert.ok(matchups.buckets.live.some((item) => item.combo.join("") === "8c8d"), "vs a set, the nut flush draw is behind but live");
assert.ok(matchups.buckets.live.every((item) => item.equity >= 0.1 && item.equity < 0.45));
const qc9c = [...matchups.buckets.live, ...matchups.buckets.thin].find((item) => item.combo.join("") === "Qc9c");
assert.ok(qc9c, "vs a made straight Hero is behind");
const all = Object.values(matchups.buckets).flat();
assert.equal(all.length, 4);
assert.ok(Math.abs(matchups.equity - all.reduce((sum, item) => sum + item.equity, 0) / 4) < 1e-12, "range equity is the mean of the combos");
assert.equal(matchups.priced, all.filter((item) => item.equity >= 0.2).length);

// Combos blocked by known cards are ignored.
assert.equal(rangeMatchups(hero, [["As", "Kd"], ["Kc", "Kd"]], turnBoard).total, 1);

console.log("hand equity tests passed");
