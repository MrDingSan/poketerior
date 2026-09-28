import assert from "node:assert/strict";
import { deriveHeroHandFacts } from "../src/analysis/handFacts.js";

assert.deepEqual(
  deriveHeroHandFacts({ heroHand: "Ah Jh", board: "Tc 9c 4s" }),
  {
    madeHand: "ace-high",
    overcards: ["A", "J"],
    directStraightDraw: "none",
    directFlushDraw: "none",
    backdoorStraightDraw: true,
    backdoorFlushDraw: false,
    summary: "Ace-high with two overcards; no direct straight draw; no direct flush draw; backdoor straight possibilities only.",
  },
);

assert.equal(
  deriveHeroHandFacts({ heroHand: "Ah Jd", board: "Kc Tc 2s" }).directStraightDraw,
  "gutshot",
);
assert.equal(
  deriveHeroHandFacts({ heroHand: "8h 7d", board: "6c 5s Kd" }).directStraightDraw,
  "open-ended",
);
assert.equal(
  deriveHeroHandFacts({ heroHand: "Ah Qh", board: "Th 4h 2c" }).directFlushDraw,
  "heart flush draw",
);
assert.equal(
  deriveHeroHandFacts({ heroHand: "Ah Jd", board: "Jc 9c 4s" }).madeHand,
  "pair of jacks",
);

console.log("handFacts tests passed");
