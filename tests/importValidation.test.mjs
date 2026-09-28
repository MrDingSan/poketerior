import assert from "node:assert/strict";
import { normalizeAndValidateImportedCards } from "../src/analysis/importValidation.js";

{
  const result = normalizeAndValidateImportedCards({
    heroHand: ["9s", "9h"],
    board: {
      flop: ["Th", "6s", "5d", "7s", "Jc"],
      turn: "9h",
      river: "9h",
    },
  });

  assert.deepEqual(result.hand.heroHand, ["9s", "9h"]);
  assert.deepEqual(result.hand.board, {
    flop: ["Th", "6s", "5d"],
    turn: "7s",
    river: "Jc",
  });
  assert.match(result.notes.join(" "), /split.*five-card/i);
}

{
  const result = normalizeAndValidateImportedCards({
    heroHand: ["Ad", "Kd"],
    board: { flop: ["Th", "6s", "5d"], turn: "7s", river: "7s" },
  });
  assert.match(result.warnings.join(" "), /duplicate community card 7s/i);
}

{
  const result = normalizeAndValidateImportedCards({
    site: "CoinPoker",
    heroHand: ["7h", "Ah"],
    board: { flop: ["Ah", "2c", "6c"], turn: "3s", river: "Jh" },
  });

  assert.deepEqual(result.hand.heroHand, ["7d", "Ad"]);
  assert.match(result.notes.join(" "), /coinpoker.*heart.*diamond/i);
}

{
  const result = normalizeAndValidateImportedCards({
    heroHand: ["Ad", "Kd"],
    board: { flop: ["Ad", "6s", "5d"], turn: null, river: null },
  });
  assert.match(result.warnings.join(" "), /appears in both hero hand and community board/i);
}

assert.throws(
  () =>
    normalizeAndValidateImportedCards({
      heroHand: ["Ad"],
      board: { flop: ["Th", "6s", "5d"], turn: null, river: null },
    }),
  /exactly two hero hole cards/i,
);

console.log("importValidation tests passed");
