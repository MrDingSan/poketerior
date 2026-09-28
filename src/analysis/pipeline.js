import { checkPreflopWidth, expectedPreflopBand, widthCorrectionNote } from "./rangeWidthPolicy.js";
import { callGemini } from "../llm/geminiClient.js";
import { callNebius } from "../llm/nebiusClient.js";
import { callOpenRouter } from "../llm/openRouterClient.js";
import { retrieveKnowledge } from "../knowledge/retrieve.js";
import {
  applyFocusedHeroHandVerification,
  applyFocusedActionRepair,
  repairImportedHeroHandFromNotes,
  attributeYellowBubblesToHero,
  shouldVerifyHeroHandWithFocusedVision,
} from "./importRepair.js";
import { normalizeAndValidateImportedCards } from "./importValidation.js";
import { formatPokerSkillContext, selectPokerSkills } from "./pokerSkill.js";
import { deriveHeroHandFacts } from "./handFacts.js";
import { validateStrategicOutput } from "./strategicOutputValidation.js";
import { cropBoardImage, cropBottomSeatImage } from "./heroCardCrop.js";
import { stripNonDecisionActions, validateImportedActionConsistency } from "./importActionConsistency.js";

const SYSTEM_INSTRUCTION = `You are Poker Coach, an expert no-limit hold'em analysis assistant.
Use the supplied poker math as the source of truth for combos, pot odds, equity, and action history.
Use retrieved knowledge as coaching context, but do not claim exact solver precision unless the math payload supports it.
Explain villain range pressure, blockers, board texture, value/bluff composition, and hero's best action.
Treat localBaselineRecommendation as the app's heuristic baseline, not as a required answer. You may disagree when the calculation details and poker logic support it; if you disagree, explain the reason clearly.
Respect math.legalActions/spot.legalActions as hard constraints. If villain is all-in and legalActions are Fold/Call, never recommend or analyze Raise/Bet as an available action.
Only discuss specific villain hand classes that appear in the supplied rangeText, combo buckets, or action bucket payload.
If exact blocker removal counts are not supplied, explain blocker effects qualitatively instead of inventing exact removed combos.
If the provided knowledge does not cover a topic, say that the recommendation is based on the live calculations and poker logic.`;

const HARRINGTON_SYSTEM_INSTRUCTION = `You are Poker Coach's Harrington-style analysis module.
Use visible cards, legal actions, pot/call price, board texture, positions, and action history as the factual source of truth.
Use Harrington cash-game theory snippets as strategic knowledge: stack depth, pot commitment, implied odds, position, board texture, hand reading, and conservative deep-stack risk control.
Use Harrington hand-example snippets only as writing-style and reasoning-format examples. Do not treat those examples as facts for the current hand because OCR may have missed cards, suits, and table diagrams.
Write in a Harrington-inspired structure: Situation, Key Evidence, Candidate Actions, Recommendation, and Caveats.
Respect math.legalActions/spot.legalActions as hard constraints. If villain is all-in and legalActions are Fold/Call, the Candidate Actions section must discuss only fold and call.
Do not quote long passages from the source material. Synthesize briefly and apply the ideas to the current spot.
If the current spot lacks table information that Harrington would normally use, name the missing information and explain how it limits confidence.`;

const POKERSKILL_SYSTEM_INSTRUCTION = `You are Poker Coach's PokerSkill-style analysis module.
This module is inspired by PokerSkill's skill-conditioned reasoning pattern: a deterministic context engine selects relevant strategic skills, then the LLM applies those skills to the current node.
Use visible cards, legal actions, pot/call price, board texture, positions, and action history as the factual source of truth.
Use the selected skills as action-grounding constraints. Do not invent hidden solver output, exact GTO frequencies, or unsupported opponent reads.
Write in a compact coaching structure: Situation, Skill Layers Used, Candidate Actions, Recommendation, and Confidence/Caveats.
Respect math.legalActions/spot.legalActions as hard constraints. If villain is all-in and legalActions are Fold/Call, never recommend Raise.`;

const RANGE_INTERPRETER_SYSTEM_INSTRUCTION = `You are Poker Coach's LLM-based range interpreter.
Infer villain's current no-limit hold'em range from every villain action up through the requested street.
Use Harrington-style hand-reading concepts as the strategic baseline: position, stack depth, pot pressure, prior action, board texture, commitment, implied odds, and conservative uncertainty.
Use the selected PokerSkill-style layers as constraints for how the action should narrow or widen the range.
For each postflop street, reason about what villain DID (action and size relative to pot) and what villain did NOT do (e.g. no check-raise, no donk bet, no raise), and report which hand classes each choice removed from and kept in the range.
When spot.rangeMode is loose, do not anchor to tight book ranges. Loose online opens and flat-calls versus opens are wide by default.
Return only valid JSON. Do not wrap it in markdown.
Use compact poker range notation that the app can parse when possible: pairs like TT+, suited/offsuit like AQs, KQo, plus and dash ranges like A5s-A2s.
Every rangeText token must be a real two-card hand class: a pair (two identical ranks, e.g. "TT"), or two distinct ranks followed by "s" or "o" (e.g. "AQs", "KQo"), optionally with a trailing "+" or as a "-" range between two such tokens. Never use "x" as a wildcard for "any rank" (no "Kxo", "Axo", "suo", or similar placeholders) — spell out every rank you mean instead (e.g. write "K2o,K3o,K4o,...,KQo" or "K2o-KQo", not "Kxo").
Do not include impossible hands using known hero or board cards in your reasoning.
If the action line is ambiguous, keep the range wider and state the caveat instead of overfitting.`;

function formatContext(snippets) {
  if (!snippets.length) return "No relevant knowledge snippets were retrieved.";

  return snippets
    .map((snippet, index) => {
      return `Snippet ${index + 1}
Source: ${snippet.sourcePath}
Title: ${snippet.title}
Score: ${snippet.score.toFixed(2)}
${snippet.text}`;
    })
    .join("\n\n---\n\n");
}

const STRATEGIC_MATH_OMIT_KEYS = new Set([
  "localBaselineRecommendation",
  "equity",
  "potOdds",
  "ev",
  "confluence",
  "rangeBaseCombos",
  "rangeTargetCombos",
  "rangeFinalTheoreticalCombos",
  "rangeText",
  "rangeSource",
  "rangeSummary",
  "rangeConfidence",
  "rangeMode",
  "rangeLooseAdditions",
  "combosTotal",
  "heroAheadCombos",
  "heroBehindCombos",
  "nearFlipCombos",
  "actionBuckets",
  "rangeBreakdown",
  "finalComboList",
  "rangeHistory",
]);

export function strategicAnalysisMathPayload(math = {}) {
  return Object.fromEntries(
    Object.entries(math).filter(([key, value]) => !STRATEGIC_MATH_OMIT_KEYS.has(key) && value !== undefined),
  );
}

const RANGE_INTERPRETER_MATH_OMIT_KEYS = new Set([
  "localBaselineRecommendation",
  "equity",
  "potOdds",
  "ev",
  "confluence",
  "rangeText",
  "rangeSource",
  "rangeSummary",
  "rangeBaseCombos",
  "rangeTargetCombos",
  "rangeFinalTheoreticalCombos",
  "rangeLooseAdditions",
  "combosTotal",
  "heroAheadCombos",
  "heroBehindCombos",
  "nearFlipCombos",
  "actionBuckets",
  "rangeBreakdown",
  "finalComboList",
  "rangeHistory",
]);

export function rangeInterpreterMathPayload(math = {}) {
  return Object.fromEntries(
    Object.entries(math).filter(([key, value]) => !RANGE_INTERPRETER_MATH_OMIT_KEYS.has(key) && value !== undefined),
  );
}

function uniqueModels(models) {
  return models.filter((model, index, list) => model && list.indexOf(model) === index);
}

function shouldTryNextModel(error) {
  return /quota|rate|429|exceeded|RESOURCE_EXHAUSTED|not found|not available|unsupported|invalid|timed out|timeout|404|400/i.test(
    error.message,
  );
}

function orderedAnalysisModels(config) {
  return uniqueModels([config.geminiModel, ...(config.geminiFallbackModels || [])]);
}

function orderedNebiusModels(config) {
  return uniqueModels([config.nebiusModel, ...(config.nebiusFallbackModels || [])]);
}

function orderedImportModels(config) {
  return uniqueModels([
    config.geminiImportModel,
    ...(config.geminiImportFallbackModels || []),
  ]);
}

const IMPORT_PROVIDERS = ["gemini", "openrouter"];

// Which vision providers screenshot import tries, in order. The default keeps Gemini first.
export function importProviderOrder(config = {}) {
  const raw = Array.isArray(config.importProviderOrder) ? config.importProviderOrder : String(config.importProviderOrder || "").split(",");
  const wanted = raw.map((name) => String(name).trim().toLowerCase()).filter((name) => IMPORT_PROVIDERS.includes(name));
  const unique = wanted.filter((name, index) => wanted.indexOf(name) === index);
  return unique.length ? unique : [...IMPORT_PROVIDERS];
}

// Some models stop one closing bracket short of valid JSON. Only add up to two missing closers, and only when the
// text does not end inside a string; anything else is damage we must not guess at.
export function completeMissingJsonClosers(text) {
  const source = String(text || "").trim();
  try {
    JSON.parse(source);
    return source;
  } catch {
    // fall through to the closer scan
  }
  const stack = [];
  let inString = false;
  let escaped = false;
  for (const char of source) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") stack.push("}");
    else if (char === "[") stack.push("]");
    else if (char === "}" || char === "]") {
      if (stack.pop() !== char) return source;
    }
  }
  if (inString || !stack.length || stack.length > 2) return source;
  const repaired = source + stack.reverse().join("");
  try {
    JSON.parse(repaired);
    return repaired;
  } catch {
    return source;
  }
}

