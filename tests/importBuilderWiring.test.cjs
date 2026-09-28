const assert = require("node:assert/strict");
const fs = require("node:fs");

const html = fs.readFileSync("public/index.html", "utf8");
const app = fs.readFileSync("public/app.js", "utf8");

assert.match(html, /id="importBuilderWorkspace"[^>]+data-hand-workspace="screenshot"/);
assert.ok(html.indexOf("handSessionModel.js") < html.indexOf("app.js"));
assert.ok(html.indexOf("importBuilderAdapter.js") < html.indexOf("app.js"));
assert.ok(html.indexOf("handWorkspaceView.js") < html.indexOf("app.js"));
assert.match(app, /IMPORT_BUILDER_ADAPTER\.fromImportedHand\(importedHand/);
assert.match(app, /HAND_SESSION_MODEL\.replaceHand\(importSession/);
assert.match(app, /decisionSnapshotForAction\(importSession\.handState, decisionKey\)/);
assert.match(app, /function resetActiveHand\(\)/);
assert.match(app, /importSession = HAND_SESSION_MODEL\?\.createSession\("screenshot"\)/);
assert.doesNotMatch(
  app.slice(app.indexOf("async function loadImportedDecision"), app.indexOf('for (const id of ["analyzeFlopBtn"')),
  /setMode\("manual"\)/,
);

console.log("import builder wiring checks passed");
