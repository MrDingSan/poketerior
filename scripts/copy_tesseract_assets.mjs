// Copies the pinned Tesseract.js browser runtime, WASM cores, and English trained data into an ignored
// public/vendor directory so screenshot OCR never depends on a CDN. Safe to re-run; it recreates the directory.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modules = path.join(root, "node_modules");
const target = path.join(root, "public", "vendor", "tesseract");

const files = [
  path.join(modules, "tesseract.js", "dist", "tesseract.min.js"),
  path.join(modules, "tesseract.js", "dist", "worker.min.js"),
  path.join(modules, "@tesseract.js-data", "eng", "4.0.0_best_int", "eng.traineddata.gz"),
];
const coreDirectory = path.join(modules, "tesseract.js-core");
if (fs.existsSync(coreDirectory)) {
  for (const name of fs.readdirSync(coreDirectory).sort()) {
    if (/^tesseract-core.*\.(js|wasm)$/.test(name)) files.push(path.join(coreDirectory, name));
  }
}

const missing = files.filter((file) => !fs.existsSync(file));
if (!files.some((file) => path.basename(file).startsWith("tesseract-core")) || missing.length) {
  console.error("Tesseract assets are missing. Run `npm install` first.");
  for (const file of missing) console.error(`  missing: ${path.relative(root, file)}`);
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const file of files) fs.copyFileSync(file, path.join(target, path.basename(file)));
console.log(`Copied ${files.length} Tesseract assets to ${path.relative(root, target)}`);