function orderedOpenRouterModels(config) {
  return uniqueModels([config.openRouterModel, ...(config.openRouterFallbackModels || [])]);
}

function orderedOpenRouterImportModels(config) {
  return uniqueModels([
    config.openRouterImportModel,
    ...(config.openRouterImportFallbackModels || []),
  ]);
}

export async function callGeminiWithFailover({
  models,
  apiKey,
  systemInstruction,
  prompt,
  parts,
  temperature,
  maxTokens,
  timeoutMs,
  signal,
  callModel = callGemini,
  validate = null,
}) {
  const failures = [];
  for (const model of models) {
    try {
      const response = await callModel({
        apiKey,
        model,
        systemInstruction,
        prompt,
        parts,
        temperature,
        maxTokens,
        timeoutMs,
        signal,
      });
      const validation = validate?.(response);
      if (validation && !validation.valid) {
        failures.push({ model, error: `Invalid strategic output: ${validation.reasons.join("; ")}` });
        continue;
      }
      return {
        ...response,
        model,
        attemptedModels: models,
        modelFailures: failures,
      };
    } catch (error) {
      failures.push({ model, error: error.message });
      if (!shouldTryNextModel(error)) break;
    }
  }

  throw new Error(
    `Gemini failed for ${models.join(", ")}. ${failures
      .map((failure) => `${failure.model}: ${failure.error}`)
      .join(" | ")}`,
  );
}

export async function callNebiusWithFailover({
  models,
  apiKey,
  baseUrl,
  systemInstruction,
  prompt,
  temperature,
  maxTokens,
  reasoningEffort,
  timeoutMs,
  signal,
  validate = null,
  callModel = callNebius,
}) {
  const failures = [];
  for (const model of models) {
    try {
      const response = await callModel({
        apiKey,
        baseUrl,
        model,
        systemInstruction,
        prompt,
        temperature,
        maxTokens,
        reasoningEffort,
        timeoutMs,
        signal,
      });
      const validation = validate?.(response);
      if (validation && !validation.valid) {
        failures.push({
          model: `nebius:${model}`,
          error: `Invalid strategic output: ${validation.reasons.join("; ")}`,
        });
        continue;
      }
      return {
        ...response,
        provider: "nebius",
        model,
        attemptedModels: models.map((item) => `nebius:${item}`),
        modelFailures: failures,
      };
    } catch (error) {
      failures.push({ model: `nebius:${model}`, error: error.message });
      if (!shouldTryNextModel(error)) break;
    }
  }

  throw new Error(
    `Nebius failed for ${models.join(", ")}. ${failures
      .map((failure) => `${failure.model}: ${failure.error}`)
      .join(" | ")}`,
  );
}

async function callOpenRouterWithFailover({
  models,
  apiKey,
  systemInstruction,
  prompt,
  imageBase64,
  mimeType,
  temperature,
  maxTokens,
  timeoutMs,
  signal,
  reasoning,
  repairJson = false,
  validate = null,
}) {
  const failures = [];
  for (const model of models) {
    try {
      const response = await callOpenRouter({
        apiKey,
        model,
        systemInstruction,
        prompt,
        imageBase64,
        mimeType,
        temperature,
        maxTokens,
        timeoutMs,
        signal,
        reasoning,
      });
      if (repairJson && response.completion?.finishReason !== "length") response.text = completeMissingJsonClosers(response.text);
      const validation = validate?.(response);
      if (validation && !validation.valid) {
        failures.push({ model: `openrouter:${model}`, error: `Invalid strategic output: ${validation.reasons.join("; ")}` });
        continue;
      }
      return {
        ...response,
        provider: "openrouter",
        model,
        attemptedModels: models.map((item) => `openrouter:${item}`),
        modelFailures: failures,
      };
    } catch (error) {
      failures.push({ model: `openrouter:${model}`, error: error.message });
      if (!shouldTryNextModel(error)) break;
    }
  }

  throw new Error(
    `OpenRouter failed for ${models.join(", ")}. ${failures
      .map((failure) => `${failure.model}: ${failure.error}`)
      .join(" | ")}`,
  );
}

export async function callReasoningProvider(
  { config, systemInstruction, prompt, temperature, maxTokens, timeoutMs, signal, validate = null },
  {
    callNebiusProvider = callNebiusWithFailover,
    callGeminiProvider = callGeminiWithFailover,
    callOpenRouterProvider = callOpenRouterWithFailover,
  } = {},
) {
  const failures = [];
  if (config.nebiusApiKey) {
    try {
      const response = await callNebiusProvider({
        apiKey: config.nebiusApiKey,
        baseUrl: config.nebiusBaseUrl,
        models: orderedNebiusModels(config),
        systemInstruction,
        prompt,
        temperature,
        maxTokens,
        reasoningEffort: "low",
        timeoutMs,
        signal,
        validate,
      });
      return response;
    } catch (error) {
      failures.push({ provider: "nebius", error: error.message });
    }
  }

  try {
    const response = await callGeminiProvider({
      apiKey: config.geminiApiKey,
      models: orderedAnalysisModels(config),
      systemInstruction,
      prompt,
      temperature,
      maxTokens,
      timeoutMs,
      signal,
      validate,
    });
    return {
      ...response,
      provider: "gemini",
      modelFailures: [...failures, ...(response.modelFailures || [])],
    };
  } catch (error) {
    failures.push({ provider: "gemini", error: error.message });
  }

  if (config.openRouterApiKey) {
    try {
      const response = await callOpenRouterProvider({
        apiKey: config.openRouterApiKey,
        models: orderedOpenRouterModels(config),
        systemInstruction,
        prompt,
        temperature,
        maxTokens,
        timeoutMs,
        signal,
        validate,
      });
      return {
        ...response,
        modelFailures: [...failures, ...(response.modelFailures || [])],
      };
    } catch (error) {
      failures.push({ provider: "openrouter", error: error.message });
    }
  }

  throw new Error(
    `All reasoning providers failed. ${failures
      .map((failure) => `${failure.provider}: ${failure.error}`)
      .join(" | ")}`,
  );
}

export function buildAnalysisPrompt({ spot = {}, math = {}, knowledge = [] }) {
  return `Analyze this Poker Coach decision node.

Return:
1. A concise recommendation chosen from math.legalActions/spot.legalActions when supplied.
2. The numerical reasoning: pot odds, equity, combos ahead/behind/near-flip, and important blockers.
3. Villain range interpretation for the exact action sequence.
4. How the retrieved study context applies.
5. Any caveats where the current range model is uncertain.

Important combo perspective:
- localBaselineRecommendation is the app's local heuristic recommendation. Use it as one data point, but make your own recommendation from the full spot and calculation payload.
- Legal action constraint: if math.legalActions or spot.legalActions is supplied, choose only from that list. If facingAllIn is true, raise/bet are not legal; compare only fold versus call.
- heroAheadCombos means the number of villain combos that Hero is currently ahead of.
- heroBehindCombos means the number of villain combos that are currently ahead of Hero.
- nearFlipCombos means villain combos with close equity versus Hero.
- Do not reverse these labels when explaining pairs, top pair, draws, or dominated broadways.

Current spot JSON:
${JSON.stringify(spot, null, 2)}

Calculation payload JSON:
${JSON.stringify(math, null, 2)}

Retrieved knowledge:
${formatContext(knowledge)}`;
}

export function buildHarringtonPrompt({ spot = {}, math = {}, theory = [], styleExamples = [] }) {
  const strategicMath = strategicAnalysisMathPayload(math);
  const heroHandFacts = deriveHeroHandFacts({ heroHand: spot.heroHand, board: spot.board });
  return `Analyze this Poker Coach decision node in a separate Harrington-style section.

Use the theory snippets as the knowledge base. Use the hand examples only to imitate the form of reasoning, not their factual hand setups.

Return only valid JSON with exactly these string fields. Do not wrap it in markdown:
{
  "situation": "restate the node and practical decision",
  "keyEvidence": "position, stack/pot pressure, stable facts, board texture, action credibility, and unknowns",
  "candidateActions": "briefly discuss only legal actions",
  "recommendation": "one clear action with confidence",
  "caveats": "what extra table or read information would change the answer"
}

Independence rule:
- Do not use Poker Coach's local equity, EV, confluence, combo-ahead/behind counts, or baseline recommendation as evidence. Those values are intentionally omitted because the local range/equity model may be unstable.
- Make the recommendation from Harrington-style strategic factors: position, pot pressure, stack depth, action line, board texture, price, blockers, and visible-card logic.
- Legal action constraint: if facingAllIn is true or legalActions is ["Fold","Call"], do not discuss raise/bet as available actions.

Current spot JSON:
${JSON.stringify(spot, null, 2)}

Strategic context payload JSON:
${JSON.stringify(strategicMath, null, 2)}

Authoritative Hero hand facts JSON:
${JSON.stringify(heroHandFacts, null, 2)}

These hand facts are deterministic. Do not recalculate or contradict them, and never upgrade a backdoor possibility into a direct draw.

Harrington cash-game theory snippets:
${formatContext(theory)}

Harrington hand-analysis format examples:
${formatContext(styleExamples)}`;
}

