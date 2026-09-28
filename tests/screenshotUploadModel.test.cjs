const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../public/screenshotUploadModel.js"), "utf8");
const sandbox = { window: {}, globalThis: {} };
sandbox.globalThis = sandbox;
vm.runInNewContext(source, sandbox, { filename: "screenshotUploadModel.js" });

const model = sandbox.PokerCoachScreenshotUploadModel;
assert.ok(model, "screenshot upload model should attach to global scope");

assert.deepEqual(
  JSON.parse(JSON.stringify(model.uploadDimensions({ width: 1920, height: 1080 }))),
  { width: 1920, height: 1080, resized: false },
  "normal desktop screenshots must preserve their original pixels",
);

const fixture = fs.readFileSync(path.join(__dirname, "fixtures/coinpoker-river-showdown.png"));
assert.equal(fixture.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "the shared screenshot fixture must remain a decodable PNG");
const fixturePayload = model.dataUrlPayload(`data:image/png;base64,${fixture.toString("base64")}`);
assert.equal(fixturePayload.mimeType, "image/png");
assert.equal(Buffer.from(fixturePayload.imageBase64, "base64").length, fixture.length, "the fixture must survive the browser upload payload conversion intact");

assert.deepEqual(
  JSON.parse(JSON.stringify(model.dataUrlPayload("data:image/png;base64,cG9rZXI=", "image/jpeg"))),
  { dataUrl: "data:image/png;base64,cG9rZXI=", mimeType: "image/png", imageBase64: "cG9rZXI=" },
  "a FileReader data URL must remain a string that can be assigned to an Image source",
);
assert.deepEqual(
  JSON.parse(JSON.stringify(model.uploadDimensions({ width: 3840, height: 2160 }))),
  { width: 2200, height: 1238, resized: true },
  "oversized desktop screenshots must be reduced while preserving aspect ratio",
);
assert.deepEqual(
  JSON.parse(JSON.stringify(model.uploadDimensions({ width: 1440, height: 3200 }))),
  { width: 990, height: 2200, resized: true },
  "oversized tall screenshots must retain their full aspect ratio",
);

console.log("screenshot upload model checks passed");
