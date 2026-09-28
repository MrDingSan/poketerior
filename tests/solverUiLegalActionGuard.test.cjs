const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));

assert.match(
  app,
  /!legalActions\.includes\(result\.recommendedAction\)/,
  "solver UI must reject recommendations outside the current legal action set.",
);
assert.match(
  app,
  /TexasSolver returned \$\{result\.recommendedAction\}, but legal actions here are/,
  "solver UI should explain when solver output is illegal for the node.",
);
assert.match(
  pkg.scripts.check,
  /tests\/texasSolverAllInPolicy\.test\.mjs/,
  "npm run check should include TexasSolver all-in policy regression.",
);
assert.match(
  pkg.scripts.check,
  /tests\/solverUiLegalActionGuard\.test\.cjs/,
  "npm run check should include solver UI legal-action guard regression.",
);

console.log("solver UI legal-action guard regression checks passed");