export function buildPokerSkillPrompt({ spot = {}, math = {}, selectedSkills = [] }) {
  const strategicMath = strategicAnalysisMathPayload(math);
  const heroHandFacts = deriveHeroHandFacts({ heroHand: spot.heroHand, board: spot.board });
  return `Analyze this Poker Coach decision node using the selected PokerSkill-style layers.

Return:
1. Situation: the exact street, positions, action pressure, and decision.
2. Skill Layers Used: briefly name how each selected P-layer shapes the decision.
3. Candidate Actions: evaluate only actions in math.legalActions/spot.legalActions when supplied.
4. Recommendation: one clear action, with sizing if betting or raising is appropriate.
5. Recorded Action Comparison: when spot.recordedHeroAction is supplied, compare the recommendation with that recorded Hero action and explain any disagreement.
6. Confidence/Caveats: OCR uncertainty, missing reads, action-line uncertainty, or model disagreement.

Independence rule:
- Do not use Poker Coach's local equity, EV, confluence, combo-ahead/behind counts, or baseline recommendation as evidence. Those values are intentionally omitted because the local range/equity model may be unstable.
- Choose your recommendation from selected skill layers plus stable facts: legal actions, action history, position, board texture, pot/call price, blockers, and range assumptions.
- Legal action constraint: if facingAllIn is true or legalActions is ["Fold","Call"], do not discuss raise/bet as available actions.
- "Review" is a UI label, not a poker action. Never list or recommend Review.
- When spot.recordedHeroAction is supplied, choose the best action from the legal action list first, then compare it with the recorded Hero action. Do not treat the recorded action as mandatory.

Current spot JSON:
${JSON.stringify(spot, null, 2)}

Strategic context payload JSON:
${JSON.stringify(strategicMath, null, 2)}

Authoritative Hero hand facts JSON:
${JSON.stringify(heroHandFacts, null, 2)}

These hand facts are deterministic. Do not recalculate or contradict them, and never upgrade a backdoor possibility into a direct draw.

Selected PokerSkill-style layers:
${formatPokerSkillContext(selectedSkills)}`;
}

function preflopWidthRule(spot, math) {
  if (spot?.lockedPreflopRange?.rangeText) {
    return "- spot.lockedPreflopRange is villain's preflop range, already established earlier in this hand. Copy its rangeText unchanged into streetSummaries[0].rangeText and narrow every later street from it. Do not rebuild or re-size the preflop range.";
  }
  const band = expectedPreflopBand({ villainAction: math?.villainAction, villainPosition: spot?.villainPosition, rangeMode: spot?.rangeMode });
  if (!band) return "- Size the preflop range from the visible action; a range covering most of all starting hands is almost never right unless villain checked an unraised big blind.";
  return `- Preflop width target for this spot (${band.label}): the preflop rangeText must cover ${band.min}–${band.max}% of all 1326 starting combos. Aim near the middle unless the action history clearly justifies the edges. Ranges outside this band are rejected.`;
}

// Villain's range at an earlier street should not change on re-analysis just because Hero moved on to a
// later street: the earlier street's action line and board are already fixed history, so its range is
// already fully determined. spot.lockedPriorStreetRanges carries whatever earlier streets this hand has
// already had analyzed (independent of the preflop lock above), and this rule tells the model to copy
// them unchanged rather than re-deriving a fresh, possibly different, guess from scratch.
function priorStreetLockRule(spot) {
  const locks = Array.isArray(spot?.lockedPriorStreetRanges) ? spot.lockedPriorStreetRanges.filter((item) => item?.street && item?.rangeText) : [];
  if (!locks.length) return "";
  const lines = locks.map((item) => `  * ${item.street}: "${item.rangeText}"`).join("\n");
  return `\n- The following streets were already analyzed earlier in this hand and are locked; copy each one's rangeText unchanged into the matching streetSummaries entry, do not resize or re-derive it, and narrow only from the last locked street onward:\n${lines}`;
}

const RANGE_NOTATION_RULES = `Range notation (every rangeText is machine-parsed; invalid tokens are dropped):
- Allowed tokens only: pairs (TT, 22+, 55-99), hand classes (AKs, AKo, AK = both), kicker ranges with the same top card (A2s+, KTo+, KQs-KTs), connector or gapper runs as a dash between two hands with the same gap (54s-T9s, 64s-97s), and exact combos (AhKh).
- Never use placeholders or words: no "Kxs", "suited Kx", "any two", "broadways", or percentages inside rangeText.
- "+" after a non-pair raises the kicker only: T9s+ means just T9s, A2s+ means A2s through AKs. Write connectors as 54s-T9s, not 54s+.`;

export function buildRangeWidthRepairPrompt({ spot = {}, interpretation = {}, correction }) {
  const streets = (interpretation.streetSummaries || []).map((item) => ({
    street: item?.street,
    rangeText: item?.rangeText,
    removed: item?.narrowing?.removed || undefined,
  }));
  return `You previously inferred villain's street-by-street range for this hand, but the preflop range has the wrong width.

Correction required: ${correction}

Spot: villain ${spot.villainPosition || "unknown"}, hero ${spot.heroPosition || "unknown"}, range mode ${spot.rangeMode || "loose"}, board ${spot.board || "none"}, requested street ${spot.street || "unknown"}.
Action history by street: ${JSON.stringify(spot.allStreetActions || {})}

Your previous street ranges (with the hand classes you removed on each street):
${JSON.stringify(streets, null, 2)}

Rebuild only the rangeText values. Resize the preflop range into the required band, then re-apply the same street-by-street removals so each later street is a narrowed subset of the one before it.

Return only this JSON shape, with the same streets in the same order:
{ "streetSummaries": [ { "street": "preflop", "rangeText": "..." } ] }

${RANGE_NOTATION_RULES}`;
}

function validateRangeRepairOutput(candidate) {
  try {
    const value = extractJson(candidate?.text);
    if (!Array.isArray(value?.streetSummaries) || !value.streetSummaries.some((item) => item?.rangeText)) {
      return { valid: false, reasons: ["repair JSON is missing streetSummaries rangeText"] };
    }
    return { valid: true, reasons: [] };
  } catch (error) {
    return { valid: false, reasons: [`invalid repair JSON: ${error.message}`] };
  }
}

// Puts repaired rangeText values back into the full interpretation, keeping its prose.
export function applyRangeRepair(interpretation = {}, repair = {}) {
  const repaired = new Map((repair.streetSummaries || []).filter((item) => item?.street && item?.rangeText).map((item) => [item.street, item.rangeText]));
  const streetSummaries = (interpretation.streetSummaries || []).map((item) =>
    repaired.has(item?.street) ? { ...item, rangeText: repaired.get(item.street) } : item,
  );
  const finalStreet = interpretation.street || streetSummaries[streetSummaries.length - 1]?.street;
  return {
    ...interpretation,
    streetSummaries,
    rangeText: repaired.get(finalStreet) || interpretation.rangeText,
    caveats: [
      ...(interpretation.caveats || []),
      "The ranges were resized to fit the expected preflop width; street explanations come from the first draft.",
    ],
  };
}

