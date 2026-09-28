// Pixel-free debug records for Import Engine V2. Screenshots and crops are never persisted or logged:
// pixel-bearing keys are removed (not masked) so not even their names survive in the record.
const PIXEL_KEY = /base64|dataurl|imagedata|pixels?$|^blob$|thumbnail/i;
const OPAQUE_PAYLOAD = /^[A-Za-z0-9+/=\s]+$/;
const OPAQUE_MIN_LENGTH = 2000;

function isPixelValue(value) {
  if (typeof value !== "string") return false;
  return /^data:/i.test(value) || /base64,/i.test(value) || (value.length >= OPAQUE_MIN_LENGTH && OPAQUE_PAYLOAD.test(value));
}

function redactPixels(value) {
  if (Array.isArray(value)) return value.filter((item) => !isPixelValue(item)).map(redactPixels);
  if (value && typeof value === "object") {
    const clean = {};
    for (const [key, item] of Object.entries(value)) {
      if (PIXEL_KEY.test(key) || item === undefined || typeof item === "function" || isPixelValue(item)) continue;
      clean[key] = redactPixels(item);
    }
    return clean;
  }
  return value;
}

export function buildImportV2DebugRecord(input = {}) {
  return { ...redactPixels(input || {}), version: 1, recordedAt: new Date().toISOString() };
}
