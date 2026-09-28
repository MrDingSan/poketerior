(function attachImportEngineV2(root) {
  const TYPES = root.PokerCoachImportTypes;
  const STREETS = TYPES.STREETS;
  const HIGH = TYPES.CONFIDENCE_THRESHOLDS.high;
  const MEDIUM = TYPES.CONFIDENCE_THRESHOLDS.medium;
  const AMOUNT_BEARING = new Set(["bet", "raise", "call", "allin", "blind", "ante"]);
  const ACTOR_ISSUES = new Set(["unknown-actor", "missing-actor", "action-after-fold", "self-response"]);

  const round = (value) => Math.round(value * 1e6) / 1e6;

  function stageOfField(field) {
    const text = String(field || "");
    if (text.startsWith("hero.")) return "heroCards";
    if (text.startsWith("board.")) return "board";
    const match = text.match(/^(?:actions|streetPots)\.(preflop|flop|turn|river)\b/);
    return match ? match[1] : null;
  }

  function actionTarget(field) {
    const match = String(field || "").match(/^actions\.(preflop|flop|turn|river)\.(\d+)(\.amountBb)?$/);
    return match ? { street: match[1], index: Number(match[2]), amount: Boolean(match[3]) } : null;
  }

  function create(deps) {
    const {
      registry,
      recognizers,
      fallback = null,
      validator = root.PokerCoachImportValidator,
      parser = root.PokerCoachImportActionParser,
      legacyAdapter = root.PokerCoachLegacyImportAdapter,
      builderAdapter = root.PokerCoachImportBuilderAdapter,
      createProgress = (options) => root.PokeTeriorImportProgress.createStageProgress(options),
      discoverDecisions = (converted) => Object.keys(converted?.actionIndex || {}),
    } = deps;

    async function importHand(source, options = {}) {
      const progress = createProgress({ onChange: options.onProgress });
      const statuses = {};
      const setStatus = (stage, status, detail) => {
        progress[{ running: "start", complete: "complete", warning: "warn", error: "fail" }[status]](stage, detail);
        statuses[stage] = status;
      };

      setStatus("site", "running");
      const detected = registry.detect({ width: source.width, height: source.height, anchors: options.anchors || source.anchors || {} });
      if (!detected.supported) {
        setStatus("site", "warning", { message: "The screenshot layout is not a supported Natural8 layout; use the full-image importer." });
        return {
          route: "legacy",
          reason: "unsupported-layout",
          detection: detected.detection,
          attempts: detected.attempts,
          progress: progress.snapshot().byId,
          fullImageProviderCalls: 0,
          fallbackCalls: [],
        };
      }
      const { adapter, detection } = detected;
      setStatus("site", "complete", { message: `${detection.site || adapter.site} layout ${adapter.profile} detected.` });
      const layout = adapter.regions({ width: source.width, height: source.height });
      const context = { source, layout, detection, adapter, importId: options.importId || null, signal: options.signal };

      const state = { hero: null, board: null, streets: {}, errors: {} };
      const fallbackLog = [];
      const requested = new Set();

      const jobs = {
        heroCards: (attempt) => recognizers.heroCards({ ...context, attempt }),
        board: (attempt) => recognizers.board({ ...context, attempt }),
        ...Object.fromEntries(STREETS.map((street) => [street, (attempt) => recognizers.streets[street]({ ...context, attempt })])),
      };

      // ---- turning a recognizer result into a scored entry --------------------------------------------------
      function evaluate(stage, value) {
        if (stage === "heroCards") {
          return { entry: { cards: value.cards || [], confidence: value.confidence ?? 0, heroName: value.heroName ?? null, heroPosition: value.heroPosition ?? null, region: value.sourceRegion || null }, score: value.confidence ?? 0 };
        }
        if (stage === "board") {
          return { entry: { flop: value.flop || [], turn: value.turn || null, river: value.river || null, confidence: value.confidence ?? 0, region: value.sourceRegion || null }, score: value.confidence ?? 0 };
        }
        const parsed = parser.parseStreet(
          (value.rows || []).map((row) => ({ text: row.text, actorName: row.actorName, position: row.position, sourceRegion: row.sourceRegion })),
          { street: stage },
        );
        return { entry: { rec: value, parsed }, score: Math.min(value.confidence ?? 0, parsed.confidence) };
      }

      function commit(stage, entry) {
        if (stage === "heroCards") state.hero = entry;
        else if (stage === "board") state.board = entry;
        else state.streets[stage] = entry;
      }

      function stageFieldRefs(stage, entry) {
        if (stage === "heroCards") return ["hero.cards"];
        if (stage === "board") return ["board.flop", "board.turn", "board.river"].filter((ref) => (ref === "board.flop" ? entry.flop.length : entry[ref.split(".")[1]]));
        return [`actions.${stage}`, ...entry.parsed.warnings.map((warning) => warning.field).filter(Boolean)];
      }

      function reportCompletion(stage, evaluated) {
        const message = evaluated.score >= HIGH ? undefined : `${stage} recognized with ${Math.round(evaluated.score * 100)}% confidence.`;
        if (evaluated.score >= HIGH) setStatus(stage, "complete");
        else setStatus(stage, "warning", { message, fieldRefs: stageFieldRefs(stage, evaluated.entry) });
      }

      // ---- canonical hand assembly ---------------------------------------------------------------------------
      function buildHand() {
        const hero = state.hero;
        const names = [];
        const positions = new Map();
        const remember = (name, position) => {
          if (!name) return;
          if (!names.includes(name)) names.push(name);
          if (position && !positions.get(name)) positions.set(name, position);
        };
        for (const street of STREETS) for (const action of state.streets[street]?.parsed.actions || []) remember(action.actorName, action.position);
        const heroName = hero?.heroName || options.heroName || null;
        remember(heroName, hero?.heroPosition);
        const players = names.map((name, index) => ({ id: `player:${index}`, name, position: positions.get(name) || null, isHero: name === heroName }));
        const idByName = new Map(players.map((player) => [player.name, player.id]));

        const actions = {};
        const fields = { "hero.cards": hero ? hero.confidence : 0 };
        const streetPots = {};
        const warnings = [];
        if (state.board) {
          if (state.board.flop.length) fields["board.flop"] = state.board.confidence;
          if (state.board.turn) fields["board.turn"] = state.board.confidence;
          if (state.board.river) fields["board.river"] = state.board.confidence;
        } else {
          fields["board.flop"] = 0;
        }
        for (const street of STREETS) {
          const entry = state.streets[street];
          actions[street] = (entry?.parsed.actions || []).map((action) => ({ ...action, actorId: idByName.get(action.actorName) || null }));
          streetPots[street] = entry?.rec.potBb ?? null;
          warnings.push(...(entry?.parsed.warnings || []));
          if (!entry) fields[`actions.${street}`] = 0;
          actions[street].forEach((action, index) => {
            const confidence = Math.min(entry.rec.confidence ?? 0, entry.parsed.confidences[index] ?? 1);
            fields[`actions.${street}.${index}`] = confidence;
            if (AMOUNT_BEARING.has(action.type)) fields[`actions.${street}.${index}.amountBb`] = confidence;
          });
        }
        const confidenceValues = Object.values(fields);
        return TYPES.normalizeParsedHand({
          source: { kind: "screenshot", site: detection.site || adapter.site, adapterId: adapter.id, adapterVersion: adapter.version, importId: context.importId },
          hero: { playerId: players.find((player) => player.isHero)?.id || null, name: heroName, position: hero?.heroPosition || null, cards: hero?.cards || [] },
          players,
          board: { flop: state.board?.flop || [], turn: state.board?.turn || null, river: state.board?.river || null },
          actions,
          streetPots,
          confidence: { overall: confidenceValues.length ? Math.min(...confidenceValues) : 0, fields },
          warnings,
        });
      }

      function emitPartial() {
        if (!options.onPartial) return;
        try {
          options.onPartial(buildHand());
        } catch {
          // a half-recognized hand may not normalize yet; the next completion will emit again
        }
      }

      // ---- the six independent recognition jobs -------------------------------------------------------------
      function track(stage) {
        setStatus(stage, "running");
        return (async () => jobs[stage](0))().then(
          (value) => {
            const evaluated = evaluate(stage, value);
            commit(stage, evaluated.entry);
            reportCompletion(stage, evaluated);
            emitPartial();
            return value;
          },
          (error) => {
            state.errors[stage] = error;
            setStatus(stage, "error", { message: `${stage} recognition failed: ${error.message}`, fieldRefs: [stage === "heroCards" ? "hero.cards" : stage === "board" ? "board.flop" : `actions.${stage}`] });
            throw error;
          },
        );
      }

      await Promise.allSettled(Object.keys(jobs).map(track));

      // ---- validation, one scoped deterministic retry round, then targeted AI ---------------------------------
      let validationStarted = false;
      const validate = () => {
        if (!validationStarted) {
          validationStarted = true;
          setStatus("validation", "running");
        }
        return validator.validate(buildHand(), { strictReplay: true });
      };
      let validation = validate();

      const retryStages = new Set();
      for (const [field, value] of Object.entries(validation.hand.confidence.fields)) {
        if (value >= MEDIUM && value < HIGH) retryStages.add(stageOfField(field));
      }
      for (const issue of validation.warnings) {
        if (issue.severity === "warning" && issue.correctable) retryStages.add(stageOfField(issue.field));
      }
      retryStages.delete(null);
      if (retryStages.size) {
        await Promise.all([...retryStages].map(async (stage) => {
          try {
            const evaluated = evaluate(stage, await jobs[stage](1));
            const current = stage === "heroCards" ? state.hero : stage === "board" ? state.board : state.streets[stage];
            const currentScore = current ? (stage === "heroCards" || stage === "board" ? current.confidence : Math.min(current.rec.confidence ?? 0, current.parsed.confidence)) : -1;
            if (evaluated.score > currentScore) {
              commit(stage, evaluated.entry);
              if (evaluated.score >= HIGH && statuses[stage] !== "complete") setStatus(stage, "complete");
            }
          } catch {
            // a failed retry keeps the original recognition
          }
        }));
        validation = validate();
      }

      const targets = new Map();
      const addTarget = (field, code) => {
        const action = actionTarget(field);
        const key = action ? `${action.street}:${action.index}` : field;
        const existing = targets.get(key);
        if (existing && !(action && action.amount && !existing.action.amount)) return;
        targets.set(key, { field, code, action });
      };
      for (const issue of validation.warnings) if (issue.severity === "error" && issue.correctable && issue.field) addTarget(issue.field, issue.code);
      for (const [field, value] of Object.entries(validation.hand.confidence.fields)) if (value < MEDIUM) addTarget(field, null);

      const requests = [];
      for (const target of targets.values()) {
        if (!fallback || requested.has(target.field)) continue;
        const request = buildRequest(target);
        if (!request) continue;
        requested.add(target.field);
        requests.push(request);
      }

      function buildRequest({ field, code, action }) {
        const base = { field, importId: context.importId, site: detection.site || adapter.site };
        if (field === "hero.cards" || field.startsWith("hero.")) {
          return state.hero?.region ? { ...base, purpose: "hero-cards", region: state.hero.region, context: { candidates: state.hero.cards } } : null;
        }
        if (field.startsWith("board.")) {
          return state.board?.region ? { ...base, purpose: "board-card", region: state.board.region, context: { which: field.split(".")[1], candidates: state.board } } : null;
        }
        if (!action) return null;
        const recorded = state.streets[action.street]?.parsed.actions[action.index];
        if (!recorded?.sourceRegion) return null;
        const purpose = action.amount ? "action-amount" : ACTOR_ISSUES.has(code) ? "actor-row" : "action-text";
        return {
          ...base,
          purpose,
          street: action.street,
          index: action.index,
          region: recorded.sourceRegion,
          context: { street: action.street, index: action.index, actorName: recorded.actorName, position: recorded.position, type: recorded.type, rawText: recorded.rawText, candidates: [recorded.rawText] },
        };
      }

      function apply(request, answer) {
        if (!answer || answer.value === undefined || answer.value === null) return;
        const confidence = answer.confidence ?? 0.7;
        if (request.purpose === "hero-cards" && Array.isArray(answer.value)) {
          state.hero = { ...state.hero, cards: answer.value, confidence };
        } else if (request.purpose === "board-card" && answer.value && typeof answer.value === "object") {
          state.board = { ...state.board, ...answer.value, confidence };
        } else if (request.street) {
          const entry = state.streets[request.street];
          const action = entry?.parsed.actions[request.index];
          if (!action) return;
          if (request.purpose === "action-amount") {
            const amount = Number(answer.value);
            if (!Number.isFinite(amount) || amount < 0) return;
            action.amountBb = amount;
            entry.parsed.warnings = entry.parsed.warnings.filter((warning) => warning.field !== request.field);
          } else if (request.purpose === "action-text") {
            const reparsed = parser.parseActionRow({ text: String(answer.value), actorName: action.actorName, position: action.position, sourceRegion: action.sourceRegion }, { street: request.street, index: request.index });
            if (!reparsed.action) return;
            entry.parsed.actions[request.index] = { ...reparsed.action, id: action.id };
          } else if (request.purpose === "actor-row" && typeof answer.value === "object") {
            if (answer.value.actorName) action.actorName = answer.value.actorName;
            if (answer.value.position) action.position = answer.value.position;
          }
          entry.parsed.confidences[request.index] = confidence;
        }
      }

      if (requests.length) {
        const answers = await Promise.all(requests.map(async (request) => {
          fallbackLog.push({ purpose: request.purpose, field: request.field });
          try {
            return await fallback.resolve(request);
          } catch {
            return null;
          }
        }));
        requests.forEach((request, index) => apply(request, answers[index]));
        validation = validate();
      }

      const issues = validation.warnings;
      const issueFields = [...new Set(issues.map((issue) => issue.field).filter(Boolean))];
      if (validation.valid && !issues.length) setStatus("validation", "complete", { message: "Hand passed strict poker validation." });
      else setStatus("validation", "warning", { message: `${issues.length} validation issue(s) need review.`, fieldRefs: issueFields });

      // ---- reconstruction and decision discovery --------------------------------------------------------------
      setStatus("reconstruction", "running");
      const legacy = legacyAdapter.toLegacy(validation.hand);
      const converted = builderAdapter.fromImportedHand(legacy, { heroName: validation.hand.hero.name, strict: !validation.valid });
      if (converted.unresolved.length) {
        setStatus("reconstruction", "warning", {
          message: `${converted.unresolved.length} action(s) could not be replayed.`,
          fieldRefs: converted.unresolved.map((entry) => (entry.key.startsWith("board:") ? `board.${entry.key.split(":")[1]}` : `actions.${entry.key.split(":").join(".")}`)),
        });
      } else {
        setStatus("reconstruction", "complete");
      }
      setStatus("decisions", "running");
      const decisionKeys = discoverDecisions(converted);
      if (decisionKeys.length) setStatus("decisions", "complete", { message: `${decisionKeys.length} decision(s) can be analyzed.` });
      else setStatus("decisions", "warning", { message: "No analyzable decisions were found." });

      return {
        route: "v2",
        hand: validation.hand,
        legacy,
        converted,
        decisionKeys,
        valid: validation.valid,
        validation: { valid: validation.valid, blockingIssues: validation.blockingIssues, replayIssues: validation.replayIssues, reconciledPots: validation.reconciledPots },
        progress: progress.snapshot().byId,
        snapshot: progress.snapshot(),
        detection,
        fallbackCalls: fallbackLog,
        fullImageProviderCalls: 0,
        failures: Object.fromEntries(Object.entries(state.errors).map(([stage, error]) => [stage, error.message])),
        confidenceRound: round(validation.confidence.overall),
      };
    }

    return { import: importHand };
  }

  const api = Object.freeze({ create });
  root.PokerCoachImportEngineV2 = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
