import assert from "node:assert/strict";
import { applyFocusedBoardVerification, buildFocusedBoardPrompt } from "../src/analysis/pipeline.js";
import { boardCropRegion } from "../src/analysis/heroCardCrop.js";

const hand = { heroHand: ["3d", "As"], board: { flop: ["8s", "3s", "Ts"], turn: "Js", river: "8h" } };

const fixed = applyFocusedBoardVerification(hand, { board: ["8s", "3s", "Th", "Js", "8h"] });
assert.deepEqual(fixed.hand.board, { flop: ["8s", "3s", "Th"], turn: "Js", river: "8h" });
assert.deepEqual(fixed.decision.changes, [{ from: "Ts", to: "Th" }]);

assert.equal(applyFocusedBoardVerification(hand, { board: ["8s", "3s", "Ts", "Js", "8h"] }).decision.reason, "agrees");
assert.equal(applyFocusedBoardVerification(hand, { board: ["9s", "3s", "Th", "Js", "8h"] }).decision.reason, "rank-mismatch");
assert.equal(applyFocusedBoardVerification(hand, { board: ["8s", "3s", "Th"] }).decision.reason, "unusable-crop-read");
assert.equal(applyFocusedBoardVerification(hand, { board: ["8s", "3s", "Th", "Js", "As"] }).decision.reason, "rank-mismatch");
assert.equal(applyFocusedBoardVerification({ ...hand, heroHand: ["3h", "As"] }, { board: ["8s", "3s", "Th", "Js", "8h"] }).hand.board.flop[2], "Th", "no collision, applies");
assert.equal(applyFocusedBoardVerification({ ...hand, heroHand: ["Th", "As"] }, { board: ["8s", "3s", "Th", "Js", "8h"] }).decision.reason, "collides-with-hero");

assert.doesNotMatch(buildFocusedBoardPrompt(), /8s|Th/);
const r = boardCropRegion({ width: 1040, height: 1410 });
assert.ok(r.left + r.width <= 1040 && r.top + r.height <= 1410);
console.log("focused board verification tests passed");

// Hand-History-1790438742868: the broad read spelled tens "10s" (and got two suits wrong, leaving a
// duplicate Ts). The crop read was right but got rejected as a rank mismatch ("1" vs "T").
{
  const tens = applyFocusedBoardVerification(
    { heroHand: ["Kh", "8h"], board: { flop: ["Ks", "Qs", "7s"], turn: "10s", river: "10s" } },
    { board: ["Ks", "Qs", "7c", "Tc", "Ts"] },
  );
  assert.equal(tens.decision.applied, true);
  assert.deepEqual(tens.hand.board, { flop: ["Ks", "Qs", "7c"], turn: "Tc", river: "Ts" });
  console.log("focused board ten-notation check passed");
}
