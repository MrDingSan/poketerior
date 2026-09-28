import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const POSITION_ORDER = { SB: 0, BB: 1, UTG: 2, HJ: 3, CO: 4, BTN: 5 };

function cardToken(card) {
  return String(card || "").trim();
}

function normalizeCards(text) {
  return String(text || "")
    .replaceAll(",", " ")
    .split(/\s+/)
    .map(cardToken)
    .filter(Boolean);
}

function handClassFromCards(cards) {
  if (cards.length !== 2) return "";
  const ranks = "23456789TJQKA";
  const [a, b] = cards;
  const ordered = [a, b].sort((left, right) => ranks.indexOf(right[0]) - ranks.indexOf(left[0]));
  if (ordered[0][0] === ordered[1][0]) return ordered[0][0] + ordered[1][0];
  return ordered[0][0] + ordered[1][0] + (ordered[0][1] === ordered[1][1] ? "s" : "o");
}

function compactCombo(cards) {
  return cards.join("");
}

function isHeroOop(heroPosition, villainPosition) {
  return (POSITION_ORDER[heroPosition] ?? 99) < (POSITION_ORDER[villainPosition] ?? 99);
}

function solverLines({ spot = {}, math = {}, outputFile }) {
  const street = spot.street || "preflop";
  const boardCards = normalizeCards(spot.board);
  if (street === "preflop" || boardCards.length < 3) {
    throw new Error("TexasSolver console mode needs a flop, turn, or river board.");
  }

  const heroCards = normalizeCards(spot.heroHand);
  const heroRange = handClassFromCards(heroCards) || compactCombo(heroCards);
  const villainRange = math.rangeText || "AA,KK,QQ,JJ,TT,AK,AQ";
  const heroOop = isHeroOop(spot.heroPosition, spot.villainPosition);
  const pot = Math.max(1, Number(math.pot || 0));
  const effectiveStack = Math.max(1, Math.round(pot * 4));
  const maxIteration = Number(math.maxIteration || 8);
  const accuracy = Number(math.accuracy || 5);
  const threads = Number(math.threads || 4);

  return [
    `set_pot ${pot}`,
    `set_effective_stack ${effectiveStack}`,
    `set_board ${boardCards.join(",")}`,
    `set_range_oop ${heroOop ? heroRange : villainRange}`,
    `set_range_ip ${heroOop ? villainRange : heroRange}`,
    "set_bet_sizes oop,flop,bet,50",
    "set_bet_sizes oop,flop,raise,60",
    "set_bet_sizes ip,flop,bet,50",
    "set_bet_sizes ip,flop,raise,60",
    "set_bet_sizes oop,turn,bet,50",
    "set_bet_sizes oop,turn,raise,60",
    "set_bet_sizes ip,turn,bet,50",
    "set_bet_sizes ip,turn,raise,60",
    "set_bet_sizes oop,river,bet,50",
    "set_bet_sizes oop,river,donk,50",
    "set_bet_sizes oop,river,raise,60",
    "set_bet_sizes ip,river,bet,50",
    "set_bet_sizes ip,river,raise,60",
    "set_allin_threshold 1.0",
    "build_tree",
    `set_thread_num ${threads}`,
    `set_accuracy ${accuracy}`,
    `set_max_iteration ${maxIteration}`,
    "set_print_interval 10",
    "set_use_isomorphism 0",
    "start_solve",
    "set_dump_rounds 2",
    `dump_result ${path.basename(outputFile)}`,
  ];
}

function runProcess(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      finish({ code: null, signal: "SIGKILL", stdout, stderr, timedOut });
    }, options.timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code, signal) => {
      finish({ code, signal, stdout, stderr, timedOut });
    });
    child.on("error", (error) => {
      finish({ code: null, signal: null, stdout, stderr: error.message, timedOut });
    });
  });
}

function actionKeysForNode(node) {
  return Object.keys(node?.childrens || {});
}

function compactAction(actionKey) {
  if (actionKey === "CHECK") return "Check";
  if (actionKey === "CALL") return "Call";
  if (actionKey.startsWith("BET")) return "Bet";
  if (actionKey.startsWith("RAISE")) return "Raise";
  return actionKey;
}

function summarizeStrategyNode(node, cards = []) {
  const actions = actionKeysForNode(node);
  const strategy = node?.strategy?.strategy || {};
  const comboKeys = Object.keys(strategy);
  const heroKeys = [compactCombo(cards), compactCombo([...cards].reverse())].filter(Boolean);
  const heroKey = heroKeys.find((key) => strategy[key]);
  const probabilities = heroKey
    ? strategy[heroKey]
    : Object.values(strategy).reduce(
        (totals, row) => row.map((value, index) => (totals[index] || 0) + value),
        [],
      ).map((total) => total / Math.max(comboKeys.length, 1));

  const mixedStrategy = actions.map((action, index) => ({
    action: compactAction(action),
    rawAction: action,
    probability: probabilities[index] || 0,
  }));
  const best = [...mixedStrategy].sort((a, b) => b.probability - a.probability)[0] || null;

  return {
    recommendedAction: best?.action || "Unavailable",
    confidence: best?.probability || 0,
    heroComboMatched: heroKey || null,
    mixedStrategy,
    comboCount: comboKeys.length,
  };
}

function activeSolverProcesses(binaryPath) {
  return new Promise((resolve) => {
    const ps = spawn("ps", ["-axo", "pid,stat,etime,command"]);
    let stdout = "";
    ps.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    ps.on("close", () => {
      const rows = stdout
        .split(/\r?\n/)
        .filter((line) => line.includes(binaryPath))
        .map((line) => line.trim())
        .filter(Boolean);
      resolve(rows);
    });
    ps.on("error", () => resolve([]));
  });
}

