const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/preflopRangeLock.js"), "utf8"), sandbox);
const { createPreflopRangeLock, lockKey } = sandbox.globalThis.PokerCoachPreflopRangeLock;

const line = [{ actor: "UTG", action: "open", amount: 2.5 }, { actor: "SB", action: "call", amount: 2.5 }];
const flopSpot = { rangeMode: "loose", heroPosition: "SB", villainPosition: "UTG", heroHand: "Ts Th", street: "flop", preflopActions: line };
const turnSpot = { ...flopSpot, heroHand: "Ah Kh", street: "turn", board: "8h 2s Qh 3c" };

assert.equal(lockKey(flopSpot), lockKey(turnSpot), "later streets and different hero cards share villain's preflop lock");
assert.notEqual(lockKey(flopSpot), lockKey({ ...flopSpot, rangeMode: "tight" }), "opponent profile changes the lock");
assert.notEqual(lockKey(flopSpot), lockKey({ ...flopSpot, preflopActions: [{ actor: "UTG", action: "open", amount: 3 }] }));
assert.equal(lockKey({ ...flopSpot, preflopActions: [] }), null, "no preflop line means nothing to lock");

const store = {};
const storage = { getItem: (key) => store[key] ?? null, setItem: (key, value) => { store[key] = value; } };
const lock = createPreflopRangeLock({ storage });
assert.equal(lock.get(flopSpot), null);
assert.equal(lock.remember(flopSpot, "22+,A2s+,KTs+", { percent: 17 }), true);
assert.equal(lock.remember(flopSpot, "AA", {}), false, "the first accepted range stays locked");
assert.equal(lock.get(turnSpot).rangeText, "22+,A2s+,KTs+");
assert.equal(createPreflopRangeLock({ storage }).get(turnSpot).rangeText, "22+,A2s+,KTs+", "locks survive a reload in the same session");
assert.equal(lock.forget(turnSpot), true);
assert.equal(lock.get(flopSpot), null);

const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
const memoryOnly = createPreflopRangeLock({ storage: blocked });
assert.equal(memoryOnly.remember(flopSpot, "QQ+"), true, "blocked storage still locks in memory");
assert.equal(memoryOnly.get(flopSpot).rangeText, "QQ+");

console.log("preflop range lock checks passed");