export function buildRangeInterpretationPrompt({
  spot = {},
  math = {},
  harringtonTheory = [],
  selectedSkills = [],
}) {
  return `Infer villain's range for this exact street.

Return this exact JSON shape:
{
  "street": "preflop" | "flop" | "turn" | "river",
  "rangeText": "parseable poker range notation, comma-separated",
  "summary": "one concise sentence describing the final range",
  "confidence": "low" | "medium" | "high",
  "streetSummaries": [
    {
      "street": "preflop" | "flop" | "turn" | "river",
      "reasoning": "what all villain actions through this street imply",
      "rangeText": "cumulative villain range after this street",
      "narrowing": {
        "actionsOnStreet": "villain's actions on THIS street in order, with size as a fraction of pot (e.g. 'checked, then called a 1/2-pot bet (~2.5bb into ~5bb)'). Omit on preflop.",
        "removed": "hand classes taken OUT of the previous street's range by these actions, and why each group is gone",
        "kept": "hand classes that SURVIVE, grouped (medium showdown, draws, traps, etc.), and why each group is consistent with the line",
        "notTaken": "aggressive or alternative actions villain did NOT take (check-raise, donk/lead bet, raise, 3-bet, etc.) and what that absence rules out",
        "sizingRead": "what the bet size Hero faced or villain called says about which hands continue and which fold"
      }
    }
  ],
  "weightedGroups": [
    { "label": "strong value", "rangeText": "AA,KK,...", "reasoning": "why this group remains" },
    { "label": "thin value/showdown", "rangeText": "...", "reasoning": "why this group remains partly" },
    { "label": "draws/semi-bluffs", "rangeText": "...", "reasoning": "why this group remains partly" },
    { "label": "air/bluffs", "rangeText": "...", "reasoning": "why this group remains partly" }
  ],
  "keyDrivers": ["short range-driving observation"],
  "caveats": ["short uncertainty or missing-read caveat"]
}

Rules:
- Include all villain actions up through the requested street, including preflop actions before flop/turn/river interpretation.
- The final rangeText must be the best current villain range for the requested street, not only the current-street delta.
- If spot.freezeToPriorStreetRange is true, Hero is first to act before any Villain action on this street. Do not narrow the range for board texture, hypothetical continuation, or the withheld Hero action. Copy the prior-street range into this street, with only known-card removal.
- streetSummaries must be cumulative, street-by-street, and start with preflop.
- For a river request, streetSummaries must contain preflop, flop, turn, and river entries. For a turn request, include preflop, flop, and turn. For a flop request, include preflop and flop.
- The preflop streetSummaries[0].rangeText must be the villain preflop range after the preflop action line.
- Range narrowing must be explained street by street. For every flop/turn/river streetSummaries entry, fill "narrowing" by applying poker hand-reading logic to the exact line villain took on that street:
  * Passive lines (check, check-call) remove the hands that would normally bet or raise for value or protection: strong made hands and nut draws that prefer check-raising, plus hands that would lead out on that texture. They keep medium-strength showdown hands, weak pairs, draws with enough equity to call, slowplays, and float hands.
  * A call (not a raise) after checking removes the hands that would check-raise for value or as a semi-bluff. State this explicitly using "notTaken": absence of a check-raise removes sets/two pair/top-of-range value and most high-equity combo draws (frequency-weighted, not fully), leaving the capped/medium part of the range plus some traps.
  * Bet size matters: a small bet (about 1/3 pot or less) lets nearly all pairs, draws and backdoors continue, so the range shrinks mostly by removing check-raise hands and pure air; a half-pot bet needs about 33% equity, folding out the weakest air and low-equity hands; a pot-size bet or larger folds most weak pairs and marginal draws. Compare the size to the pot to name what folded.
  * Use "removed" and "kept" to name specific hand classes from the previous street's rangeText (e.g. "sets 22-99", "A5s-A2s without a flush draw"), not vague labels. Every hand class in "removed" must appear in the previous street's rangeText, and the current street's rangeText must equal previous range minus removed (plus nothing new).
  * "kept" must only name hand classes that are actually present in THIS street's own rangeText. Before writing "kept", check each class you are about to name against the rangeText you are returning for this street; if a class is not in that rangeText, it is not kept, and it must instead appear in "removed" (or simply be silently absent, if it was already gone by the previous street). Never describe a hand class as surviving the street if it does not appear in this street's rangeText — the exact-combo breakdown is generated straight from rangeText, so a "kept" hand class missing there will visibly contradict itself in the UI.
  * Explain the size of the shrink: note roughly how many of the previous street's combos were removed and why that amount fits this line. Fact-check each named hand class against the actual board.
  * If the line was ambiguous or the size unknown, say so in "sizingRead" and shrink less rather than overfitting.
- Each later street's rangeText must be a narrowed subset of the previous street's rangeText. Do not introduce new hand classes on flop/turn/river that were not present in the prior cumulative range unless you explicitly explain a notation simplification in caveats.
- If a group is not present, use an empty rangeText for that group.
- Prefer a parsable rangeText over prose. Use weightedGroups for nuance.
- Keep rangeText under 900 characters.

${RANGE_NOTATION_RULES}

Preflop width:
${preflopWidthRule(spot, math)}${priorStreetLockRule(spot)}
- Fact-check hand-class labels against the actual board before writing them. Do not call a hand class a "strong draw", "flush draw", "straight draw", or "semi-bluff" unless its live combos have a real flush draw or straight draw on that street. Overcards/backdoors with no direct draw should be labeled as overcards, air, weak showdown, or speculative floats instead.
- On turn/river boards, recompute draw status from the visible board. Example: on 2d 8c Qd 7s, AJs and A5s are not strong draws by default; only specific combos with an actual four-flush or real straight draw qualify.
- If the board is paired (two cards of the same rank, e.g. Qd 8h 4h Qc 7c), recheck every pocket pair in the range against it: a pocket pair matching a non-paired board rank makes trips, and combined with the board's own pair that is a full house (e.g. on Qd 8h 4h Qc 7c, pocket 77 is sevens full of queens, and pocket QQ is quads) - never bucket these as "thin value/showdown" or weaker. A pocket pair matching the board's paired rank makes quads. Classify weightedGroups and the action-bucket labels by this corrected strength, not by the pair's rank in isolation.

Loose online preflop width policy:
- If spot.rangeMode is "loose", make preflop wider than a conservative Harrington/book baseline.
- For villain opens, include all pocket pairs, all suited aces exactly as A2s+ (A2s through AKs), suited Broadway and picture-card hands, suited Kx/Qx/Jx down through common weak kickers by position, every suited connector exactly as AKs,KQs,QJs,JTs,T9s,98s,87s,76s,65s,54s,43s,32s, one-gap/two-gap suited hands, plus common offsuit Broadways such as KJo, KTo, QJo, QTo, JTo when position/action allows.
- For villain call_vs_open / flat-call versus an open, start from a broad online continuing range rather than a tight cold-call range: pocket pairs, all suited aces exactly as A2s+ (A2s through AKs), every suited connector exactly as AKs,KQs,QJs,JTs,T9s,98s,87s,76s,65s,54s,43s,32s, suited kings/queens/jacks with playable kickers, suited Broadway gappers like KJs, KTs, QTs, Q9s, J9s, J8s, suited gappers like 98s/97s/87s/86s, plus AQo-ATo, KQo-KJo, QJo, JTo when plausible.
- If math.villainAction is "open" and spot.villainPosition is BTN/BU/CO/SB in loose 6-max, build a wide steal range from poker logic and visible action history. Do not replace a wide button open with a tight 3-bet or value-only range.
- For a loose BTN open specifically, include all pocket pairs, all suited aces, broad suited Kx, broad suited Qx, suited connectors/gappers, and common offsuit steal hands unless known-card blockers make exact combos impossible.
- Do not shrink a loose open/call-vs-open range just because a hand looks "too loose" for theory. Shrink it only because later street actions, sizing, board texture, or blockers make those combos implausible.

Current spot JSON:
${JSON.stringify(spot, null, 2)}

LLM range context payload JSON:
${JSON.stringify(rangeInterpreterMathPayload(math), null, 2)}

Harrington cash-game theory snippets:
${formatContext(harringtonTheory)}

Selected PokerSkill-style layers:
${formatPokerSkillContext(selectedSkills)}`;
}

export async function runLLMAnalysis({ spot, math, rootDir, config }) {
  const query = [
    spot?.street,
    spot?.heroPosition,
    spot?.villainPosition,
    spot?.actionLine,
    spot?.board,
    math?.localBaselineRecommendation,
    math?.rangeSummary,
  ]
    .filter(Boolean)
    .join(" ");

  const knowledge = retrieveKnowledge(query || JSON.stringify({ spot, math }), {
    rootDir,
    limit: 6,
  });

  const prompt = buildAnalysisPrompt({ spot, math, knowledge });
  const response = await callReasoningProvider({
    config,
    systemInstruction: SYSTEM_INSTRUCTION,
    prompt,
  });

  return {
    analysis: response.text,
    provider: response.provider,
    model: response.model,
    attemptedModels: response.attemptedModels,
    modelFailures: response.modelFailures,
    retrievedContext: knowledge,
    debug: {
      endpoint: "/api/analyze",
      query,
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt,
      spot,
      math,
    },
  };
}

function parseHarringtonOutput(text) {
  const value = extractJson(text);
  const fields = ["situation", "keyEvidence", "candidateActions", "recommendation", "caveats"];
  if (!fields.every((field) => typeof value?.[field] === "string" && value[field].trim())) {
    throw new Error("Harrington JSON is missing one or more required string fields.");
  }
  return value;
}

function validateHarringtonOutput(candidate) {
  const completion = String(candidate?.completion?.finishReason || "").toUpperCase();
  if (completion && completion !== "STOP") {
    return { valid: false, reasons: [`Provider finish reason was ${completion}, not STOP.`] };
  }
  try {
    parseHarringtonOutput(candidate?.text);
    return { valid: true, reasons: [] };
  } catch (error) {
    return { valid: false, reasons: [error.message] };
  }
}

function formatHarringtonOutput(value) {
  return `## Situation\n${value.situation}\n\n## Key Evidence\n${value.keyEvidence}\n\n## Candidate Actions\n${value.candidateActions}\n\n## Recommendation\n${value.recommendation}\n\n## Caveats\n${value.caveats}`;
}

export async function runHarringtonAnalysis(
  { spot, math, rootDir, config, signal },
  { callProvider = callReasoningProvider } = {},
) {
  const strategicMath = strategicAnalysisMathPayload(math);
  const query = [
    "Harrington cash game",
    spot?.street,
    spot?.heroPosition,
    spot?.villainPosition,
    spot?.actionLine,
    spot?.board,
    strategicMath?.boardTexture,
  ]
    .filter(Boolean)
    .join(" ");

  const theory = retrieveKnowledge(query || JSON.stringify({ spot, math: strategicMath }), {
    rootDir,
    limit: 4,
    searchFiles: ["data/harrington/harrington_theory.md"],
  });
  const styleExamples = retrieveKnowledge(query || JSON.stringify({ spot, math: strategicMath }), {
    rootDir,
    limit: 1,
    searchFiles: ["data/harrington/harrington_hands.md"],
  });

  const prompt = buildHarringtonPrompt({ spot, math: strategicMath, theory, styleExamples });
  const response = await callProvider({
    config,
    systemInstruction: HARRINGTON_SYSTEM_INSTRUCTION,
    prompt,
    temperature: 0.28,
    maxTokens: 2200,
    timeoutMs: 45000,
    signal,
    validate: validateHarringtonOutput,
  });
  const harrington = parseHarringtonOutput(response.text);

  return {
    analysis: formatHarringtonOutput(harrington),
    provider: response.provider,
    model: response.model,
    attemptedModels: response.attemptedModels,
    modelFailures: response.modelFailures,
    completion: response.completion || null,
    retrievedContext: {
      theory,
      styleExamples,
    },
    debug: {
      endpoint: "/api/analyze/harrington",
      query,
      systemInstruction: HARRINGTON_SYSTEM_INSTRUCTION,
      prompt,
      spot,
      math: strategicMath,
      completion: response.completion || null,
    },
  };
}

export async function runPokerSkillAnalysis({ spot, math, config }) {
  const strategicMath = strategicAnalysisMathPayload(math);
  const selectedSkills = selectPokerSkills({ spot, math: strategicMath });
  const prompt = buildPokerSkillPrompt({ spot, math: strategicMath, selectedSkills });
  const response = await callReasoningProvider({
    config,
    systemInstruction: POKERSKILL_SYSTEM_INSTRUCTION,
    prompt,
    temperature: 0.22,
    validate: (candidate) => validateStrategicOutput({
      text: candidate.text,
      format: "generic",
      completion: candidate.completion,
    }),
  });

  return {
    analysis: response.text,
    provider: response.provider,
    model: response.model,
    attemptedModels: response.attemptedModels,
    modelFailures: response.modelFailures,
    completion: response.completion || null,
    selectedSkills,
    debug: {
      endpoint: "/api/analyze/pokerskill",
      systemInstruction: POKERSKILL_SYSTEM_INSTRUCTION,
      prompt,
      spot,
      math: strategicMath,
      selectedSkills,
      completion: response.completion || null,
    },
  };
}