function childForAction(node, action) {
  const actionUpper = String(action || "").toUpperCase();
  const keys = actionKeysForNode(node);
  if (actionUpper === "CHECK") return ["CHECK", node?.childrens?.CHECK].filter(Boolean);
  if (actionUpper === "CALL") return ["CALL", node?.childrens?.CALL].filter(Boolean);
  if (actionUpper === "BET") {
    const key = keys.find((item) => item.startsWith("BET"));
    return [key, key ? node.childrens[key] : null];
  }
  if (actionUpper === "RAISE") {
    const key = keys.find((item) => item.startsWith("RAISE"));
    return [key, key ? node.childrens[key] : null];
  }
  return [null, null];
}

function traverseActions(root, streetActions = [], limit = streetActions.length) {
  let node = root;
  const pathKeys = [];
  for (const row of streetActions.slice(0, limit)) {
    const [key, child] = childForAction(node, row.action);
    if (!key || !child) {
      return { node, pathKeys, missingAction: row.action, complete: false };
    }
    pathKeys.push(key);
    node = child;
  }
  return { node, pathKeys, complete: true };
}

function actionComboSummary(node) {
  const actions = actionKeysForNode(node);
  const strategy = node?.strategy?.strategy || {};
  const counts = Object.fromEntries(actions.map((action) => [compactAction(action), 0]));
  const highFrequencyCombos = Object.fromEntries(actions.map((action) => [compactAction(action), []]));

  for (const [combo, row] of Object.entries(strategy)) {
    row.forEach((probability, index) => {
      const label = compactAction(actions[index]);
      if (probability >= 0.5) counts[label] += 1;
      if (probability >= 0.25 && highFrequencyCombos[label].length < 20) {
        highFrequencyCombos[label].push({ combo, probability });
      }
    });
  }

  return { counts, highFrequencyCombos };
}

function findCheckRaiseNode(root, streetActions = []) {
  const raiseIndex = streetActions.findIndex((row, index) => {
    if (row.action !== "raise") return false;
    const prior = streetActions.slice(0, index).map((item) => item.action);
    return prior.includes("check") && prior.includes("bet");
  });
  if (raiseIndex === -1) return null;

  const parent = traverseActions(root, streetActions, raiseIndex);
  if (!parent.complete) return null;
  return {
    pathKeys: parent.pathKeys,
    node: parent.node,
    strategy: summarizeStrategyNode(parent.node),
    actionCombos: actionComboSummary(parent.node),
  };
}

function isAllInResponseNode(spot = {}, math = {}) {
  const legalActions = math.legalActions || spot.legalActions || [];
  return Boolean(math.facingAllIn || spot.facingAllIn || (legalActions.length === 2 && legalActions.includes("Fold") && legalActions.includes("Call")));
}

export async function runTexasSolver({ spot, math, config }) {
  if (isAllInResponseNode(spot, math)) {
    return {
      ok: false,
      skipped: true,
      recommendedAction: "Unavailable",
      legalActions: ["Fold", "Call"],
      error:
        "TexasSolver was skipped because Hero is facing an all-in. This node has only Fold/Call legal actions, and the simplified TexasSolver tree can return Bet/Check actions from the wrong node.",
    };
  }

  const binary = config.texasSolverBinary;
  const resources = config.texasSolverResources;
  if (!binary || !resources) {
    return {
      ok: false,
      skipped: true,
      error: "TexasSolver is not configured. Set TEXAS_SOLVER_BINARY and TEXAS_SOLVER_RESOURCES in .env to enable the solver check.",
    };
  }
  await fs.access(binary);
  await fs.access(resources);

  const activeProcesses = await activeSolverProcesses(binary);
  if (activeProcesses.length > 0) {
    return {
      ok: false,
      error:
        "TexasSolver is already running or stuck in the background. To avoid launching more runaway native solver jobs, Poker Coach skipped this solver request. Reboot macOS or manually clear the listed console_solver processes, then try again.",
      activeProcesses,
    };
  }

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "pokercoach-texas-solver-"));
  const inputFile = path.join(workDir, "input.txt");
  const outputFile = path.join(workDir, "output_result.json");
  const lines = solverLines({ spot, math, outputFile });
  await fs.writeFile(inputFile, `${lines.join("\n")}\n`, "utf8");

  const run = await runProcess(binary, ["--input_file", inputFile, "--resource_dir", resources], {
    cwd: workDir,
    timeoutMs: config.texasSolverTimeoutMs,
  });

  let output = null;
  try {
    output = JSON.parse(await fs.readFile(outputFile, "utf8"));
  } catch {
    output = null;
  }

  if (!output) {
    return {
      ok: false,
      error: run.timedOut
        ? `TexasSolver timed out after ${config.texasSolverTimeoutMs}ms. The local Poker Coach range/equity analysis is still usable; solver output is optional for this node.`
        : "TexasSolver did not produce output_result.json.",
      exit: { code: run.code, signal: run.signal, timedOut: run.timedOut },
      stderr: run.stderr.trim().slice(-1200),
      stdoutTail: run.stdout.replace(/\u0008/g, "").trim().slice(-1200),
      inputFile,
      generatedInput: lines,
    };
  }

  return {
    ok: true,
    solver: "TexasSolver v0.2.0 console",
    exit: { code: run.code, signal: run.signal, timedOut: run.timedOut },
    ...summarizeStrategyNode(traverseActions(output, spot.streetActions || []).node, normalizeCards(spot.heroHand)),
    targetPath: traverseActions(output, spot.streetActions || []).pathKeys,
    checkRaiseNode: findCheckRaiseNode(output, spot.streetActions || []),
    inputFile,
  };
}
