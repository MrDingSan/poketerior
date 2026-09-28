const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const appSource = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");

assert.equal(
  appSource.includes('const importedAction = action.action === "allin" ? "raise" : action.action;'),
  false,
  "Imported all-in actions must not be rewritten to raise before analysis.",
);
assert.equal(
  appSource.includes('if (street === "preflop" && importedAction === "allin" && !hasAggression) mappedAction = "open";'),
  true,
  "Only preflop first-aggressor all-ins may map into the opening-action bucket.",
);

console.log("all-in import mapping regression checks passed");