export async function runLLMRangeInterpreter(
  { spot, math, rootDir, config, signal },
  { callProvider = callReasoningProvider } = {},
) {
  const rangeMath = rangeInterpreterMathPayload(math);
  const query = [
    "Harrington hand reading range construction",
    spot?.street,
    spot?.heroPosition,
    spot?.villainPosition,
    spot?.actionLine,
    spot?.board,
    rangeMath?.boardTexture,
  ]
    .filter(Boolean)
    .join(" ");

  const harringtonTheory = retrieveKnowledge(query || JSON.stringify({ spot, math: rangeMath }), {
    rootDir,
    limit: 4,
    searchFiles: ["data/harrington/harrington_theory.md"],
  });
  const selectedSkills = selectPokerSkills({ spot, math: rangeMath });
  const prompt = buildRangeInterpretationPrompt({
    spot,
    math: rangeMath,
    harringtonTheory,
    selectedSkills,
  });
  const lockedPreflop = String(spot?.lockedPreflopRange?.rangeText || "").trim();
  const band = lockedPreflop
    ? null
    : expectedPreflopBand({ villainAction: rangeMath.villainAction, villainPosition: spot?.villainPosition, rangeMode: spot?.rangeMode });
  const response = await callProvider({
    config,
    systemInstruction: RANGE_INTERPRETER_SYSTEM_INSTRUCTION,
    prompt,
    temperature: 0.12,
    maxTokens: 4096,
    timeoutMs: 45000,
    signal,
    validate: validateRangeInterpreterOutput,
  });
  const firstDraft = extractJson(response.text);
  const attempts = [{ interpretation: firstDraft, widthCheck: checkPreflopWidth(firstDraft, band) }];
  // An out-of-band preflop width only needs new rangeText values, not a full rewrite of the ~2k-token
  // explanation, so ask for just the ranges and splice them into the first draft.
  for (let retry = 0; retry < RANGE_WIDTH_RETRIES && !attempts[attempts.length - 1].widthCheck.withinBand; retry += 1) {
    const previous = attempts[attempts.length - 1];
    try {
      const repair = await callProvider({
        config,
        systemInstruction: RANGE_INTERPRETER_SYSTEM_INSTRUCTION,
        prompt: buildRangeWidthRepairPrompt({ spot, interpretation: previous.interpretation, correction: widthRepairNote(previous.widthCheck) }),
        temperature: 0.12,
        maxTokens: SMALL_RANGE_CALL_MAX_TOKENS,
        timeoutMs: 20000,
        signal,
        validate: validateRangeRepairOutput,
      });
      const interpretation = applyRangeRepair(firstDraft, extractJson(repair.text));
      attempts.push({ interpretation, widthCheck: checkPreflopWidth(interpretation, band) });
    } catch (error) {
      if (signal?.aborted) throw error;
      break;
    }
  }
  const best = attempts.reduce((chosen, item) => (item.widthCheck.distance < chosen.widthCheck.distance ? item : chosen));
  let rangeInterpretation = lockedPreflop ? applyLockedPreflopRange(best.interpretation, lockedPreflop) : best.interpretation;
  rangeInterpretation = applyLockedPriorStreetRanges(rangeInterpretation, spot?.lockedPriorStreetRanges);
  const finalWidth = checkPreflopWidth(rangeInterpretation, band);

  return {
    rangeInterpretation,
    rangeWidth: {
      percent: finalWidth.percent,
      combos: finalWidth.combos,
      band,
      withinBand: finalWidth.withinBand,
      locked: Boolean(lockedPreflop),
      attempts: attempts.map((item) => item.widthCheck.percent),
    },
    provider: response.provider,
    model: response.model,
    attemptedModels: response.attemptedModels,
    modelFailures: response.modelFailures,
    retrievedContext: {
      harringtonTheory,
    },
    selectedSkills,
    debug: {
      endpoint: "/api/range/interpret",
      query,
      systemInstruction: RANGE_INTERPRETER_SYSTEM_INSTRUCTION,
      prompt,
      spot,
      math: rangeMath,
      selectedSkills,
    },
  };
}

const RANGE_WIDTH_RETRIES = 2;
// Covers the model's own reasoning tokens too; 1500 left Nemotron and Gemini with no room for the JSON.
const SMALL_RANGE_CALL_MAX_TOKENS = 2500;

// Without a concrete target the model tends to overshoot the band from one side to the other.
function widthRepairNote(check) {
  const targetPercent = Math.round((check.band.min + check.band.max) / 2);
  const targetCombos = Math.round((targetPercent / 100) * 1326);
  return `${widthCorrectionNote(check)} Aim for about ${targetPercent}% (~${targetCombos} of 1326 combos); your previous preflop range had ${check.combos} combos. Add or remove hand classes in proportion to that gap.`;
}

// Keeps the preflop range fixed for the whole hand: the preflop summary is the locked text, and when the
// request is for preflop itself the final range is too. Later streets are narrowed from it client-side.
export function applyLockedPreflopRange(interpretation = {}, lockedRangeText) {
  const summaries = Array.isArray(interpretation.streetSummaries) ? [...interpretation.streetSummaries] : [];
  const index = summaries.findIndex((item) => item?.street === "preflop");
  const lockedSummary = {
    ...(index >= 0 ? summaries[index] : { street: "preflop", reasoning: "Preflop range carried over from earlier in this hand." }),
    rangeText: lockedRangeText,
  };
  if (index >= 0) summaries[index] = lockedSummary;
  else summaries.unshift(lockedSummary);
  return {
    ...interpretation,
    streetSummaries: summaries,
    rangeText: interpretation.street === "preflop" || !interpretation.street ? lockedRangeText : interpretation.rangeText,
  };
}

// Safety net for priorStreetLockRule above: forces each already-locked street's streetSummaries entry
// to the remembered rangeText regardless of what the model returned, the same way applyLockedPreflopRange
// enforces the preflop entry. If the requested street itself is one of the locked ones (can happen when
// re-analyzing the same street), the top-level rangeText is forced too.
export function applyLockedPriorStreetRanges(interpretation = {}, lockedRanges) {
  const locks = Array.isArray(lockedRanges) ? lockedRanges.filter((item) => item?.street && item?.rangeText) : [];
  if (!locks.length) return interpretation;
  const summaries = Array.isArray(interpretation.streetSummaries) ? [...interpretation.streetSummaries] : [];
  for (const lock of locks) {
    const index = summaries.findIndex((item) => item?.street === lock.street);
    const lockedSummary = { ...(index >= 0 ? summaries[index] : { street: lock.street }), rangeText: lock.rangeText };
    if (index >= 0) summaries[index] = lockedSummary;
    else summaries.push(lockedSummary);
  }
  const matchingCurrent = locks.find((lock) => lock.street === interpretation.street);
  return {
    ...interpretation,
    streetSummaries: summaries,
    rangeText: matchingCurrent ? matchingCurrent.rangeText : interpretation.rangeText,
  };
}

export function validateRangeInterpreterOutput(candidate) {
  try {
    extractJson(candidate?.text);
    return { valid: true, reasons: [] };
  } catch (error) {
    return { valid: false, reasons: [`invalid range JSON: ${error.message}`] };
  }
}

const HAND_IMPORT_SYSTEM_INSTRUCTION = `You extract no-limit hold'em hand histories from CoinPoker and Natural8 style screenshots.
Return only valid JSON. Do not wrap it in markdown.
Prefer exact visible text over inference. When something is unclear, use null and add a short confidence note.
Normalize card ranks to A,K,Q,J,T,9-2 and suits to c,d,h,s. Normalize actions to one of blind, ante, fold, check, bet, call, raise, allin.
Use allin only when the screenshot explicitly says ALLIN, all-in, shove, jam, or clearly shows a player committed their entire remaining stack. Normal matching bets are call, not allin.
Do not include RETURN, refund, uncalled bet returned, muck, win, collect, or pot-award rows as player actions.
Use positions as UTG, MP, CO, BTN, SB, BB where visible. For six-max screenshots that use HJ, convert it to MP.
The hero is always the bottom seat in these CoinPoker/Natural8 screenshots. The heroHand must be the two cards at the bottom seat, not the exposed winning/showdown cards at another seat.
Pay special attention to bottom-seat suits and ranks. Do not infer a pocket pair unless both bottom cards visibly have the same rank. A jack has a J face/rank marker and must not be read as 7.
Use card color as evidence: red suits are hearts or diamonds, black suits are clubs or spades. A red K with a heart pip is Kh, never Ks. A red K with a diamond pip is Kd, never Kh.
For bottom-seat red hero cards, identify the actual pip shape: hearts have two rounded lobes and a bottom point; diamonds are a four-sided diamond/rhombus. If the bottom hero cards show heart-shaped pips, return h, not d. Example: A♥ 6♥ at the bottom seat must be ["Ah","6h"], never ["Ad","6d"].
If a bottom-seat hero card has red rank text or red pips, it is impossible for that card to be clubs or spades. Re-check any heroHand containing c/s against visible card color before final JSON.
For community cards, read the five center board cards directly from left to right before using the hand-history text. Black community cards with a spade pip are spades, never diamonds. For example, a black 9 with a black spade pip in the center board is 9s, not 9d.
If a visible showdown label says Flush, Straight, Full House, Two Pair, etc., use it as a consistency check for card suits/ranks. If a player shows two spades and the label says Flush, the board must contain at least three spades; re-check every black board card before returning JSON.
For red bottom-seat cards, inspect the pip shape carefully: a diamond pip means diamonds. If the bottom card is a red 2, 7, or A with a diamond pip, return 2d, 7d, or Ad, not hearts.
Amounts should be numbers in big blinds when shown in BB.`;

