const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const css = read("public/hand-stage.css");
const html = read("public/index.html");
const workspaceView = read("public/handWorkspaceView.js");

// All three hand screens share one layout, so they cannot drift apart again.
assert.match(html, /class="builder-layout hand-stage"/, "preflop builder uses the shared hand stage");
assert.match(html, /class="postflop-layout hand-stage"/, "postflop builder uses the shared hand stage");
assert.match(workspaceView, /class="postflop-layout import-builder-layout hand-stage"/, "screenshot import uses the shared hand stage");
assert.ok(html.indexOf("hand-stage.css") > html.indexOf("poketerior-dashboard.css"), "hand stage rules must load after the dashboard sizes they replace");

// Row 1 (rail | table | decision panel) shares a height; the decision path is row 2 across all columns.
const wide = css.slice(css.indexOf("@media (min-width: 1051px)"));
assert.match(wide, /\.hand-stage \.table-workspace,\s*\.hand-stage \.postflop-table-workspace\s*\{\s*display:\s*contents/, "table and path become grid items");
for (const part of [".street-navigator", ".hand-progress-region"]) assert.ok(wide.includes(part), `${part} sits in row 1`);
assert.match(wide, /\.hand-stage \.timeline-panel,[^{]*\.import-builder-timeline\s*\{\s*grid-column:\s*1 \/ -1;\s*grid-row:\s*2/, "the decision path spans every column in row 2");
assert.match(wide, /grid-column:\s*3;\s*grid-row:\s*1/, "the decision panel is in row 1");
assert.doesNotMatch(wide, /align-self:\s*start/, "no part may shrink to its content and end early");

// The decision path grows with the hand and every action box is the same size.
assert.match(css, /\.import-builder-timeline\s*\{[^}]*height:\s*auto[^}]*overflow:\s*visible/s, "the path never clips later streets");
assert.match(css, /\.import-timeline-streets,[^{]*\.preflop-timeline\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(150px,\s*1fr\)\)/s, "action boxes share one column size");
assert.match(css, /\.timeline-street-label\s*\{[^}]*grid-column:\s*1 \/ -1/, "street labels head their own row");

console.log("hand stage layout checks passed");
