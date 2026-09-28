const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const sandbox = {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../public/import-engine/vision/regions.js"), "utf8"), sandbox, { filename: "regions.js" });
const regions = sandbox.PokerCoachImportRegions;
const plain = (value) => JSON.parse(JSON.stringify(value));
assert.ok(regions, "PokerCoachImportRegions must be attached");

function fakeCanvasFactory() {
  const created = [];
  function createCanvas(width, height) {
    const draws = [];
    const canvas = {
      width,
      height,
      pixels: new Uint8ClampedArray(width * height * 4),
      draws,
      smoothing: null,
      getContext() {
        return {
          set imageSmoothingEnabled(value) { canvas.smoothing = value; },
          drawImage(...args) {
            draws.push(args.slice(1));
            const source = args[0];
            if (source && source.pixels && source.pixels.length === canvas.pixels.length) canvas.pixels.set(source.pixels);
          },
          getImageData: () => ({ width, height, data: canvas.pixels }),
          putImageData(imageData) { canvas.pixels = imageData.data; canvas.putCount = (canvas.putCount || 0) + 1; },
        };
      },
    };
    created.push(canvas);
    return canvas;
  }
  return { createCanvas, created };
}

function testPixelRectConvertsNormalizedRegions() {
  assert.deepEqual(plain(regions.pixelRect({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }, { width: 1280, height: 2022 })),
    { x: 320, y: 1011, width: 640, height: 506 });
  assert.deepEqual(plain(regions.pixelRect({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }, { width: 640, height: 1011 })),
    { x: 160, y: 505, width: 320, height: 254 });
}

function testPixelRectClampsToImageBoundsAndKeepsMinimumSize() {
  const clamped = regions.pixelRect({ x: 0.9, y: 0.95, width: 0.5, height: 0.5 }, { width: 100, height: 200 });
  assert.equal(clamped.x + clamped.width, 100);
  assert.equal(clamped.y + clamped.height, 200);
  const negative = regions.pixelRect({ x: -0.2, y: -0.1, width: 0.3, height: 0.3 }, { width: 100, height: 100 });
  assert.equal(negative.x, 0);
  assert.equal(negative.y, 0);
  const tiny = regions.pixelRect({ x: 0.5, y: 0.5, width: 0, height: 0 }, { width: 100, height: 100 });
  assert.ok(tiny.width >= 1 && tiny.height >= 1);
  assert.throws(() => regions.pixelRect({ x: 0, y: 0, width: 1, height: 1 }, { width: 0, height: 10 }), /dimensions/i);
}

function testCropRequestsExactDrawCoordinatesWithSmoothingDisabled() {
  const { createCanvas, created } = fakeCanvasFactory();
  const image = { tag: "image" };
  const canvas = regions.crop({ image, width: 1280, height: 2022 }, { x: 100, y: 200, width: 300, height: 50 }, { createCanvas, scale: 2 });
  assert.equal(canvas.width, 600);
  assert.equal(canvas.height, 100);
  assert.equal(created.length, 1);
  assert.deepEqual(plain(canvas.draws[0]), [100, 200, 300, 50, 0, 0, 600, 100]);
  assert.equal(canvas.smoothing, false);
}

function testCropPaddingIsClampedToTheSourceImage() {
  const { createCanvas } = fakeCanvasFactory();
  const canvas = regions.crop({ image: {}, width: 400, height: 300 }, { x: 5, y: 290, width: 50, height: 10 }, { createCanvas, padding: 8 });
  assert.deepEqual(plain(canvas.draws[0]), [0, 282, 63, 18, 0, 0, 63, 18]);
  assert.equal(canvas.width, 63);
  assert.equal(canvas.height, 18);
}

function testPreprocessVariants() {
  const { createCanvas } = fakeCanvasFactory();
  const source = createCanvas(4, 2);
  const original = regions.preprocess(source, "original", { createCanvas });
  assert.equal(original, source, "original returns the source canvas untouched");

  const two = regions.preprocess(source, "upscale2", { createCanvas });
  assert.equal(two.width, 8);
  assert.equal(two.height, 4);
  assert.equal(two.smoothing, false);
  const three = regions.preprocess(source, "upscale3", { createCanvas });
  assert.equal(three.width, 12);
  assert.equal(three.height, 6);

  assert.throws(() => regions.preprocess(source, "sepia", { createCanvas }), /variant/i);
  assert.deepEqual(Array.from(regions.VARIANTS), ["original", "upscale2", "upscale3", "grayscaleContrast", "threshold"]);
}

function testGrayscaleContrastStretchesLuminance() {
  const data = new Uint8ClampedArray([
    100, 100, 100, 255,
    140, 140, 140, 255,
  ]);
  regions.grayscaleContrastData(data);
  assert.deepEqual(Array.from(data), [0, 0, 0, 255, 255, 255, 255, 255]);
  const flat = new Uint8ClampedArray([50, 50, 50, 255, 50, 50, 50, 255]);
  regions.grayscaleContrastData(flat);
  assert.deepEqual(Array.from(flat), [50, 50, 50, 255, 50, 50, 50, 255], "flat images are not amplified");
}

function testThresholdProducesBlackOnWhiteText() {
  const data = new Uint8ClampedArray([
    20, 20, 20, 255,
    30, 30, 30, 255,
    230, 230, 230, 255,
    240, 240, 240, 255,
  ]);
  regions.thresholdData(data);
  assert.deepEqual(Array.from(data), [0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255]);
}

function testCanvasVariantsRewritePixels() {
  const { createCanvas } = fakeCanvasFactory();
  const source = createCanvas(2, 1);
  source.pixels.set([10, 10, 10, 255, 200, 200, 200, 255]);
  const gray = regions.preprocess(source, "grayscaleContrast", { createCanvas });
  assert.deepEqual(Array.from(gray.pixels), [0, 0, 0, 255, 255, 255, 255, 255]);
  assert.equal(gray.putCount, 1);
  const binary = regions.preprocess(source, "threshold", { createCanvas });
  assert.deepEqual(Array.from(binary.pixels), [0, 0, 0, 255, 255, 255, 255, 255]);
}

testPixelRectConvertsNormalizedRegions();
testPixelRectClampsToImageBoundsAndKeepsMinimumSize();
testCropRequestsExactDrawCoordinatesWithSmoothingDisabled();
testCropPaddingIsClampedToTheSourceImage();
testPreprocessVariants();
testGrayscaleContrastStretchesLuminance();
testThresholdProducesBlackOnWhiteText();
testCanvasVariantsRewritePixels();
console.log("import region helper tests passed");
