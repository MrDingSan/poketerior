(function attachStreetRecognizer(root) {
  const DEFAULT_VARIANTS = Object.freeze(["upscale2", "grayscaleContrast"]);
  const DEFAULT_RETRY_BELOW = 0.65;
  // Text is always enlarged first; contrast variants run on the enlarged crop.
  const PIPELINES = {
    original: ["original"],
    upscale2: ["upscale2"],
    upscale3: ["upscale3"],
    grayscaleContrast: ["upscale2", "grayscaleContrast"],
    threshold: ["upscale2", "threshold"],
  };
  const ROW_PARAMETERS = {
    action: { tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,- " },
    amount: { tessedit_char_whitelist: "0123456789.,Bb " },
  };

  function clamp(value) {
    return Math.min(1, Math.max(0, Number(value) || 0));
  }

  function collectLines(data) {
    if (Array.isArray(data.lines) && data.lines.length) return data.lines;
    const lines = [];
    for (const block of data.blocks || []) {
      for (const paragraph of block.paragraphs || []) lines.push(...(paragraph.lines || []));
    }
    return lines;
  }

  // Tesseract reports confidence as 0-100; everything downstream uses 0-1.
  function normalizeResult(result) {
    const data = result?.data ?? result ?? {};
    const confidence = clamp((Number(data.confidence) || 0) / 100);
    const structured = collectLines(data)
      .map((line) => ({ text: String(line.text ?? "").trim(), confidence: clamp((Number(line.confidence) || 0) / 100) }))
      .filter((line) => line.text);
    const lines = structured.length
      ? structured
      : String(data.text ?? "").split(/\r?\n/).map((text) => text.trim()).filter(Boolean).map((text) => ({ text, confidence }));
    return { text: lines.map((line) => line.text).join("\n"), confidence, lines };
  }

  function applyVariant(crop, variant, preprocess) {
    const steps = PIPELINES[variant];
    if (!steps) throw new Error(`Unknown OCR variant ${variant}.`);
    return steps.reduce((image, step) => preprocess(image, step), crop);
  }

  async function recognizeWithRetry({ crop, pool, preprocess, variants, retryBelow, parameters }) {
    const attempts = [];
    let best = null;
    for (const variant of variants.slice(0, 2)) {
      if (best && best.confidence >= retryBelow) break;
      const image = applyVariant(crop, variant, preprocess);
      const outcome = normalizeResult(await pool.recognize(image, parameters ? { parameters } : {}));
      const attempt = { variant, confidence: outcome.confidence, text: outcome.text };
      attempts.push(attempt);
      if (!best || outcome.confidence > best.confidence) best = { ...outcome, variant };
    }
    return { best, attempts };
  }

  async function recognizeStreet({
    street,
    crop,
    rows,
    pool,
    preprocess = root.PokerCoachImportRegions?.preprocess,
    variants = DEFAULT_VARIANTS,
    retryBelow = DEFAULT_RETRY_BELOW,
  }) {
    try {
      if (Array.isArray(rows) && rows.length) {
        const outcomes = await Promise.all(rows.map(async (row, index) => {
          const { best, attempts } = await recognizeWithRetry({
            crop: row.crop, pool, preprocess, variants, retryBelow, parameters: ROW_PARAMETERS[row.rowType],
          });
          return {
            row: {
              text: best.lines.map((line) => line.text).join(" "),
              confidence: best.confidence,
              actorName: row.actorName ?? null,
              position: row.position ?? null,
              sourceRegion: row.sourceRegion ?? null,
            },
            attempts: attempts.map((attempt) => ({ scope: `row:${index}`, ...attempt })),
          };
        }));
        const resultRows = outcomes.map((outcome) => outcome.row);
        return {
          street,
          rawText: resultRows.map((row) => row.text).join("\n"),
          rows: resultRows,
          confidence: Math.min(...resultRows.map((row) => row.confidence)),
          attempts: outcomes.flatMap((outcome) => outcome.attempts),
        };
      }
      const { best, attempts } = await recognizeWithRetry({ crop, pool, preprocess, variants, retryBelow, parameters: null });
      return {
        street,
        rawText: best.text,
        rows: best.lines,
        confidence: best.confidence,
        attempts: attempts.map((attempt) => ({ scope: "street", ...attempt })),
      };
    } catch (error) {
      throw new Error(`${street} OCR failed: ${error.message}`, { cause: error });
    }
  }

  const api = Object.freeze({ DEFAULT_VARIANTS, DEFAULT_RETRY_BELOW, recognizeStreet, normalizeResult });
  root.PokerCoachStreetRecognizer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