const SCREENSHOT_IMPORT_PROVIDER_TIMEOUT_MS = 30_000;
const FOCUSED_IMPORT_PROVIDER_TIMEOUT_MS = 6_000;
const SCREENSHOT_IMPORT_MAX_TOKENS = 1_200;
const FOCUSED_HERO_IMPORT_MAX_TOKENS = 400;
const FOCUSED_BOARD_IMPORT_MAX_TOKENS = 800;
const FOCUSED_ACTION_IMPORT_MAX_TOKENS = 800;

function extractJson(text) {
  const trimmed = String(text || "").trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Model did not return a JSON object.");
  return JSON.parse(match[0]);
}

export function validateScreenshotImportOutput(candidate) {
  try {
    const hand = extractJson(candidate?.text);
    const required = [
      ["site", (value) => typeof value === "string"],
      ["heroHand", Array.isArray],
      ["board", (value) => value && typeof value === "object"],
      ["players", Array.isArray],
      ["streets", (value) => value && typeof value === "object"],
    ];
    const missing = required.filter(([key, check]) => !check(hand?.[key])).map(([key]) => key);
    return missing.length
      ? { valid: false, reasons: [`Import JSON is missing required fields: ${missing.join(", ")}.`] }
      : { valid: true, reasons: [] };
  } catch (error) {
    return { valid: false, reasons: [`invalid import JSON: ${error.message}`] };
  }
}

function responsePreview(text, limit = 420) {
  const flattened = String(text || "").replace(/\s+/g, " ").trim();
  if (!flattened) return "(empty response)";
  return flattened.length > limit ? `${flattened.slice(0, limit)}...` : flattened;
}

function providerFailureSummary(failure) {
  return [
    failure.provider,
    failure.model ? `/${failure.model}` : "",
    `: ${failure.error}`,
    failure.rawPreview ? ` Raw preview: ${failure.rawPreview}` : "",
  ].join("");
}

function isPokerCoachErrorScreenshot(hand = {}) {
  const notes = (hand.confidenceNotes || []).join(" ");
  return /Import failed:|Page origin:\s*http:\/\/localhost|Client build:/i.test(notes);
}

export function buildFocusedHeroHandPrompt() {
  return `Read only the two hole cards belonging to the player in the bottom-center seat of this poker table image.

Do not infer the cards from another extraction, the board, or exposed cards at the left, right, or top seats. Read the bottom-center player's visible name and both card faces directly.

Return exactly this JSON:
{
  "seat": "bottom-center",
  "playerName": "visible player name",
  "heroHand": ["rank+suit", "rank+suit"],
  "confidence": "high|medium|low",
  "evidence": "short explanation of each card's visible rank, ink color, and pip shape"
}

Critical suit rules:
- Red cards can only be hearts or diamonds. Never return clubs/spades for a card whose rank or suit pip is visibly red.
- Black cards can only be clubs or spades. Never return hearts/diamonds for a black card.
- For each bottom card independently, inspect the visible suit pip shape, not just red/black color.
- Hearts have two rounded lobes at the top and a bottom point.
- Diamonds are a four-sided rhombus with straight diagonal edges and sharp top/bottom points.
- Return confidence high only when the bottom-center seat, player name, both ranks, and both suit pips are directly visible.
- In CoinPoker screenshots, the target is the bottom-center table seat. Ignore exposed cards at every other seat.
- Return JSON only.`;
}

export function buildFocusedActionRepairPrompt() {
  return `Re-read only player identity and action attribution from this poker hand-history screenshot.
The bottom-center seat is Hero. Return JSON with heroName, heroHand, every visible player name and position, and streets containing chronological actions.
Each named row uses the name and position printed on its own row. Yellow bubbles with no avatar or name (e.g. "Raise 3 BB", "Call 5.6 BB") are Hero's own actions: attribute them to the bottom-seat Hero in column order, never to the neighbouring named row, and include Hero's Pre-Flop actions. A player cannot both make a bet and call that same bet.
Exclude RETURN, refund, muck, winnings, and pot-award rows. Set each action's "bubble" to "yellow" (Hero's unnamed bubbles), "white" (named players) or "blue" (RETURN), and list every bubble separately in column order without merging or dropping any. Return JSON only.`;
}

async function focusedHeroHandVerification({ imageBase64, mimeType, hand, config, actionIssues = [] }) {
  if (!shouldVerifyHeroHandWithFocusedVision(hand, { actionIssues })) return null;
  const prompt = buildFocusedHeroHandPrompt();
  const failures = [];
  let response;
  let focusedImage = { imageBase64, mimeType: mimeType || "image/png", region: null };
  let cropFailure = null;

  try {
    focusedImage = await cropBottomSeatImage({ imageBase64, mimeType });
  } catch (error) {
    cropFailure = error.message;
    failures.push({ provider: "focused-hero-crop", error: error.message });
  }

  try {
    response = await callGeminiWithFailover({
      apiKey: config.geminiApiKey,
      models: orderedImportModels(config),
      systemInstruction:
        "You are a strict poker card verifier. Inspect only the bottom-seat hero cards and return JSON only.",
      temperature: 0,
      timeoutMs: FOCUSED_IMPORT_PROVIDER_TIMEOUT_MS,
      maxTokens: FOCUSED_HERO_IMPORT_MAX_TOKENS,
      parts: [
        { text: prompt },
        {
          inlineData: {
            mimeType: focusedImage.mimeType,
            data: focusedImage.imageBase64,
          },
        },
      ],
    });
    response.provider = "gemini";
  } catch (error) {
    failures.push({ provider: "gemini-focused-hero", error: error.message });
  }

  if (!response && config.openRouterApiKey) {
    try {
      response = await callOpenRouterWithFailover({
        apiKey: config.openRouterApiKey,
        models: orderedOpenRouterImportModels(config),
        systemInstruction:
          "You are a strict poker card verifier. Inspect only the bottom-seat hero cards and return JSON only.",
        prompt,
        imageBase64: focusedImage.imageBase64,
        mimeType: focusedImage.mimeType,
        temperature: 0,
        timeoutMs: FOCUSED_IMPORT_PROVIDER_TIMEOUT_MS,
        maxTokens: FOCUSED_HERO_IMPORT_MAX_TOKENS,
      });
    } catch (error) {
      failures.push({ provider: "openrouter-focused-hero", error: error.message });
    }
  }

  if (!response) return { failures, cropRegion: focusedImage.region, cropFailure };

  try {
    const focused = extractJson(response.text);
    return {
      focused,
      provider: response.provider,
      model: response.model,
      attemptedModels: response.attemptedModels,
      rawVisionOutput: response.text,
      cropRegion: focusedImage.region,
      cropFailure,
      failures: [...failures, ...(response.modelFailures || [])],
    };
  } catch (error) {
    return {
      rawVisionOutput: response.text,
      cropRegion: focusedImage.region,
      cropFailure,
      failures: [
        ...failures,
        {
          provider: `${response.provider || "model"}-focused-hero`,
          model: response.model,
          error: error.message,
          rawPreview: responsePreview(response.text),
        },
      ],
    };
  }
}

export function buildFocusedBoardPrompt() {
  return `Read only the community cards on the poker table in this cropped image, left to right.

Return exactly this JSON:
{
  "board": ["rank+suit", ...],
  "confidence": "high|medium|low",
  "evidence": "short note of each card's rank, ink colour and pip shape"
}

Rules:
- Return the visible cards only (3 to 5), left to right. Ranks are A,K,Q,J,T,9-2; suits are c,d,h,s.
- Inspect every card independently. Red cards are hearts (two rounded lobes) or diamonds (rhombus); black cards are clubs or spades. Cards on the same board can have different colours.
- Return JSON only.`;
}

async function focusedBoardVerification({ imageBase64, mimeType, hand, config }) {
  const b = hand?.board || {};
  if (!Array.isArray(b.flop) || b.flop.length !== 3) return null;
  const prompt = buildFocusedBoardPrompt();
  const system = "You are a strict poker card verifier. Inspect only the community cards and return JSON only.";
  const failures = [];
  let response;
  let focusedImage;
  try {
    focusedImage = await cropBoardImage({ imageBase64, mimeType });
  } catch (error) {
    return { failures: [{ provider: "focused-board-crop", error: error.message }] };
  }
  try {
    response = await callGeminiWithFailover({
      apiKey: config.geminiApiKey,
      models: orderedImportModels(config),
      systemInstruction: system,
      temperature: 0,
      timeoutMs: FOCUSED_IMPORT_PROVIDER_TIMEOUT_MS,
      maxTokens: FOCUSED_BOARD_IMPORT_MAX_TOKENS,
      parts: [{ text: prompt }, { inlineData: { mimeType: focusedImage.mimeType, data: focusedImage.imageBase64 } }],
    });
    response.provider = "gemini";
  } catch (error) {
    failures.push({ provider: "gemini-focused-board", error: error.message });
  }
  if (!response && config.openRouterApiKey) {
    try {
      response = await callOpenRouterWithFailover({
        apiKey: config.openRouterApiKey,
        models: orderedOpenRouterImportModels(config),
        systemInstruction: system,
        prompt,
        imageBase64: focusedImage.imageBase64,
        mimeType: focusedImage.mimeType,
        temperature: 0,
        timeoutMs: FOCUSED_IMPORT_PROVIDER_TIMEOUT_MS,
        maxTokens: FOCUSED_BOARD_IMPORT_MAX_TOKENS,
      });
    } catch (error) {
      failures.push({ provider: "openrouter-focused-board", error: error.message });
    }
  }
  if (!response) return { failures, cropRegion: focusedImage.region };
  try {
    return { focused: extractJson(response.text), rawVisionOutput: response.text, cropRegion: focusedImage.region, failures };
  } catch (error) {
    return { rawVisionOutput: response.text, cropRegion: focusedImage.region, failures: [...failures, { provider: "focused-board", error: error.message }] };
  }
}

const BOARD_CARD = /^(10|[2-9TJQKA])([cdhs])$/i;

