(function attachImportAnalysisPrefetchModel(global) {
  const POSTFLOP_STREETS = ["flop", "turn", "river"];
  const OPPONENT_PRESSURE_ACTIONS = new Set(["bet", "raise", "allin"]);
  const NON_DECISION_ACTIONS = new Set(["blind", "ante", "refund", "win", "muck", "fold"]);

  function candidatePriority({ action, targetIsHero, firstActionOnStreet }) {
    if (!targetIsHero && action === "allin") return 0;
    if (!targetIsHero && action === "raise") return 1;
    if (!targetIsHero && action === "bet") return 2;
    if (targetIsHero && firstActionOnStreet) return 4;
    return 5;
  }

  function rankImportedPostflopCandidates(hand, heroName, isHeroAction, limit = 2) {
    let order = 0;
    const candidates = POSTFLOP_STREETS.flatMap((street) => {
      const streetState = hand?.streets?.[street] || {};
      const potBb = Number(streetState.potBb);
      const firstActionableIndex = (streetState.actions || [])
        .findIndex((action) => !NON_DECISION_ACTIONS.has(action?.action));
      return (streetState.actions || []).flatMap((action, index) => {
        const stableOrder = order;
        order += 1;
        const targetIsHero = Boolean(isHeroAction?.(hand, action, heroName));
        if (!targetIsHero && !OPPONENT_PRESSURE_ACTIONS.has(action?.action)) return [];
        if (targetIsHero) {
          const precedingAction = (streetState.actions || [])
            .slice(0, index)
            .reverse()
            .find((previousAction) => !NON_DECISION_ACTIONS.has(previousAction?.action));
          if (
            precedingAction &&
            !isHeroAction?.(hand, precedingAction, heroName) &&
            OPPONENT_PRESSURE_ACTIONS.has(precedingAction?.action)
          ) return [];
        }
        if (!targetIsHero) {
          const responder = (streetState.actions || [])
            .slice(index + 1)
            .find((nextAction) => !NON_DECISION_ACTIONS.has(nextAction?.action));
          if (responder && !isHeroAction?.(hand, responder, heroName)) return [];
        }
        const amountBb = Number(action?.amountBb);
        const betToPotRatio = Number.isFinite(amountBb) && Number.isFinite(potBb) && potBb > 0
          ? amountBb / potBb
          : -1;
        return [{
          street,
          index,
          action,
          priority: candidatePriority({
            action: action?.action,
            targetIsHero,
            firstActionOnStreet: index === firstActionableIndex,
          }),
          betToPotRatio,
          order: stableOrder,
        }];
      });
    });

    return candidates
      .sort((left, right) =>
        left.priority - right.priority ||
        right.betToPotRatio - left.betToPotRatio ||
        left.order - right.order)
      .slice(0, Math.max(0, Number(limit) || 0));
  }

  function createImportAnalysisPrefetchQueue({ worker, onStatusChange = () => {} }) {
    let generation = 0;
    let entries = [];
    let active = null;
    const entriesByKey = new Map();

    function transition(entry, status) {
      entry.status = status;
      onStatusChange({ key: entry.key, status, entry });
    }

    function pump() {
      if (active) return;
      const entry = entries.find((candidate) => candidate.status === "queued");
      if (!entry) return;
      const runGeneration = generation;
      active = entry;
      transition(entry, "running");
      try {
        entry.promise = Promise.resolve(worker(entry));
      } catch (error) {
        entry.promise = Promise.reject(error);
      }
      entry.promise.then(
        () => {
          if (generation === runGeneration) transition(entry, "completed");
        },
        () => {
          if (generation === runGeneration) transition(entry, "failed");
        },
      ).finally(() => {
        if (active === entry) active = null;
        pump();
      });
    }

    function cancel() {
      generation += 1;
      entries = [];
      entriesByKey.clear();
    }

    function replace(nextEntries) {
      cancel();
      const seen = new Set();
      entries = (nextEntries || []).flatMap((entry) => {
        if (!entry?.key || seen.has(entry.key)) return [];
        seen.add(entry.key);
        const queued = { ...entry, status: "queued", promise: null };
        entriesByKey.set(queued.key, queued);
        transition(queued, "queued");
        return [queued];
      });
      pump();
    }

    function promote(key) {
      const entry = entriesByKey.get(key);
      if (!entry || entry.status !== "queued") return false;
      entries = [entry, ...entries.filter((candidate) => candidate !== entry)];
      return true;
    }

    function status(key) {
      return entriesByKey.get(key)?.status || null;
    }

    function promiseFor(key) {
      return entriesByKey.get(key)?.promise || null;
    }

    return { replace, promote, status, promiseFor, cancel };
  }

  global.PokerCoachImportAnalysisPrefetchModel = {
    createImportAnalysisPrefetchQueue,
    rankImportedPostflopCandidates,
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
