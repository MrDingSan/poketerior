import { callGeminiWithFailover } from "../analysis/pipeline.js";
import { callGemini } from "../llm/geminiClient.js";
import { callOpenRouter } from "../llm/openRouterClient.js";

const TARGETED_TIMEOUT_MS = 6_000;
const DEFAULT_CONFIDENCE = 0.6;
const POSITIONS = ["UTG", "MP", "HJ", "CO", "BTN", "SB", "BB"];
const STREETS = ["preflop", "flop", "turn", "river"];
const ACTION_TYPES = ["fold", "check", "call", "bet", "raise", "allin"];
const MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];
const CARD_TOKEN = /^(10|[2-9TJQKA])([cdhs])$/i;
const ACTION_TEXT = /^(fold|check|call|bet|raise|all[\s-]?in)(?:\s+(\d+(?:[.,]\d+)?)\s*(?:bb)?)?$/i;

class ImportFieldError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

const clamp = (value) => Math.min(1, Math.max(0, Number(value)));

function card(token) {
  const match = String(token ?? "").trim().match(CARD_TOKEN);
  if (!match) throw new Error(`invalid card ${JSON.stringify(token)}`);
  return `${match[1] === "10" ? "T" : match[1].toUpperCase()}${match[2].toLowerCase()}`;
}

function distinctCards(tokens, count, label) {
  if (!Array.isArray(tokens) || tokens.length !== count) throw new Error(`${label} needs exactly ${count} card(s)`);
  const cards = tokens.map(card);
  if (new Set(cards).size !== cards.length) throw new Error(`${label} cards must be distinct`);
  return cards;
}

