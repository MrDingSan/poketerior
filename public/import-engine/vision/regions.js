(function attachImportRegions(root) {
  const VARIANTS = Object.freeze(["original", "upscale2", "upscale3", "grayscaleContrast", "threshold"]);
  const EPSILON = 1e-9;

  function pixelRect(normalized, dimensions) {
    const width = Number(dimensions?.width);
    const height = Number(dimensions?.height);
    if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
      throw new Error("Region conversion needs positive image dimensions.");
    }
    // Snap away float noise (0.6000000000000001 * 1280) so neighbouring regions share edges exactly.
    const left = Math.min(width - 1, Math.max(0, Math.floor(normalized.x * width + EPSILON)));
    const top = Math.min(height - 1, Math.max(0, Math.floor(normalized.y * height + EPSILON)));
    const right = Math.min(width, Math.max(left + 1, Math.ceil((normalized.x + normalized.width) * width - EPSILON)));
    const bottom = Math.min(height, Math.max(top + 1, Math.ceil((normalized.y + normalized.height) * height - EPSILON)));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  function defaultCreateCanvas(width, height) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }

  function crop(source, rect, options = {}) {
    const { createCanvas = defaultCreateCanvas, scale = 1, padding = 0, smoothing = false } = options;
    const maxWidth = Number(source.width) || Infinity;
    const maxHeight = Number(source.height) || Infinity;
    const x0 = Math.max(0, Math.floor(rect.x - padding));
    const y0 = Math.max(0, Math.floor(rect.y - padding));
    const x1 = Math.min(maxWidth, Math.ceil(rect.x + rect.width + padding));
    const y1 = Math.min(maxHeight, Math.ceil(rect.y + rect.height + padding));
    const sourceWidth = Math.max(1, x1 - x0);
    const sourceHeight = Math.max(1, y1 - y0);
    const outputWidth = Math.max(1, Math.round(sourceWidth * scale));
    const outputHeight = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = createCanvas(outputWidth, outputHeight);
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = smoothing;
    context.drawImage(source.image, x0, y0, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight);
    return canvas;
  }

  function luminance(data, offset) {
    return 0.299 * data[offset] + 0.587 * data[offset + 1] + 0.114 * data[offset + 2];
  }

  function grayscaleContrastData(data) {
    let min = 255;
    let max = 0;
    for (let index = 0; index < data.length; index += 4) {
      const value = luminance(data, index);
      if (value < min) min = value;
      if (value > max) max = value;
    }
    const range = max - min;
    for (let index = 0; index < data.length; index += 4) {
      const value = luminance(data, index);
      const stretched = range > 0 ? ((value - min) / range) * 255 : value;
      data[index] = data[index + 1] = data[index + 2] = Math.round(stretched);
    }
    return data;
  }

  function otsuLevel(data) {
    const histogram = new Array(256).fill(0);
    let total = 0;
    for (let index = 0; index < data.length; index += 4) {
      histogram[Math.min(255, Math.round(luminance(data, index)))] += 1;
      total += 1;
    }
    let sum = 0;
    for (let level = 0; level < 256; level += 1) sum += level * histogram[level];
    let backgroundWeight = 0;
    let backgroundSum = 0;
    let bestVariance = -1;
    let bestLevel = 127;
    for (let level = 0; level < 256; level += 1) {
      backgroundWeight += histogram[level];
      if (!backgroundWeight) continue;
      const foregroundWeight = total - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundSum += level * histogram[level];
      const backgroundMean = backgroundSum / backgroundWeight;
      const foregroundMean = (sum - backgroundSum) / foregroundWeight;
      const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
      if (variance > bestVariance) {
        bestVariance = variance;
        bestLevel = level;
      }
    }
    return bestLevel;
  }

  function thresholdData(data) {
    const level = otsuLevel(data);
    for (let index = 0; index < data.length; index += 4) {
      const value = luminance(data, index) > level ? 255 : 0;
      data[index] = data[index + 1] = data[index + 2] = value;
    }
    return data;
  }

  function copyCanvas(canvas, scale, createCanvas) {
    const width = Math.max(1, Math.round(canvas.width * scale));
    const height = Math.max(1, Math.round(canvas.height * scale));
    const copy = createCanvas(width, height);
    const context = copy.getContext("2d");
    context.imageSmoothingEnabled = false;
    context.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, width, height);
    return copy;
  }

  function preprocess(canvas, variant, options = {}) {
    const { createCanvas = defaultCreateCanvas } = options;
    if (!VARIANTS.includes(variant)) throw new Error(`Unknown preprocessing variant ${variant}.`);
    if (variant === "original") return canvas;
    if (variant === "upscale2") return copyCanvas(canvas, 2, createCanvas);
    if (variant === "upscale3") return copyCanvas(canvas, 3, createCanvas);
    const output = copyCanvas(canvas, 1, createCanvas);
    const context = output.getContext("2d");
    const imageData = context.getImageData(0, 0, output.width, output.height);
    grayscaleContrastData(imageData.data);
    if (variant === "threshold") thresholdData(imageData.data);
    context.putImageData(imageData, 0, 0);
    return output;
  }

  const api = Object.freeze({ VARIANTS, pixelRect, crop, preprocess, grayscaleContrastData, thresholdData });
  root.PokerCoachImportRegions = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
