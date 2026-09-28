function pct(value) {
  if (!Number.isFinite(Number(value))) return "unknown";
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function bb(value) {
  if (!Number.isFinite(Number(value))) return "unknown";
  return `${Number(value).toFixed(2).replace(/\.?0+$/, "")}bb`;
}

function lowerText(value) {
  return String(value || "").toLowerCase();
}

function formatActions(actions) {
  if (!Array.isArray(actions) || !actions.length) return "";
  return actions
    .map((row) => [row.actor, row.action, row.amount].filter((item) => item !== undefined && item !== null && item !== "").join(" "))
    .join(" -> ");
}

function actionPressure(spot = {}) {
  const text = lowerText([spot.actionLine, spot.decisionNode, spot.decisionDescription].join(" "));
  if (/allin|all-in|shove|jam/.test(text)) return "all-in pressure";
  if (/raise|check-raise|3bet|4bet|re-raise/.test(text)) return "raise pressure";
  if (/bet/.test(text)) return "bet pressure";
  if (/check/.test(text)) return "low pressure";
  return "unresolved pressure";
}

function legalActionText(spot = {}, math = {}) {
  const actions = math.legalActions || spot.legalActions;
  if (Array.isArray(actions) && actions.length) return actions.join(", ");
  return "not supplied";
}

function boardSignals(boardText = "", textureText = "") {
  const text = `${boardText} ${textureText}`.trim();
  if (!text) return ["Board texture is missing, so avoid overconfident blocker or draw claims."];
  const suits = (boardText.match(/[cdhs]/gi) || []).map((item) => item.toLowerCase());
  const suitCounts = suits.reduce((counts, suit) => {
    counts[suit] = (counts[suit] || 0) + 1;
    return counts;
  }, {});
  const maxSuit = Math.max(0, ...Object.values(suitCounts));
  const signals = [`Board/texture input: ${text}.`];
  if (maxSuit >= 3) signals.push("Flush pressure matters: value hands and semi-bluffs can both be suit-sensitive.");
  if (/paired|pair|trips|full house/i.test(textureText)) {
    signals.push("Paired-board discipline matters: trips/boats compress value and reduce thin bluff-catch comfort.");
  }
  if (/wet|draw|connected|straight/i.test(textureText)) {
    signals.push("Connected-board discipline matters: draws and pair-plus-draw hands can drive aggressive lines.");
  }
  if (/dry|rainbow|static/i.test(textureText)) {
    signals.push("Dry-board discipline matters: made-hand advantage and range advantage are more important than raw draw equity.");
  }
  return signals;
}

function preflopSkill(spot = {}, math = {}) {
  const actionLine =
    formatActions(spot.preflopActions) ||
    (lowerText(spot.street) === "preflop" ? spot.actionLine : "") ||
    "No preflop line supplied.";
  return {
    id: "P2",
    title: "Preflop Range Gate",
    scope: "Preflop",
    bullets: [
      `Use the visible preflop line before assigning ranges: ${actionLine}`,
      "Infer preflop pressure from positions, open size, dead money, and whether the line is open, flat-call, 3-bet, or call versus 3-bet.",
      "Prioritize position, dead money, open size, and whether hero is opening, calling, or facing a re-raise.",
      "Do not recommend a postflop exploit from preflop data alone; carry uncertainty forward.",
    ],
  };
}

function postflopGeneralSkill(spot = {}, math = {}) {
  return {
    id: "P3",
    title: "Postflop Hand And Range Evaluation",
    scope: "Postflop",
    bullets: [
      `Hero hand: ${spot.heroHand || "unknown"} on ${spot.board || "unknown board"}.`,
      `Board signals: ${boardSignals(spot.board, math.boardTexture).join(" ")}`,
      "Reason qualitatively from made-hand strength, draw texture, blockers, position, and action credibility before choosing an action.",
      "When the board is uncertain or OCR-derived, keep the recommendation robust instead of suit-perfect.",
    ],
  };
}

function targetedSkill(spot = {}, math = {}) {
  const pressure = actionPressure(spot);
  const call = Number(math.call) > 0 ? bb(math.call) : "0bb";
  const pot = Number(math.pot) > 0 ? bb(math.pot) : "unknown";

  return {
    id: "P4",
    title: "Targeted Action Budget",
    scope: "Postflop",
    bullets: [
      `Current pressure type: ${pressure}.`,
      `Use only stable price/action facts as constraints: pot ${pot}, call ${call}. Do not treat local equity, EV, confluence, or combo-ahead counts as evidence in this section.`,
      `Legal actions at this node: ${legalActionText(spot, math)}.`,
      math.facingAllIn
        ? "Villain is all-in, so compare only call versus fold; there is no raise fold-equity story."
        : "If hero is facing aggression, compare fold/call/raise qualitatively from line, price, blockers, and credible value/bluff stories; do not treat aggression as automatically polarized.",
      "If hero is choosing the aggressive action, state which worse hands continue and which better hands fold.",
    ],
  };
}

function riverSkill(spot = {}, math = {}) {
  return {
    id: "P5",
    title: "River Bluff And Bluff-Catch Gate",
    scope: "River",
    bullets: [
      "No future-card equity remains on the river; recommendation must rest on pot odds, range composition, blockers, and line credibility.",
      "Do not use local equity or ahead/behind combo counts as hard evidence; reason from villain line, price, blockers, and plausible value/bluff composition.",
      "For bluff-catching, ask whether villain has enough natural bluffs at this size and whether hero blocks value or unblocks bluffs.",
      "For bluffing, ask whether hero has poor showdown value, credible value representation, and useful blockers.",
    ],
  };
}

export function selectPokerSkills({ spot = {}, math = {} } = {}) {
  const street = lowerText(spot.street || "preflop");
  const skills = [
    {
      id: "P1",
      title: "Execution And Output Contract",
      scope: "Always",
      bullets: [
        "Use Poker Coach math, visible cards, and action history as facts.",
        `Choose only actions that fit the current node. Legal actions supplied by the app: ${legalActionText(spot, math)}.`,
        "If villain is all-in and legal actions are Fold/Call, raise and bet are illegal.",
        "Never claim exact solver output from this section; this is skill-conditioned LLM reasoning.",
        "If facts conflict or are missing, say what is uncertain and lower confidence.",
      ],
    },
  ];

  if (street === "preflop") {
    skills.push(preflopSkill(spot, math));
  } else {
    skills.push(preflopSkill(spot, math), postflopGeneralSkill(spot, math), targetedSkill(spot, math));
    if (street === "river") skills.push(riverSkill(spot, math));
  }

  return skills;
}

export function formatPokerSkillContext(skills = []) {
  return skills
    .map((skill) => {
      const bullets = skill.bullets.map((item) => `- ${item}`).join("\n");
      return `${skill.id} ${skill.title} (${skill.scope})\n${bullets}`;
    })
    .join("\n\n");
}
