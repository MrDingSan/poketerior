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

  // Whole hand classes where every live combo survived, exact combos (AhKh) where only some did: writing a
  // partial class as its bare label would re-parse to the full class and silently widen the range again.
  function rangeTextFromCombos(combos, fullClassCount = null) {
    const byClass = new Map();
    for (const combo of combos || []) {
      const handClass = handClassFromCombo(combo);
      if (!handClass) continue;
      if (!byClass.has(handClass)) byClass.set(handClass, []);
      byClass.get(handClass).push(combo);
    }
    const tokens = [];
    for (const [handClass, classCombos] of byClass) {
      const full = fullClassCount ? fullClassCount(handClass) : classCombos.length;
      if (classCombos.length >= full) tokens.push(handClass);
      else tokens.push(...classCombos.map((combo) => combo.join("")));
    }
    return tokens.join(",");
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

  function mergeBreakdown(range, extra) {
    const byClass = new Map();
    for (const entry of [...(range?.breakdown || []), ...(extra?.breakdown || [])]) {
      const existing = byClass.get(entry.handClass);
      if (!existing) byClass.set(entry.handClass, { ...entry, combos: [...(entry.combos || [])] });
      else {
        const seen = new Set(existing.combos.map(comboLabel));
        existing.combos.push(...(entry.combos || []).filter((combo) => !seen.has(comboLabel(combo))));
      }
    }
    return { ...range, breakdown: [...byClass.values()] };
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

  // The action-bucket chart is drawn from weightedGroups, which the model writes independently of its
  // rangeText. Cut each group down to the street's final (narrowed) range - first group wins a combo, as
  // in the chart - and put any in-range combo no group claimed into a catch-all, so the chart shows
  // exactly the combos that are counted.
  function sanitizeWeightedGroups(groups, finalSummary, fullClassCount, parseGroup) {
    const finalRange = finalSummary?.parsedRange;
    if (!Array.isArray(groups) || !finalRange) return groups;
    const unclaimed = comboMap(finalRange);
    const sanitized = [];
    for (const group of groups) {
      if (!group) continue;
      let parsed;
      try {
        parsed = parseGroup(group.rangeText);
      } catch {
        continue;
      }
      const combos = (parsed?.combos || []).filter((combo) => unclaimed.has(comboLabel(combo)));
      if (!combos.length) continue;
      for (const combo of combos) unclaimed.delete(comboLabel(combo));
      sanitized.push({ ...group, rangeText: rangeTextFromCombos(combos, fullClassCount) });
    }
    if (unclaimed.size) {
      sanitized.push({
        label: "Other hands in range",
        rangeText: rangeTextFromCombos([...unclaimed.values()], fullClassCount),
        reasoning: "In the narrowed range but not assigned to any action bucket by the model.",
      });
    }
    return sanitized;
  }

  function sanitizeLLMRangeInterpretation({
    interpretation = {},
    parseRange,
    knownCardsThroughStreet,
    heroCards = [],
    boardCards = [],
    comboFactCheck = null,
    freezeCurrentStreetToPriorRange = false,
    locks = [],
    ceilings = [],
    floors = [],
  }) {
    const caveats = [...(interpretation.caveats || [])];
    const ceilingByStreet = new Map((ceilings || []).filter((item) => item?.street && item?.rangeText).map((item) => [item.street, item.rangeText]));
    // Streets this hand already established for this exact villain line: use them as is.
    const lockByStreet = new Map((locks || []).filter((item) => item?.street && item?.rangeText).map((item) => [item.street, item.rangeText]));
    const floorByStreet = new Map((floors || []).filter((item) => item?.street && item?.rangeText).map((item) => [item.street, item.rangeText]));
    const summaries = expectedSummaries(interpretation);
    let previousMap = null;
    let previousRangeText = "";
    function classCounter(item) {
      const cache = new Map();
      return (handClass) => {
        if (!cache.has(handClass)) {
          try {
            cache.set(handClass, parseStageRange({ ...item, rangeText: handClass }, { parseRange, knownCardsThroughStreet, heroCards, boardCards }).combos.length);
          } catch {
            cache.set(handClass, Infinity);
          }
        }
        return cache.get(handClass);
      };
    }
    const sanitizedSummaries = summaries.map((item) => {
      let parsed = null;
      let error = null;
      let removed = 0;
      let ceilingApplied = false;
      try {
        if (freezeCurrentStreetToPriorRange && item.street === interpretation.street && previousRangeText) {
          item = {
            ...item,
            rangeText: previousRangeText,
            reasoning: "No villain action has occurred on this street before Hero's decision; the prior-street range is retained subject only to known-card removal.",
          };
          caveats.push(`${item.street} range retained from the prior-street range because Hero acts before any villain action.`);
        }
        // No range for this street at all: the model gave no information, so nothing narrows here.
        if (!String(item.rangeText || "").trim() && previousRangeText) {
          item = { ...item, rangeText: previousRangeText };
          caveats.push(`${item.street} range was missing from the model's answer; the previous street's range is carried forward.`);
        }
        const lockText = lockByStreet.get(item.street);
        if (lockText && lockText !== item.rangeText) {
          item = { ...item, rangeText: lockText };
          caveats.push(`${item.street} range kept as already established earlier in this hand.`);
        }
        parsed = parseStageRange(item, { parseRange, knownCardsThroughStreet, heroCards, boardCards });
        const narrowed = intersectRangeWithPrevious(parsed, previousMap);
        removed = narrowed.removed;
        if (previousMap) parsed = rangeFromCombos(narrowed.combos, parsed);
        // An earlier analysis of this hand already saw villain reach this street with fewer actions, so its
        // range bounds this one: villain's later actions can only narrow it, never add combos back.
        const ceilingText = ceilingByStreet.get(item.street);
        if (ceilingText) {
          const ceilingParsed = parseStageRange({ ...item, rangeText: ceilingText }, { parseRange, knownCardsThroughStreet, heroCards, boardCards });
          const ceilingNarrowed = intersectRangeWithPrevious(ceilingParsed, previousMap);
          const ceilingRange = previousMap ? rangeFromCombos(ceilingNarrowed.combos, ceilingParsed) : ceilingParsed;
          const capped = intersectRangeWithPrevious(parsed, comboMap(ceilingRange));
          if (capped.removed > 0) {
            // No overlap means the model's guess has nothing in common with the earlier range; keep the earlier one.
            parsed = capped.combos.length ? rangeFromCombos(capped.combos, parsed) : ceilingRange;
            ceilingApplied = true;
            caveats.push(
              `${item.street} range capped by the earlier analysis of this street; removed ${capped.removed} combo${capped.removed === 1 ? "" : "s"} it had already excluded.`,
            );
          }
        }
        // A later point on this street was already analyzed; everything villain holds there, villain holds
        // here too. Add back any of it the model dropped (still within the previous street's range).
        const floorText = floorByStreet.get(item.street);
        if (floorText) {
          const floorParsed = parseStageRange({ ...item, rangeText: floorText }, { parseRange, knownCardsThroughStreet, heroCards, boardCards });
          const have = comboMap(parsed);
          const missing = intersectRangeWithPrevious(floorParsed, previousMap).combos.filter((combo) => !have.has(comboLabel(combo)));
          if (missing.length) {
            parsed = rangeFromCombos([...parsed.combos, ...missing], mergeBreakdown(parsed, floorParsed));
            ceilingApplied = true;
            caveats.push(
              `${item.street} range widened to include the ${missing.length} combo${missing.length === 1 ? "" : "s"} a later analysis of this street already kept.`,
            );
          }
        }
      } catch (parseError) {
        error = parseError.message;
      }

      const snapshot = parsed
        ? {
            combos: parsed.combos.length,
            handClasses: parsed.breakdown?.filter((entry) => entry.liveCount > 0).map((entry) => entry.handClass) || [],
          }
        : { combos: 0, handClasses: [] };
      const rangeText = parsed && (previousMap || ceilingApplied) ? rangeTextFromCombos(parsed.combos, classCounter(item)) : item.rangeText || "";
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
      // A stage that parsed to nothing is unreadable, not "villain has no hands": don't let it empty every
      // later street through the intersection.
      if (parsed && !parsed.combos.length && item.rangeText) {
        caveats.push(`${item.street} range text could not be read ("${String(item.rangeText).slice(0, 40)}"); later streets were not narrowed by it.`);
      }
      previousMap = parsed?.combos.length ? comboMap(parsed) : previousMap;
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
      weightedGroups: sanitizeWeightedGroups(interpretation.weightedGroups, finalSummary, classCounter(finalSummary || {}), (rangeText) =>
        parseStageRange({ street: finalSummary?.street, rangeText: rangeText || "" }, { parseRange, knownCardsThroughStreet, heroCards, boardCards }),
      ),
      rangeText: finalSummary?.rangeText || interpretation.rangeText || "",
      streetSummaries: sanitizedSummaries,
      caveats,
    };
  }

  global.PokerCoachLLMRangeGuard = {
    sanitizeLLMRangeInterpretation,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
