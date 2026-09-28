(function attachImportProgress(global) {
  function create({ setStatus, intervalMs = 5_000 }) {
    let timer = null;
    let elapsedSeconds = 0;

    function start() {
      stop();
      elapsedSeconds = 0;
      timer = setInterval(() => {
        elapsedSeconds += Math.max(1, Math.round(intervalMs / 1_000));
        setStatus(`Still extracting (${elapsedSeconds}s)… Provider fallback is automatic.`);
      }, intervalMs);
    }

    function stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    }

    return { start, stop };
  }

  const STAGES = Object.freeze(["site", "heroCards", "board", "preflop", "flop", "turn", "river", "validation", "reconstruction", "decisions"]);
  const STAGE_LABELS = Object.freeze({
    site: "Site detection",
    heroCards: "Hero cards",
    board: "Board cards",
    preflop: "Pre-Flop actions",
    flop: "Flop actions",
    turn: "Turn actions",
    river: "River actions",
    validation: "Poker validation",
    reconstruction: "Hand reconstruction",
    decisions: "Decision discovery",
  });
  const TRANSITIONS = Object.freeze({
    pending: ["running", "complete", "warning", "error"],
    running: ["complete", "warning", "error"],
    warning: ["running", "complete", "error"],
    error: ["running", "complete"],
    complete: [],
  });

  function createStageProgress({ onChange } = {}) {
    const records = new Map(STAGES.map((id) => [id, { id, label: STAGE_LABELS[id], status: "pending", message: `${STAGE_LABELS[id]} pending.`, fieldRefs: [] }]));

    function snapshot() {
      const stages = STAGES.map((id) => {
        const record = records.get(id);
        return Object.freeze({ ...record, fieldRefs: Object.freeze([...record.fieldRefs]) });
      });
      return Object.freeze({
        stages: Object.freeze(stages),
        byId: Object.freeze(Object.fromEntries(stages.map((stage) => [stage.id, stage]))),
      });
    }

    function transition(stage, status, detail = {}, verb) {
      const record = records.get(stage);
      if (!record) throw new Error(`Unknown import stage ${stage}.`);
      if (!TRANSITIONS[record.status].includes(status)) {
        throw new Error(`Illegal stage transition for ${stage}: ${record.status} -> ${status}.`);
      }
      const from = record.status;
      record.status = status;
      record.message = detail.message || `${STAGE_LABELS[stage]} ${verb}.`;
      record.fieldRefs = status === "running" ? [] : [...(detail.fieldRefs || [])];
      onChange?.(snapshot(), { stage, from, to: status });
    }

    return {
      start: (stage, detail) => transition(stage, "running", detail, "in progress"),
      complete: (stage, detail) => transition(stage, "complete", detail, "complete"),
      warn: (stage, detail) => transition(stage, "warning", detail, "needs review"),
      fail: (stage, detail) => transition(stage, "error", detail, "failed"),
      snapshot,
    };
  }

  global.PokeTeriorImportProgress = { create, createStageProgress, STAGES };
})(typeof globalThis !== "undefined" ? globalThis : window);