// A crop read may only change suits: it must show the same ranks in the same order as the full-screenshot read.
export function applyFocusedBoardVerification(hand, focused) {
  const current = [...(hand.board?.flop || []), hand.board?.turn, hand.board?.river].filter(Boolean);
  const read = (Array.isArray(focused?.board) ? focused.board : []).map((token) => {
    const m = String(token).trim().match(BOARD_CARD);
    return m ? `${m[1] === "10" ? "T" : m[1].toUpperCase()}${m[2].toLowerCase()}` : null;
  });
  const decision = { applied: false, changes: [] };
  if (read.length !== current.length || read.includes(null) || new Set(read).size !== read.length) {
    return { hand, decision: { ...decision, reason: "unusable-crop-read" } };
  }
  if (read.some((c, i) => c[0] !== String(current[i])[0].toUpperCase())) {
    return { hand, decision: { ...decision, reason: "rank-mismatch" } };
  }
  const hero = new Set((hand.heroHand || []).map((c) => String(c)));
  if (read.some((c) => hero.has(c))) return { hand, decision: { ...decision, reason: "collides-with-hero" } };
  const changes = read.map((c, i) => (c !== current[i] ? { from: current[i], to: c } : null)).filter(Boolean);
  if (!changes.length) return { hand, decision: { ...decision, reason: "agrees" } };
  const board = { flop: read.slice(0, 3), turn: read[3] ?? null, river: read[4] ?? null };
  return { hand: { ...hand, board }, decision: { applied: true, changes, reason: "suit-corrected-from-board-crop" } };
}

async function focusedActionRepairVerification({ imageBase64, mimeType, config }) {
  const prompt = buildFocusedActionRepairPrompt();
  const failures = [];
  let response;
  try {
    response = await callGeminiWithFailover({
      apiKey: config.geminiApiKey,
      models: orderedImportModels(config),
      systemInstruction: "You are a strict poker action-row verifier. Return JSON only.",
      temperature: 0,
      timeoutMs: FOCUSED_IMPORT_PROVIDER_TIMEOUT_MS,
      maxTokens: FOCUSED_ACTION_IMPORT_MAX_TOKENS,
      parts: [{ text: prompt }, { inlineData: { mimeType: mimeType || "image/png", data: imageBase64 } }],
    });
    response.provider = "gemini";
  } catch (error) {
    failures.push({ provider: "gemini-focused-action", error: error.message });
  }
  if (!response && config.openRouterApiKey) {
    try {
      response = await callOpenRouterWithFailover({
        apiKey: config.openRouterApiKey,
        models: orderedOpenRouterImportModels(config),
        systemInstruction: "You are a strict poker action-row verifier. Return JSON only.",
        prompt,
        imageBase64,
        mimeType: mimeType || "image/png",
        temperature: 0,
        timeoutMs: FOCUSED_IMPORT_PROVIDER_TIMEOUT_MS,
        maxTokens: FOCUSED_ACTION_IMPORT_MAX_TOKENS,
      });
    } catch (error) {
      failures.push({ provider: "openrouter-focused-action", error: error.message });
    }
  }
  if (!response) return { failures, repair: null };
  try {
    return {
      repair: extractJson(response.text),
      provider: response.provider,
      model: response.model,
      rawVisionOutput: response.text,
      failures: [...failures, ...(response.modelFailures || [])],
    };
  } catch (error) {
    return {
      repair: null,
      provider: response.provider,
      model: response.model,
      rawVisionOutput: response.text,
      failures: [...failures, { provider: `${response.provider || "model"}-focused-action`, error: error.message }],
    };
  }
}

