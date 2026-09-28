(function attachLLMRangeGuard(global) {
  const STREET_ORDER = ["preflop", "flop", "turn", "river"];

  function comboLabel(combo) {
    return Array.isArray(combo) ? combo.join(" ") : String(combo || "");
  }

  function handClassFromCombo(combo) {
    if (!Array.isArray(combo) || combo.length !== 2) return null;
    const rankValue = "23456789TJQKA";
    const [cardA, cardB] = combo;
    const rankA = cardA?.[0];
    const rankB = cardB?.[0];
    const suitA = cardA?.[1];
    const suitB = cardB?.[1];
    if (!rankA || !rankB) return null;
    if (rankA === rankB) return rankA + rankB;
    const ordered = [rankA, rankB].sort((a, b) => rankValue.indexOf(b) - rankValue.indexOf(a));
    return ordered.join("") + (suitA === suitB ? "s" : "o");
  }

  function rangeTextFromCombos(combos) {
    const classes = [];
    const seen = new Set();
    for (const combo of combos || []) {
      const handClass = handClassFromCombo(combo);
      if (!handClass || seen.has(handClass)) continue;
      seen.add(handClass);
      classes.push(handClass);
    }
    return classes.join(",");
  }

  function comboMap(range) {
    const map = new Map();
    for (const combo of range?.combos || []) {
      map.set(comboLabel(combo), combo);
    }
    return map;
  }

  function intersectRangeWithPrevious(range, previousMap) {
    if (!previousMap) return { combos: range?.combos || [], removed: 0 };
    const combos = [];
    let removed = 0;
    for (const combo of range?.combos || []) {
      const label = comboLabel(combo);
      if (previousMap.has(label)) combos.push(combo);
      else removed += 1;
    }
    return { combos, removed };
  }

  function rangeFromCombos(combos, originalRange = {}) {
    const keep = new Set((combos || []).map(comboLabel));
    const breakdown = (originalRange.breakdown || [])
      .map((item) => {
        const liveCombos = (item.combos || []).filter((combo) => keep.has(comboLabel(combo)));
        return {
          ...item,
          combos: liveCombos,
          liveCount: liveCombos.length,
          blockedCount: Math.max((item.theoreticalCount || liveCombos.length) - liveCombos.length, 0),
        };
      })
      .filter((item) => item.combos.length > 0);
    return {
      ...originalRange,
      combos,
      breakdown,
      classes: breakdown.length ? breakdown.map((item) => item.handClass) : [...new Set(combos.map(handClassFromCombo).filter(Boolean))],
    };
  }

  function parseStageRange(item, helpers) {
    const knownCards = helpers.knownCardsThroughStreet(
      helpers.heroCards || [],
      helpers.boardCards || [],
      item.street || "preflop",
    );
    return helpers.parseRange(item.rangeText || "", knownCards);
  }

  function stageBoardCards(item, helpers) {
    return helpers.knownCardsThroughStreet(
      helpers.heroCards || [],
      helpers.boardCards || [],
      item.street || "preflop",
    );
  }

  function drawStatsForStage(item, parsed, helpers) {
    if (typeof helpers.comboFactCheck !== "function" || !parsed?.combos?.length) {
      return null;
    }
    const boardCards = stageBoardCards(item, helpers);
    const facts = parsed.combos.map((combo) => helpers.comboFactCheck(combo, boardCards, item.street));
    const drawCount = facts.filter((fact) => fact?.draw || fact?.flushDraw || fact?.straightDraw).length;
    return {
      drawCount,
      total: facts.length,
    };
  }

  function factCheckReasoning(item, parsed, helpers) {
    const reasoning = String(item.reasoning || "");
    if (!/\b(strong\s+draws?|draws?|semi-?bluffs?)\b/i.test(reasoning)) {
      return { reasoning, caveat: "" };
    }
    const drawStats = drawStatsForStage(item, parsed, helpers);
    if (!drawStats || drawStats.drawCount > 0) return { reasoning, caveat: "" };
    const corrected = reasoning
      .replace(/\bstrong\s+draws?\b/gi, "hands not verified as draws")
      .replace(/\bsemi-?bluffs?\b/gi, "possible non-made hands")
      .replace(/\bdraws?\b/gi, "hands not verified as draws");
    return {
      reasoning: `${corrected} Fact check: none of the parsed live combos show a flush draw or straight draw on this street.`,
      caveat: `${item.street} LLM draw claim was fact-checked: 0 of ${drawStats.total} live combos were flush draws or straight draws on the board.`,
    };
  }

  function expectedSummaries(interpretation = {}) {
    const activeIndex = Math.max(STREET_ORDER.indexOf(interpretation.street || "preflop"), 0);
    const supplied = new Map(
      (interpretation.streetSummaries || [])
        .filter((item) => item?.street)
        .map((item) => [item.street, item]),
    );
    return STREET_ORDER.slice(0, activeIndex + 1).map((street) => {
      const suppliedItem = supplied.get(street);
      if (suppliedItem) return { ...suppliedItem, street };
      return {
        street,
        reasoning:
          street === interpretation.street
            ? interpretation.summary || "LLM final range for this street."
            : "The LLM did not provide a separate cumulative range for this street.",
        rangeText: street === interpretation.street ? interpretation.rangeText || "" : "",
      };
    });
  }

  function sanitizeLLMRangeInterpretation({
    interpretation = {},
    parseRange,
    knownCardsThroughStreet,
    heroCards = [],
    boardCards = [],
    comboFactCheck = null,
    freezeCurrentStreetToPriorRange = false,
  }) {
    const caveats = [...(interpretation.caveats || [])];
    const summaries = expectedSummaries(interpretation);
    let previousMap = null;
    let previousRangeText = "";
    const sanitizedSummaries = summaries.map((item) => {
      let parsed = null;
      let error = null;
      let removed = 0;
      try {
        if (freezeCurrentStreetToPriorRange && item.street === interpretation.street && previousRangeText) {
          item = {
            ...item,
            rangeText: previousRangeText,
            reasoning: "No villain action has occurred on this street before Hero's decision; the prior-street range is retained subject only to known-card removal.",
          };
          caveats.push(`${item.street} range retained from the prior-street range because Hero acts before any villain action.`);
        }
        parsed = parseStageRange(item, { parseRange, knownCardsThroughStreet, heroCards, boardCards });
        const narrowed = intersectRangeWithPrevious(parsed, previousMap);
        removed = narrowed.removed;
        if (previousMap) parsed = rangeFromCombos(narrowed.combos, parsed);
      } catch (parseError) {
        error = parseError.message;
      }

      const snapshot = parsed
        ? {
            combos: parsed.combos.length,
            handClasses: parsed.breakdown?.filter((entry) => entry.liveCount > 0).map((entry) => entry.handClass) || [],
          }
        : { combos: 0, handClasses: [] };
      const rangeText = parsed && previousMap ? rangeTextFromCombos(parsed.combos) : item.rangeText || "";
      const checked = factCheckReasoning(item, parsed, {
        knownCardsThroughStreet,
        heroCards,
        boardCards,
        comboFactCheck,
      });
      if (checked.caveat) caveats.push(checked.caveat);
      if (removed > 0) {
        caveats.push(
          `${item.street} LLM range was intersected with the prior street; removed ${removed} combo${removed === 1 ? "" : "s"} that were not present previously.`,
        );
      }
      previousMap = parsed ? comboMap(parsed) : previousMap;
      previousRangeText = rangeText || previousRangeText;
      return {
        ...item,
        reasoning: checked.reasoning,
        rangeText,
        parsedRange: parsed,
        parseError: error,
        snapshot,
      };
    });

    const finalSummary = sanitizedSummaries[sanitizedSummaries.length - 1];
    return {
      ...interpretation,
      rangeText: finalSummary?.rangeText || interpretation.rangeText || "",
      streetSummaries: sanitizedSummaries,
      caveats,
    };
  }

  global.PokerCoachLLMRangeGuard = {
    sanitizeLLMRangeInterpretation,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
