const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "../public", file), "utf8");
const tokens = read("design-tokens.css");
const html = read("index.html");
const hex = (name) => tokens.match(new RegExp(`--pt-${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];

function luminance(color) {
  const channels = [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
const contrast = (a, b) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

// Every text token reads on every surface it can sit on, at WCAG AA.
for (const text of ["tx", "t2", "mu"]) {
  for (const surface of ["bg", "s1", "s2"]) {
    const ratio = contrast(hex(text), hex(surface));
    assert.ok(ratio >= 4.5, `--pt-${text} on --pt-${surface} is ${ratio.toFixed(2)}:1`);
  }
}
// Signals read as text on cards, and each solid signal has readable ink.
for (const signal of ["ac", "bet", "bad", "info"]) {
  assert.ok(contrast(hex(signal), hex("s1")) >= 4.5, `--pt-${signal} as text on a card`);
  assert.ok(contrast(hex(`${signal}-ink`), hex(signal)) >= 4.5, `--pt-${signal}-ink on a solid --pt-${signal} badge`);
}

// The old variable names the legacy stylesheets use resolve to the shared palette.
const legacy = {
  "--bg": "--pt-bg", "--surface": "--pt-s1", "--surface-raised": "--pt-s1", "--panel": "--pt-s1",
  "--border": "--pt-bd", "--line": "--pt-bd", "--text": "--pt-tx", "--text-secondary": "--pt-t2",
  "--muted": "--pt-mu", "--accent": "--pt-ac", "--danger": "--pt-bad", "--warn": "--pt-bet",
};
for (const [name, target] of Object.entries(legacy)) {
  assert.match(tokens, new RegExp(`${name}:\\s*var\\(${target}\\)`), `${name} should resolve to ${target}`);
}

assert.match(tokens, /--pt-font:\s*Inter/, "Inter is the interface font");
assert.match(tokens, /--pt-mono:\s*"JetBrains Mono"/, "JetBrains Mono is the numeric and notation font");
assert.match(html, /family=Inter[^"]*&family=JetBrains\+Mono/, "both fonts are actually loaded");
assert.doesNotMatch(html, /poketerior-theme\.css/, "the removed theme file is not linked");

console.log("design token checks passed");
