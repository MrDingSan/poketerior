const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/import-engine/fallback/client.js"), "utf8"), sandbox, { filename: "client.js" });
const api = sandbox.PokerCoachImportFallback;
assert.ok(api, "PokerCoachImportFallback must be attached");
const plain = (value) => JSON.parse(JSON.stringify(value));

const SOURCE = { image: { tag: "img" }, width: 1280, height: 2022 };
const REGION = { x: 0.5, y: 0.5, width: 0.1, height: 0.05 };

function harness(overrides = {}) {
  const posts = [];
  const crops = [];
  const client = api.createClient({
    source: SOURCE,
    postJson: async (url, body) => { posts.push({ url, body }); return overrides.response || { ok: true, purpose: body.purpose, value: 9, confidence: 0.9, provider: "gemini", model: "g" }; },
    regions: {
      pixelRect: (region, dimensions) => ({ x: Math.floor(region.x * dimensions.width), y: Math.floor(region.y * dimensions.height), width: 128, height: 100 }),
      crop: (source, rect, options) => { crops.push({ source, rect, options }); return { tag: "canvas" }; },
    },
    encodeCrop: (canvas) => ({ base64: "QUJD", mimeType: "image/png", canvas }),
    ...overrides.options,
  });
  return { client, posts, crops };
}

async function testSendsOnlyTheEncodedCropAndNarrowContext() {
  const { client, posts, crops } = harness();
  const answer = await client.resolve({
    purpose: "action-amount",
    field: "actions.river.1.amountBb",
    region: REGION,
    importId: "imp_7",
    site: "Natural8",
    street: "river",
    index: 1,
    source: { huge: "object that must not be uploaded" },
    prompt: "custom prompt must never be sent",
    context: { street: "river", index: 1, actorName: "Opener", position: "UTG", type: "bet", rawText: "Bet O.B BB", candidates: ["Bet O.B BB"], secret: "nope", screenshot: "AAAA" },
  });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, "/api/import/v2/resolve");
  assert.deepEqual(plain(Object.keys(posts[0].body).sort()), ["context", "cropBase64", "importId", "mimeType", "purpose"]);
  assert.equal(posts[0].body.cropBase64, "QUJD");
  assert.equal(posts[0].body.mimeType, "image/png");
  assert.equal(posts[0].body.purpose, "action-amount");
  assert.equal(posts[0].body.importId, "imp_7");
  assert.deepEqual(plain(posts[0].body.context), { street: "river", index: 1, actorName: "Opener", position: "UTG", type: "bet", candidates: ["Bet O.B BB"], site: "Natural8" });
  assert.equal(crops.length, 1);
  assert.deepEqual(plain(crops[0].rect), { x: 640, y: 1011, width: 128, height: 100 });
  assert.ok(crops[0].options.padding > 0, "the crop is padded so glyph edges are not clipped");
  assert.deepEqual(plain(answer), { value: 9, confidence: 0.9, provider: "gemini", model: "g" });
}

async function testRejectsUnknownPurposesAndMissingRegionsBeforeAnyNetworkCall() {
  const { client, posts } = harness();
  await assert.rejects(client.resolve({ purpose: "full-hand", region: REGION }), /purpose/i);
  await assert.rejects(client.resolve({ purpose: "action-amount" }), /region/i);
  await assert.rejects(client.resolve({ purpose: "action-amount", region: { x: 2, y: 0, width: 1, height: 1 } }), /region/i);
  assert.equal(posts.length, 0);
  assert.deepEqual(Array.from(api.PURPOSES).sort(), ["action-amount", "action-text", "actor-row", "board-card", "hero-cards", "site-metadata"]);
}

async function testServerFailureIsSurfacedNotSwallowed() {
  const { client } = harness({ response: { ok: false, error: "quota" } });
  await assert.rejects(client.resolve({ purpose: "action-amount", region: REGION }), /quota|recovery/i);
  const failing = api.createClient({ source: SOURCE, postJson: async () => { throw new Error("network down"); }, regions: { pixelRect: () => ({ x: 0, y: 0, width: 1, height: 1 }), crop: () => ({}) }, encodeCrop: () => ({ base64: "QQ==", mimeType: "image/png" }) });
  await assert.rejects(failing.resolve({ purpose: "action-amount", region: REGION }), /network down/);
}

async function testEncoderFailureDoesNotPost() {
  const posts = [];
  const client = api.createClient({
    source: SOURCE,
    postJson: async (...args) => { posts.push(args); return {}; },
    regions: { pixelRect: () => ({ x: 0, y: 0, width: 1, height: 1 }), crop: () => ({}) },
    encodeCrop: () => { throw new Error("tainted canvas"); },
  });
  await assert.rejects(client.resolve({ purpose: "hero-cards", region: REGION }), /tainted canvas/);
  assert.equal(posts.length, 0);
}

(async () => {
  await testSendsOnlyTheEncodedCropAndNarrowContext();
  await testRejectsUnknownPurposesAndMissingRegionsBeforeAnyNetworkCall();
  await testServerFailureIsSurfacedNotSwallowed();
  await testEncoderFailureDoesNotPost();
  console.log("import fallback client tests passed");
})().catch((error) => { console.error(error); process.exit(1); });
