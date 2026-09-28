(function attachImportActionParser(root) {
  const TYPES = root.PokerCoachImportTypes;
  const BOOKKEEPING = /\b(?:RETURN(?:ED|S)?|REFUND(?:ED|S)?|UNCALLED|WINS?|MUCK(?:S|ED)?|COLLECT(?:S|ED)?)\b/;
  const VERB = /\b(FOLD|CHECK|CALL|BET|RAISE)(?:S|ED)?\b/;
  const ALL_IN = /\bALL IN\b/;
  const BLIND_ROW = /^(?:SB|BB|SMALL BLIND|BIG BLIND)\s+(?=\d)/;
  const AMOUNT_KIND = { call: "increment", bet: "street-total", raise: "street-total", allin: "stack-total", fold: "none", check: "none", blind: "street-total", ante: "street-total" };
  const AMOUNT_REQUIRED_CONFIDENCE = { bet: 0.4, raise: 0.4, allin: 0.7 };

  function normalizeOcrText(text) {
    return String(text ?? "")
      .toUpperCase()
      .replace(/\s+/g, " ")
      .replace(/(\d),(\d)/g, "$1.$2")
      .replace(/\bA[LI1]{2}\s*-?\s*IN\b/g, "ALL IN")
      .replace(/\bALL\s*-?\s*IN\b/g, "ALL IN")
      .replace(/(\d)\s*BB\b/g, "$1 BB")
      .replace(/\b(BET|RAISE|CALL|ANTE|IN|SB|BB)(?=\d)/g, "$1 ")
      .trim();
  }

  // Digit lookalikes (O, I, L, |) are only ever read as digits inside a digit-bearing amount token.
  function parseAmountDetailed(text) {
    const source = String(text ?? "");
    const runs = normalizeOcrText(source).match(/(?<![A-Z0-9.,])[0-9OIL|][0-9OIL|.,]*/g) || [];
    for (const rawRun of runs) {
      const run = rawRun.replace(/[.,]+$/, "");
      if (!/[0-9]/.test(run)) continue;
      const ambiguous = { value: null, confidence: 0, ambiguous: true, token: run };
      if ((run.match(/[.,]/g) || []).length > 1) return ambiguous;
      const digits = run.replace(/[OIL|]/g, (char) => (char === "O" ? "0" : "1")).replace(",", ".");
      const value = Number(digits);
      if (!/^\d+(?:\.\d+)?$/.test(digits) || !Number.isFinite(value)) return ambiguous;
      let confidence = 1;
      if (/\d,\d/.test(source)) confidence = /,\d{3}(?!\d)/.test(source) ? 0.7 : 0.94;
      if (/[OIL|]/.test(run)) confidence = Math.min(confidence, 0.7);
      return { value, confidence, ambiguous: false, token: run };
    }
    return { value: null, confidence: 0, ambiguous: false, token: null };
  }

  function parseAmount(text) {
    const { value, confidence } = parseAmountDetailed(text);
    return { value, confidence };
  }

  function warning(code, field, message) {
    return { code, severity: "warning", field, message, correctable: true };
  }

  function amountField(context) {
    return context.street && Number.isInteger(context.index) ? TYPES.fieldRef(["actions", context.street, context.index, "amountBb"]) : null;
  }

  function findType(normalized) {
    const candidates = [];
    const allIn = ALL_IN.exec(normalized);
    if (allIn) candidates.push({ type: "allin", index: allIn.index });
    const verb = VERB.exec(normalized);
    if (verb) candidates.push({ type: verb[1].toLowerCase(), index: verb.index });
    if (candidates.length) return candidates.sort((a, b) => a.index - b.index)[0].type;
    if (/\bANTE\b/.test(normalized)) return "ante";
    if (BLIND_ROW.test(normalized)) return "blind";
    return null;
  }

  function parseActionRow(row = {}, context = {}) {
    const rawText = String(row.text ?? "");
    const normalized = normalizeOcrText(rawText);
    if (!normalized || /^\d{1,2} ?S$/.test(normalized)) return { action: null, confidence: 1, warnings: [], ignored: "noise" };
    if (BOOKKEEPING.test(normalized)) return { action: null, confidence: 1, warnings: [], ignored: "bookkeeping" };
    const type = findType(normalized);
    if (!type) {
      const field = context.street && Number.isInteger(context.index) ? TYPES.fieldRef(["actions", context.street, context.index]) : null;
      return {
        action: null,
        confidence: 0.5,
        warnings: [warning("unrecognized-action-text", field, `Unrecognized action row text ${JSON.stringify(rawText)}.`)],
        ignored: "unrecognized",
      };
    }

    const warnings = [];
    let confidence = 1;
    if (type === "allin" && !/\bALL[\s-]?IN\b/.test(rawText.toUpperCase())) confidence = 0.95;

    let amountBb = null;
    if (AMOUNT_KIND[type] !== "none") {
      const amount = parseAmountDetailed(rawText);
      amountBb = amount.value;
      if (amount.value !== null) {
        confidence = Math.min(confidence, amount.confidence);
        if (amount.confidence < 1) {
          warnings.push(warning("amount-ocr-corrected", amountField(context), `Amount ${JSON.stringify(amount.token)} was normalized from OCR text.`));
        }
      } else if (amount.ambiguous || type in AMOUNT_REQUIRED_CONFIDENCE) {
        confidence = Math.min(confidence, AMOUNT_REQUIRED_CONFIDENCE[type] ?? 0.7);
        warnings.push(warning(amount.ambiguous ? "amount-ambiguous" : "amount-unreadable", amountField(context), `The ${type} amount could not be read reliably from ${JSON.stringify(rawText)}.`));
      }
    }

    return {
      action: {
        actorId: row.actorId || null,
        actorName: String(row.actorName ?? "").trim() || null,
        position: TYPES.normalizePosition(row.position),
        type,
        amountBb,
        amountKind: AMOUNT_KIND[type],
        rawText,
        sourceRegion: row.sourceRegion || null,
      },
      confidence,
      warnings,
    };
  }

  function parseStreet(rows = [], context = {}) {
    const actions = [];
    const confidences = [];
    const warnings = [];
    let confidence = 1;
    for (const row of rows) {
      const result = parseActionRow(row, { ...context, index: actions.length });
      warnings.push(...result.warnings);
      if (result.ignored === "noise" || result.ignored === "bookkeeping") continue;
      confidence = Math.min(confidence, result.confidence);
      if (result.action) {
        actions.push({ ...result.action, id: `${context.street}:${actions.length}` });
        confidences.push(result.confidence);
      }
    }
    return { street: context.street, actions, confidences, warnings, confidence };
  }

  const api = Object.freeze({ normalizeOcrText, parseAmount, parseActionRow, parseStreet });
  root.PokerCoachImportActionParser = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