// Client context is data, never instructions: only known keys survive and text is reduced to a safe alphabet.
function safeText(value, max = 40) {
  return String(value ?? "").replace(/[^A-Za-z0-9 _.,+\-$@#/]/g, "").slice(0, max).trim();
}

function sanitizeContext(context = {}) {
  const clean = {};
  if (STREETS.includes(context.street)) clean.street = context.street;
  if (Number.isInteger(context.index) && context.index >= 0 && context.index < 100) clean.index = context.index;
  if (context.actorName) clean.actorName = safeText(context.actorName);
  if (POSITIONS.includes(context.position)) clean.position = context.position;
  if (ACTION_TYPES.includes(context.type)) clean.type = context.type;
  if (["flop", "turn", "river"].includes(context.which)) clean.which = context.which;
  if (context.site) clean.site = safeText(context.site);
  if (Array.isArray(context.candidates)) clean.candidates = context.candidates.slice(0, 6).map((item) => safeText(item)).filter(Boolean);
  return clean;
}

function contextLines(context) {
  const lines = [];
  for (const key of ["site", "street", "index", "actorName", "position", "type", "which"]) {
    if (context[key] !== undefined) lines.push(`${key}: ${context[key]}`);
  }
  if (context.candidates?.length) lines.push(`OCR candidates (may be wrong): ${context.candidates.join(" | ")}`);
  return lines.length ? `\nContext:\n${lines.join("\n")}` : "";
}

const TAIL = "Return only valid JSON with a numeric \"confidence\" from 0 to 1. Do not wrap it in markdown or add explanation.";
const SYSTEM = "You read one small cropped region of a poker hand-history screenshot. Answer only the single requested field as JSON.";

const PURPOSES = {
  "hero-cards": {
    maxTokens: 120,
    prompt: () => `Field: hero-cards.\nThe crop shows the Hero's two hole cards. Return {"value":["Ah","4d"],"confidence":0.95} with exactly two distinct cards (ranks 2-9,T,J,Q,K,A; suits c,d,h,s). ${TAIL}`,
    parse: (value) => distinctCards(value, 2, "hero-cards"),
  },
  "board-card": {
    maxTokens: 160,
    prompt: (context) => `Field: board-card.\nThe crop shows community cards. Read only the ${context.which || "visible"} card(s). Return {"value":{"flop":["6h","7s","8c"]},"confidence":0.9} using a "flop" (three cards), "turn" or "river" (one card) key. ${TAIL}`,
    parse: (value, context) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("board-card value must be an object");
      const parsed = {};
      if (value.flop !== undefined) parsed.flop = distinctCards(value.flop, 3, "flop");
      if (value.turn !== undefined) parsed.turn = card(value.turn);
      if (value.river !== undefined) parsed.river = card(value.river);
      if (!Object.keys(parsed).length) throw new Error("board-card value has no cards");
      if (context.which) {
        if (!parsed[context.which]) throw new Error(`board-card answer is missing the ${context.which}`);
        return { [context.which]: parsed[context.which] };
      }
      return parsed;
    },
  },
  "action-text": {
    maxTokens: 80,
    prompt: () => `Field: action-text.\nThe crop shows one action bubble. Return {"value":"Raise 3 BB","confidence":0.9} where value is exactly one of Fold, Check, Call, Bet, Raise or All-in, followed by an amount in BB when the bubble shows one. ${TAIL}`,
    parse: (value) => {
      const match = typeof value === "string" ? value.trim().match(ACTION_TEXT) : null;
      if (!match) throw new Error("action-text is outside the action vocabulary");
      const verb = /^all/i.test(match[1]) ? "All-in" : match[1][0].toUpperCase() + match[1].slice(1).toLowerCase();
      if (match[2] === undefined) return verb;
      if (["Fold", "Check"].includes(verb)) throw new Error(`${verb} cannot carry an amount`);
      return `${verb} ${Number(match[2].replace(",", "."))} BB`;
    },
  },
  "action-amount": {
    maxTokens: 60,
    prompt: () => `Field: action-amount.\nThe crop shows one bet, raise, call or all-in bubble. Return {"value":2.2,"confidence":0.9} where value is only the amount in big blinds as a number. ${TAIL}`,
    parse: (value) => {
      const number = typeof value === "number" ? value : /^\d+(?:\.\d+)?$/.test(String(value).trim()) ? Number(value) : NaN;
      if (!Number.isFinite(number) || number < 0 || number > 100_000) throw new Error("action-amount must be a non-negative number");
      return number;
    },
  },
  "actor-row": {
    maxTokens: 100,
    prompt: () => `Field: actor-row.\nThe crop shows one history row. Return {"value":{"actorName":"JIREN9","position":"BB"},"confidence":0.9} with the player's name and seat position (UTG, MP, HJ, CO, BTN, SB, BB) or null when no badge is visible. ${TAIL}`,
    parse: (value) => {
      const name = safeText(value?.actorName, 40);
      if (!name) throw new Error("actor-row needs an actorName");
      const position = value.position ?? null;
      if (position !== null && !POSITIONS.includes(position)) throw new Error("actor-row position is not a seat position");
      return { actorName: name, position };
    },
  },
  "site-metadata": {
    maxTokens: 120,
    prompt: () => `Field: site-metadata.\nThe crop shows the table header. Return {"value":{"site":"Natural8","stakesText":"$0.50/$1","tableSize":6},"confidence":0.9}; use null for anything not visible. ${TAIL}`,
    parse: (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("site-metadata value must be an object");
      const optionalText = (item, label) => {
        if (item === undefined || item === null) return null;
        if (typeof item !== "string") throw new Error(`${label} must be text or null`);
        return safeText(item, 60) || null;
      };
      const tableSize = value.tableSize ?? null;
      if (tableSize !== null && !(Number.isInteger(tableSize) && tableSize >= 2 && tableSize <= 10)) throw new Error("tableSize must be 2-10");
      return { site: optionalText(value.site, "site"), stakesText: optionalText(value.stakesText, "stakesText"), tableSize };
    },
  },
};

export const IMPORT_PURPOSES = Object.freeze(Object.keys(PURPOSES));

function parseModelJson(text) {
  const trimmed = String(text ?? "").trim();
  const source = trimmed.startsWith("{") ? trimmed : trimmed.match(/\{[\s\S]*\}/)?.[0];
  if (!source) throw new Error("the model did not return a JSON object");
  return JSON.parse(source);
}

function interpret(spec, text, context) {
  const answer = parseModelJson(text);
  if (answer === null || typeof answer !== "object" || !("value" in answer)) throw new Error("the JSON answer has no value");
  const confidence = Number.isFinite(Number(answer.confidence)) ? clamp(answer.confidence) : DEFAULT_CONFIDENCE;
  return { value: spec.parse(answer.value, context), confidence };
}

const uniqueModels = (models) => models.filter((model, index, list) => model && list.indexOf(model) === index);

export async function resolveImportField(
  { purpose, cropBase64, mimeType = "image/png", context = {}, config = {}, importId = null, signal } = {},
  { callGeminiModel = callGemini, callOpenRouterModel = callOpenRouter } = {},
) {
  const spec = Object.hasOwn(PURPOSES, purpose) ? PURPOSES[purpose] : null;
  if (!spec) throw new ImportFieldError(`Unsupported import purpose ${JSON.stringify(purpose)}.`, 400);
  if (typeof cropBase64 !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(cropBase64)) {
    throw new ImportFieldError("cropBase64 must be a non-empty base64 string without a data: prefix.", 400);
  }
  const imageType = MIME_TYPES.includes(mimeType) ? mimeType : "image/png";
  const safeContext = sanitizeContext(context);
  const prompt = `${spec.prompt(safeContext)}${contextLines(safeContext)}`;
  const failures = [];

  if (config.geminiApiKey) {
    const models = uniqueModels([config.geminiImportModel, ...(config.geminiImportFallbackModels || [])]);
    let accepted = null;
    try {
      const response = await callGeminiWithFailover({
        apiKey: config.geminiApiKey,
        models,
        systemInstruction: SYSTEM,
        temperature: 0,
        timeoutMs: TARGETED_TIMEOUT_MS,
        maxTokens: spec.maxTokens,
        signal,
        parts: [{ text: prompt }, { inlineData: { mimeType: imageType, data: cropBase64 } }],
        callModel: callGeminiModel,
        validate: (candidate) => {
          try {
            accepted = interpret(spec, candidate.text, safeContext);
            return { valid: true, reasons: [] };
          } catch (error) {
            return { valid: false, reasons: [error.message] };
          }
        },
      });
      return { ok: true, importId, purpose, value: accepted.value, confidence: accepted.confidence, provider: "gemini", model: response.model };
    } catch (error) {
      failures.push(error.message);
    }
  }

  if (config.openRouterApiKey) {
    for (const model of uniqueModels([config.openRouterImportModel, ...(config.openRouterImportFallbackModels || [])])) {
      try {
        const response = await callOpenRouterModel({
          apiKey: config.openRouterApiKey,
          model,
          systemInstruction: SYSTEM,
          prompt,
          imageBase64: cropBase64,
          mimeType: imageType,
          temperature: 0,
          timeoutMs: TARGETED_TIMEOUT_MS,
          maxTokens: spec.maxTokens,
          signal,
        });
        const accepted = interpret(spec, response.text, safeContext);
        return { ok: true, importId, purpose, value: accepted.value, confidence: accepted.confidence, provider: "openrouter", model };
      } catch (error) {
        failures.push(`OpenRouter ${model}: ${error.message}`);
      }
    }
  }

  if (!config.geminiApiKey && !config.openRouterApiKey) {
    throw new ImportFieldError("No import provider is configured. Add GEMINI_API_KEY or OPENROUTER_API_KEY to .env.", 503);
  }
  throw new ImportFieldError(`Targeted import recovery failed. ${failures.join(" | ")}`, 502);
}
