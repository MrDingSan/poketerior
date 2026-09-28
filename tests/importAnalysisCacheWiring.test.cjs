const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));

assert.match(
  html,
  /<script src="\.\/importAnalysisCacheModel\.js"><\/script>[\s\S]*<script src="\.\/importDecisionModel\.js"><\/script>[\s\S]*<script src="\.\/app\.js"><\/script>/,
  "import analysis cache and decision models must load before app.js.",
);

assert.match(
  app,
  /const IMPORT_ANALYSIS_CACHE_MODEL = typeof window !== "undefined" \? window\.PokerCoachImportAnalysisCacheModel : null;/,
  "app should attach the imported analysis cache model.",
);

assert.match(
  app,
  /restoreImportedAnalysisSnapshot\(cachedSnapshot\)/,
  "loading an imported decision should restore cached snapshots before re-running analysis.",
);

assert.match(
  app,
  /saveImportedAnalysisSnapshot\(cacheState\)/,
  "analysis completion should save a snapshot for the imported decision node.",
);

assert.match(
  pkg.scripts.check,
  /tests\/importAnalysisCacheModel\.test\.cjs/,
  "npm run check should include the pure cache model regression.",
);
assert.match(
  pkg.scripts.check,
  /tests\/importAnalysisCacheWiring\.test\.cjs/,
  "npm run check should include the imported analysis cache wiring regression.",
);

console.log("import analysis cache wiring regression checks passed");
