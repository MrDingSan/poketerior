import assert from "node:assert/strict";
import { runTexasSolver } from "../src/solver/texasSolverAdapter.js";

const result = await runTexasSolver({
  spot: {
    street: "river",
    heroPosition: "BTN",
    villainPosition: "BB",
    heroHand: "Jc 7c",
    board: "5s Jd 2s 7h Kd",
    facingAllIn: true,
    legalActions: ["Fold", "Call"],
    streetActions: [{ actor: "BB", action: "allin", amount: 23.63 }],
  },
  math: {
    facingAllIn: true,
    legalActions: ["Fold", "Call"],
    pot: 52.75,
    call: 23.63,
    rangeText: "22,AJs",
  },
  config: {
    texasSolverBinary: "/definitely/not/needed",
    texasSolverResources: "/definitely/not/needed",
  },
});

assert.equal(result.ok, false);
assert.equal(result.skipped, true);
assert.deepEqual(result.legalActions, ["Fold", "Call"]);
assert.match(result.error, /facing an all-in/i);
assert.equal(["Bet", "Raise", "Check"].includes(result.recommendedAction), false);

console.log("TexasSolver all-in policy regression checks passed");
