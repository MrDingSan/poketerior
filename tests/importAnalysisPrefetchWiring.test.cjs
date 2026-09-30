const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));

assert.match(
  html,
  /importAnalysisCacheModel\.js[\s\S]*importAnalysisPrefetchModel\.js[\s\S]*app\.js/,
  "the browser must load the prefetch model before app.js",
);
assert.match(
  app,
  /function renderImportedHand\(\)[\s\S]*?startImportedRequestPrefetch\(\);\n\}/,
  "rendering an imported hand must start prefetching its key decisions",
);
assert.match(app, /postJsonPrefetched\("\/api\/range\/interpret"/, "the range request must pick up a prefetched response");
assert.match(app, /postJsonPrefetched\("\/api\/analyze\/harrington"/);
assert.match(app, /postJsonPrefetched\("\/api\/analyze\/pokerskill"/);
assert.match(
  app,
  /const importGeneration = \+\+screenshotImportGeneration;[\s\S]*?cancelImportedRequestPrefetch\(\);/,
  "a new screenshot import must cancel the previous hand's prefetch",
);
assert.match(app, /runImportedPrefetchEntry/, "the app must provide a queue worker");
assert.match(app, /background:\s*true/, "prefetch must reuse the full analyzer in background mode");
assert.match(app, /activeImportedPrefetchKey/, "running imported work must be adoptable on click");
assert.match(
  app,
  /const importGeneration = \+\+screenshotImportGeneration;[\s\S]*importGeneration !== screenshotImportGeneration/,
  "overlapping screenshot imports must ignore obsolete responses",
);
assert.match(
  app,
  /const canRenderError = requestId === analysisRequestId[\s\S]*if \(canRenderError\)/,
  "late background failures must not overwrite a newer visible analysis",
);
assert.match(app, /importedAnalysisPrefetchQueue\.promote/, "clicking queued work must promote it");
assert.match(app, /Preparing…/, "queued and running decisions must expose preparation status");
assert.match(app, /Ready/, "completed prefetched decisions must expose readiness");
assert.match(app, /Retry/, "failed prefetched decisions must remain retryable");
assert.match(pkg.scripts.check, /tests\/importAnalysisPrefetchModel\.test\.cjs/);
assert.match(pkg.scripts.check, /tests\/importAnalysisPrefetchWiring\.test\.cjs/);

console.log("import analysis prefetch wiring checks passed");
