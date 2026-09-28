const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/importAnalysisPrefetchModel.js"), "utf8");
const sandbox = { window: {}, globalThis: {}, Promise, Map, Set };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: "importAnalysisPrefetchModel.js" });

const model = sandbox.PokerCoachImportAnalysisPrefetchModel;
assert.ok(model, "import analysis prefetch model should attach to global scope");

const isHeroAction = (_hand, action, heroName) => action.actor === heroName;
const hand = {
  streets: {
    preflop: { potBb: 6, actions: [{ actor: "Villain", action: "raise", amountBb: 3 }] },
    flop: {
      potBb: 10,
      actions: [
        { actor: "Hero", action: "check", amountBb: null },
        { actor: "Villain", action: "bet", amountBb: 5 },
        { actor: "Hero", action: "call", amountBb: 5 },
        { actor: "Villain", action: "call", amountBb: 5 },
      ],
    },
    turn: {
      potBb: 20,
      actions: [
        { actor: "Villain", action: "raise", amountBb: 30 },
        { actor: "Hero", action: "fold", amountBb: null },
      ],
    },
    river: { potBb: 80, actions: [{ actor: "Villain", action: "allin", amountBb: 70 }] },
  },
};

const ranked = model.rankImportedPostflopCandidates(hand, "Hero", isHeroAction);
assert.deepEqual(
  JSON.parse(JSON.stringify(ranked.map(({ street, index }) => `${street}:${index}`))),
  ["river:0", "turn:0"],
  "all-ins must outrank raises and the result must be capped at two",
);
assert.equal(ranked.some(({ street }) => street === "preflop"), false, "preflop points must not be prefetched");
assert.equal(
  ranked.some(({ street, index }) => street === "flop" && index === 3),
  false,
  "passive opponent actions must not be prefetched",
);

const betHand = {
  streets: {
    flop: { potBb: 10, actions: [{ actor: "Villain", action: "bet", amountBb: 5 }] },
    turn: { potBb: 10, actions: [{ actor: "Villain", action: "bet", amountBb: 15 }] },
    river: { potBb: 10, actions: [{ actor: "Hero", action: "check", amountBb: null }] },
  },
};
assert.deepEqual(
  JSON.parse(JSON.stringify(model.rankImportedPostflopCandidates(betHand, "Hero", isHeroAction).map(({ street }) => street))),
  ["turn", "flop"],
  "larger bet-to-pot ratios must rank first and ahead of first-to-act Hero decisions",
);

const multiwayHand = {
  streets: {
    flop: {
      potBb: 12,
      actions: [
        { actor: "Villain A", action: "bet", amountBb: 8 },
        { actor: "Villain B", action: "call", amountBb: 8 },
        { actor: "Hero", action: "fold", amountBb: null },
      ],
    },
  },
};
assert.deepEqual(
  JSON.parse(JSON.stringify(model.rankImportedPostflopCandidates(multiwayHand, "Hero", isHeroAction).map(({ index }) => index))),
  [2],
  "opponent pressure answered by another opponent is not the immediate Hero decision",
);

const singleDecisionHand = {
  streets: {
    flop: {
      potBb: 10,
      actions: [
        { actor: "Villain", action: "bet", amountBb: 8 },
        { actor: "Hero", action: "call", amountBb: 8 },
      ],
    },
  },
};
assert.deepEqual(
  JSON.parse(JSON.stringify(model.rankImportedPostflopCandidates(singleDecisionHand, "Hero", isHeroAction).map(({ index }) => index))),
  [0],
  "an opponent pressure row and Hero's immediate response must count as one decision",
);

const metadataLeadingHand = {
  streets: {
    flop: {
      potBb: 10,
      actions: [
        { actor: "Dealer", action: "refund", amountBb: 1 },
        { actor: "Hero", action: "check", amountBb: null },
        { actor: "Hero", action: "bet", amountBb: 4 },
      ],
    },
  },
};
assert.deepEqual(
  JSON.parse(JSON.stringify(model.rankImportedPostflopCandidates(metadataLeadingHand, "Hero", isHeroAction).map(({ index, priority }) => [index, priority]))),
  [[1, 4], [2, 5]],
  "the first actionable Hero row must receive first-to-act priority even after metadata",
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

(async () => {
  const jobs = new Map([
    ["first", deferred()],
    ["second", deferred()],
    ["third", deferred()],
  ]);
  const started = [];
  const statuses = [];
  const queue = model.createImportAnalysisPrefetchQueue({
    worker(entry) {
      started.push(entry.key);
      return jobs.get(entry.key).promise;
    },
    onStatusChange(change) {
      statuses.push(`${change.key}:${change.status}`);
    },
  });

  queue.replace([
    { key: "first", street: "flop", index: 0 },
    { key: "second", street: "turn", index: 0 },
    { key: "second", street: "turn", index: 0 },
    { key: "third", street: "river", index: 0 },
  ]);
  assert.deepEqual(started, ["first"], "the queue must run only one job at a time");
  assert.equal(queue.status("first"), "running");
  assert.equal(queue.status("second"), "queued");
  assert.ok(queue.promiseFor("first") instanceof Promise);

  queue.promote("third");
  jobs.get("first").resolve("ready");
  await queue.promiseFor("first");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["first", "third"], "promotion must change the next queued job");

  jobs.get("third").reject(new Error("provider unavailable"));
  await queue.promiseFor("third").catch(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["first", "third", "second"], "a failed job must not stop the queue");
  jobs.get("second").resolve("ready");
  await queue.promiseFor("second");
  assert.equal(queue.status("second"), "completed");
  assert.ok(statuses.includes("third:failed"));

  const stale = deferred();
  const replacement = deferred();
  const replacementStarts = [];
  const replacementQueue = model.createImportAnalysisPrefetchQueue({
    worker(entry) {
      replacementStarts.push(entry.key);
      return entry.key === "stale" ? stale.promise : replacement.promise;
    },
  });
  replacementQueue.replace([{ key: "stale" }]);
  replacementQueue.replace([{ key: "replacement" }]);
  assert.deepEqual(
    replacementStarts,
    ["stale"],
    "a replacement generation must not overlap an obsolete in-flight job",
  );
  stale.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(replacementStarts, ["stale", "replacement"]);
  replacement.resolve();
  await replacementQueue.promiseFor("replacement");

  console.log("import analysis prefetch model checks passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
