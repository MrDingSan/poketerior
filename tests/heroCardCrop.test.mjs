import assert from "node:assert/strict";
import { bottomSeatCropRegion } from "../src/analysis/heroCardCrop.js";

assert.deepEqual(bottomSeatCropRegion({ width: 1210, height: 2048 }), {
  left: 242,
  top: 410,
  width: 726,
  height: 512,
});

assert.deepEqual(bottomSeatCropRegion({ width: 1600, height: 900 }), {
  left: 320,
  top: 405,
  width: 960,
  height: 450,
});

assert.throws(
  () => bottomSeatCropRegion({ width: 0, height: 900 }),
  /dimensions/i,
);

console.log("hero card crop tests passed");
