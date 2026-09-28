(function attachScreenshotUploadModel(global) {
  const MAX_LONG_EDGE = 2200;

  function uploadDimensions({ width, height } = {}) {
    const sourceWidth = Number(width);
    const sourceHeight = Number(height);
    if (!Number.isFinite(sourceWidth) || sourceWidth <= 0 || !Number.isFinite(sourceHeight) || sourceHeight <= 0) {
      throw new Error("Screenshot dimensions are required.");
    }
    const longestEdge = Math.max(sourceWidth, sourceHeight);
    if (longestEdge <= MAX_LONG_EDGE) {
      return { width: Math.round(sourceWidth), height: Math.round(sourceHeight), resized: false };
    }
    const scale = MAX_LONG_EDGE / longestEdge;
    return { width: Math.round(sourceWidth * scale), height: Math.round(sourceHeight * scale), resized: true };
  }

  function dataUrlPayload(dataUrl, fallbackMimeType = "image/png") {
    const text = String(dataUrl || "");
    const [, mimeType = "", imageBase64 = ""] = text.match(/^data:([^;]+);base64,(.*)$/) || [];
    if (!imageBase64) throw new Error("Could not read the screenshot as an image.");
    return { dataUrl: text, mimeType: mimeType || fallbackMimeType, imageBase64 };
  }

  global.PokerCoachScreenshotUploadModel = { uploadDimensions, dataUrlPayload };
})(typeof globalThis !== "undefined" ? globalThis : window);