export async function importHandFromScreenshot({ imageBase64, mimeType, config }) {
  if (!imageBase64) throw new Error("Missing screenshot image data.");

  const prompt = `Extract this poker hand-history screenshot into this exact JSON shape:
{
  "site": "CoinPoker" | "Natural8" | "Unknown",
  "handId": string | null,
  "game": string | null,
  "stakes": string | null,
  "heroName": string | null,
  "heroHand": string[],
  "board": { "flop": string[], "turn": string | null, "river": string | null },
  "players": [
    { "name": string, "position": "UTG" | "MP" | "CO" | "BTN" | "SB" | "BB" | null, "stackBb": number | null, "isHero": boolean }
  ],
  "streets": {
    "preflop": { "potBb": number | null, "actions": [{ "actor": string | null, "position": string | null, "action": string, "amountBb": number | null, "bubble": "yellow" | "white" | "blue" | null }] },
    "flop": { "potBb": number | null, "actions": [{ "actor": string | null, "position": string | null, "action": string, "amountBb": number | null, "bubble": "yellow" | "white" | "blue" | null }] },
    "turn": { "potBb": number | null, "actions": [{ "actor": string | null, "position": string | null, "action": string, "amountBb": number | null, "bubble": "yellow" | "white" | "blue" | null }] },
    "river": { "potBb": number | null, "actions": [{ "actor": string | null, "position": string | null, "action": string, "amountBb": number | null, "bubble": "yellow" | "white" | "blue" | null }] }
  },
  "confidenceNotes": string[]
}

Rules:
- Hero is always the bottom player/seat. Set heroName and isHero from that bottom seat only.
- heroHand must be the two cards attached to the bottom seat. Do not use another player's exposed showdown cards as heroHand.
- Inspect the bottom-seat cards independently from the board and winner display. If one bottom card is J♣ and the other is 7♣, return ["Jc","7c"], not a pocket pair.
- If the bottom-seat hero card rank/pip is visibly red, it cannot be clubs or spades. A red Jack must be Jd or Jh, never Jc or Js. A red 7 must be 7d or 7h, never 7c or 7s.
- If a bottom card is a red king with a heart symbol, return "Kh". Do not return "Ks" for a red card.
- If a bottom card is a red king with a diamond symbol, return "Kd". Do not default red kings to hearts; inspect the pip shape.
- Heart-vs-diamond rule for bottom hero cards: hearts have two rounded lobes and a pointed bottom; diamonds are a four-sided rhombus. If the bottom seat visibly shows A♥ and 6♥, return ["Ah","6h"], not ["Ad","6d"].
- If a bottom card is red with a diamond symbol, use diamonds. For example, red diamond-pip 2/7/A are "2d", "7d", "Ad". Do not return hearts just because the card is red.
- Read the community board from the large center cards, left to right. Do not let the lower hand-history text override a clearly visible center-board suit.
- Texas Hold'em board structure is mandatory: board.flop must contain exactly the first three community cards, board.turn must contain only the fourth card or null, and board.river must contain only the fifth card or null. Never put turn or river cards inside board.flop.
- The community board contains at most five unique physical cards. Never repeat a card across flop, turn, or river, and never copy either hero hole card onto the board.
- Community-card suit rule: black club/spade cards are not diamonds or hearts. A black 8/5/9 with a spade pip is "8s", "5s", or "9s".
- Community-card red rule: a board card whose rank digits and pip are red is hearts or diamonds, never spades or clubs. A red 10 with a heart pip is "Th", never "Ts". Read each board card's color independently; three flop cards may have mixed colors (e.g. black 8, black 3, red 10 = ["8s","3s","Th"]). Do not assume a flop is monotone.
- Cross-check the center board against the small board card strip at the bottom of the River column of the hand-history panel (same five cards, same colors); if they disagree on color, trust the color you can see most clearly and re-inspect that card's pip.
- If the center board shows three black spade pips on the flop, return all three flop cards as spades. Example: 8♠ 5♠ 9♠ must be ["8s","5s","9s"], not ["8s","5s","9d"].
- Use showdown labels as consistency checks. If a visible player with A♠ T♠ is labeled Flush, the board must contain three spades; re-check any black 8/5/9 board cards and do not mark one as diamonds.
- Hero hole cards and board cards cannot be the same physical card. If OCR creates a duplicate red card between bottom hero hand and board, re-check heart versus diamond pips before returning JSON.
- Keep chronological order exactly as shown in the bottom hand-history panel.
- Set each action's "bubble" to the colour of its action bubble: "yellow" for Hero's own unnamed bubbles, "white" for named players' bubbles, "blue" for RETURN rows. List every bubble as its own action in column order; never merge two bubbles or drop one (e.g. Pre-Flop can contain Hero "Raise 3 BB" followed by MP "Raise 8.6 BB").
- On every street, a yellow bubble at the top of that street's column, above any named row, is Hero acting first on that street (commonly "Check"). Include it as the first action of that street; never skip it.
- Hero's own actions are yellow bubbles with no avatar or name row (e.g. "Raise 3 BB", "Call 5.6 BB", "Check", "Call 30 BB"). Attribute every such bubble to the bottom-seat Hero, never to the named player row next to it. In Pre-Flop a yellow bubble at the top of the column, before any named row, is Hero's first action (an UTG open-raise acts before MP, CO, BTN, SB, BB); a yellow bubble at the bottom of the column is Hero's later response. If Hero acts on later streets, Hero must also have their own Pre-Flop action(s).
- Include blinds and antes only when displayed as actions; otherwise omit forced blind rows.
- If an action bubble says "Raise 19.8 BB", action is "raise" and amountBb is 19.8.
- Use "allin" only for an explicit ALLIN/all-in/shove/jam label or when the amount is visibly the player's entire remaining stack; a bet that merely matches is "call".
- On postflop streets after the pot is heads-up, actions must alternate between the remaining opponent and hero unless a row is a skipped RETURN/refund row.
- If text says "Bet 84 BB" and the next yellow bubble says "Fold", the fold actor may be inferred as the hero only if visually attached to hero's lane; otherwise use null.
- Extract all visible community cards and hero hole cards.
- In confidenceNotes, include a short hero-card color note when either bottom hero card is red, e.g. "Hero card color check: J and 7 are red diamonds."
- Return JSON only, minified on a single line: no indentation, no line breaks, and no spaces after colons or commas. Keep confidenceNotes to at most three short strings.`;

  const providerFailures = [];
  let response;
  let hand;
  let parsedVisionHand;
  const visionAttempts = [];
  let focusedHeroHandCheck = null;
  let focusedActionRepairCheck = null;
  let focusedActionRepairDecision = null;
  const importTimeoutMs = Number(config.screenshotImportTimeoutMs) > 0 ? Number(config.screenshotImportTimeoutMs) : SCREENSHOT_IMPORT_PROVIDER_TIMEOUT_MS;
  const providerAttempts = {
    gemini: async () => {
    try {
      response = await callGeminiWithFailover({
        apiKey: config.geminiApiKey,
        models: orderedImportModels(config),
        systemInstruction: HAND_IMPORT_SYSTEM_INSTRUCTION,
        temperature: 0.1,
        timeoutMs: importTimeoutMs,
        maxTokens: SCREENSHOT_IMPORT_MAX_TOKENS,
        validate: validateScreenshotImportOutput,
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: mimeType || "image/png",
              data: imageBase64,
            },
          },
        ],
      });
      response.provider = "gemini";
      visionAttempts.push({ provider: response.provider, model: response.model, rawVisionOutput: response.text });
      try {
        hand = extractJson(response.text);
        parsedVisionHand = structuredClone(hand);
      } catch (error) {
        providerFailures.push({
          provider: "gemini",
          model: response.model,
          error: error.message,
          rawPreview: responsePreview(response.text),
        });
        response = null;
      }
    } catch (error) {
      providerFailures.push({ provider: "gemini", error: error.message });
    }
    },
    openrouter: async () => {
    if (config.openRouterApiKey) {
      try {
        response = await callOpenRouterWithFailover({
          apiKey: config.openRouterApiKey,
          models: orderedOpenRouterImportModels(config),
          systemInstruction: HAND_IMPORT_SYSTEM_INSTRUCTION,
          prompt,
          imageBase64,
          mimeType: mimeType || "image/png",
          temperature: 0.1,
          timeoutMs: importTimeoutMs,
          reasoning: { enabled: false },
          repairJson: true,
          maxTokens: SCREENSHOT_IMPORT_MAX_TOKENS,
          validate: validateScreenshotImportOutput,
        });
        visionAttempts.push({ provider: response.provider, model: response.model, rawVisionOutput: response.text });
        try {
          hand = extractJson(response.text);
          parsedVisionHand = structuredClone(hand);
        } catch (error) {
          providerFailures.push({
            provider: "openrouter",
            model: response.model,
            error: error.message,
            rawPreview: responsePreview(response.text),
          });
          response = null;
        }
      } catch (error) {
        providerFailures.push({ provider: "openrouter", error: error.message });
      }
    }
    },
  };
  // A provider whose read fails the action-consistency checks is kept only as a fallback; the next provider gets a chance first.
  let unsafeFallback = null;
  for (const provider of importProviderOrder(config)) {
    if (response) break;
    await providerAttempts[provider]();
    if (response && hand) {
      const candidate = stripNonDecisionActions(attributeYellowBubblesToHero(repairImportedHeroHandFromNotes(structuredClone(hand))));
      if (!validateImportedActionConsistency(candidate).safe) {
        if (!unsafeFallback) unsafeFallback = { response, hand, parsedVisionHand };
        response = null;
        hand = null;
      }
    }
  }
  if (!response && unsafeFallback) ({ response, hand, parsedVisionHand } = unsafeFallback);

  if (!response) {
    const error = new Error(
      `All screenshot import providers failed. ${providerFailures
        .map(providerFailureSummary)
        .join(" | ")}`,
    );
    error.visionDebug = { visionAttempts, modelFailures: providerFailures };
    throw error;
  }

  hand = stripNonDecisionActions(attributeYellowBubblesToHero(repairImportedHeroHandFromNotes(hand)));
  const initialActionConsistency = validateImportedActionConsistency(hand);
  if (!initialActionConsistency.safe) {
    focusedActionRepairCheck = await focusedActionRepairVerification({ imageBase64, mimeType, config });
    if (focusedActionRepairCheck.repair) {
      focusedActionRepairDecision = applyFocusedActionRepair(hand, focusedActionRepairCheck.repair);
      if (focusedActionRepairDecision.accepted) hand = focusedActionRepairDecision.hand;
    }
    if (focusedActionRepairCheck.failures?.length) providerFailures.push(...focusedActionRepairCheck.failures);
  }
  focusedHeroHandCheck = await focusedHeroHandVerification({
    imageBase64,
    mimeType,
    hand,
    config,
    actionIssues: initialActionConsistency.issues,
  });
  if (focusedHeroHandCheck?.focused) {
    hand = applyFocusedHeroHandVerification(hand, focusedHeroHandCheck.focused);
  }
  if (focusedHeroHandCheck?.failures?.length) {
    providerFailures.push(...focusedHeroHandCheck.failures);
  }
  const focusedBoardCheck = await focusedBoardVerification({ imageBase64, mimeType, hand, config });
  if (focusedBoardCheck?.focused) {
    const boardResult = applyFocusedBoardVerification(hand, focusedBoardCheck.focused);
    hand = boardResult.hand;
    focusedBoardCheck.decision = boardResult.decision;
    if (boardResult.decision.applied) {
      hand.confidenceNotes = [...(hand.confidenceNotes || []), `Board suits corrected from board crop: ${boardResult.decision.changes.map((c) => `${c.from}->${c.to}`).join(", ")}.`];
    }
  }
  if (focusedBoardCheck?.failures?.length) providerFailures.push(...focusedBoardCheck.failures);
  const finalActionConsistency = validateImportedActionConsistency(hand);
  const actionAttribution = {
    safe: finalActionConsistency.safe,
    issues: finalActionConsistency.issues,
    repairAttempted: Boolean(focusedActionRepairCheck),
    repairAccepted: Boolean(focusedActionRepairDecision?.accepted),
    reason: finalActionConsistency.safe ? "verified" : (focusedActionRepairDecision?.reason || "repair-unavailable"),
  };
  hand.actionAttribution = actionAttribution;

  let validatedImport;
  try {
    validatedImport = normalizeAndValidateImportedCards(hand);
    hand = validatedImport.hand;
  } catch (error) {
    error.visionDebug = {
      provider: response.provider,
      model: response.model,
      attemptedModels: response.attemptedModels,
      modelFailures: [...providerFailures, ...(response.modelFailures || [])],
      visionAttempts,
      rawVisionOutput: response.text,
      parsedVisionHand,
      focusedHeroRawVisionOutput: focusedHeroHandCheck?.rawVisionOutput || null,
      focusedHeroParsedOutput: focusedHeroHandCheck?.focused || null,
      focusedHeroCropRegion: focusedHeroHandCheck?.cropRegion || null,
      focusedHeroCropFailure: focusedHeroHandCheck?.cropFailure || null,
      focusedHeroDecision: hand.focusedHeroDecision || null,
      focusedBoardRawVisionOutput: focusedBoardCheck?.rawVisionOutput || null,
      focusedBoardDecision: focusedBoardCheck?.decision || null,
    };
    throw error;
  }

  if (isPokerCoachErrorScreenshot(hand)) {
    throw new Error(
      "This looks like a screenshot of Poker Coach's import error page, not the original poker hand-history screenshot. Upload or paste the original table screenshot so the cards and action panel are full size.",
    );
  }

  return {
    hand,
    provider: response.provider,
    model: response.model,
    attemptedModels: response.attemptedModels,
    modelFailures: [...providerFailures, ...(response.modelFailures || [])],
    focusedHeroHandCheck: focusedHeroHandCheck
      ? {
          provider: focusedHeroHandCheck.provider,
          model: focusedHeroHandCheck.model,
          focused: focusedHeroHandCheck.focused,
        }
      : null,
    normalizationNotes: validatedImport.notes,
    validationWarnings: validatedImport.warnings,
    actionAttribution,
    debug: {
      visionAttempts,
      rawVisionOutput: response.text,
      parsedVisionHand,
      focusedHeroRawVisionOutput: focusedHeroHandCheck?.rawVisionOutput || null,
      focusedHeroParsedOutput: focusedHeroHandCheck?.focused || null,
      focusedHeroCropRegion: focusedHeroHandCheck?.cropRegion || null,
      focusedHeroCropFailure: focusedHeroHandCheck?.cropFailure || null,
      focusedHeroDecision: hand.focusedHeroDecision || null,
      focusedBoardRawVisionOutput: focusedBoardCheck?.rawVisionOutput || null,
      focusedBoardDecision: focusedBoardCheck?.decision || null,
      focusedActionRepairRawVisionOutput: focusedActionRepairCheck?.rawVisionOutput || null,
      focusedActionRepairParsedOutput: focusedActionRepairCheck?.repair || null,
      focusedActionRepairProvider: focusedActionRepairCheck?.provider || null,
      focusedActionRepairModel: focusedActionRepairCheck?.model || null,
      actionConsistencyIssues: finalActionConsistency.issues,
      focusedActionRepairDecision,
      actionAttributionSafe: actionAttribution.safe,
      validationWarnings: validatedImport.warnings,
    },
  };
}

export async function checkGeminiModelStatus({ config, mode = "analysis" }) {
  const models = mode === "import" ? orderedImportModels(config) : orderedAnalysisModels(config);
  const checks = [];
  for (const model of models) {
    try {
      const response = await callGemini({
        apiKey: config.geminiApiKey,
        model,
        systemInstruction: "Reply with exactly OK.",
        prompt: "OK",
        temperature: 0,
      });
      checks.push({ model, ok: true, response: response.text });
    } catch (error) {
      checks.push({ model, ok: false, error: error.message });
    }
  }
  return {
    mode,
    models,
    checks,
    note: "This probe uses one generateContent request per model checked. Google does not expose an exact remaining free-tier quota counter through this app.",
  };
}
