(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PokerCoachAnalysisPresentation = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const ACTION_WORDS = ["all-in", "allin", "raise", "bet", "call", "check", "fold"];

  function canonicalAction(word) {
    const lower = String(word || "").toLowerCase();
    if (lower === "allin" || lower === "all-in") return "All-in";
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  function stripMarkdown(text) {
    return String(text || "").replace(/[`*_]/g, "");
  }

  const ACTION_PATTERN = new RegExp(`\\b(${ACTION_WORDS.join("|")})\\b`, "i");
  const BOLD_ACTION = new RegExp(`\\*\\*\\s*(${ACTION_WORDS.join("|")})\\s*\\*\\*`, "i");
  const VERDICT_PHRASE = new RegExp(`(?:play is to|we (?:choose|select|should)|recommend(?:ed)?(?: action)?(?: is)?(?: to)?|best (?:play|action) is(?: to)?)\\s+(?:\\*\\*)?(${ACTION_WORDS.join("|")})\\b`, "i");
  const RECOMMENDATION_HEADING = /^\**\s*(?:#{1,6}\s+|\d+[.)]\s+)?\**\s*recommend(?:ation|ed action)?\b/i;
  const NEXT_HEADING = /^(?:#{1,6}\s+|\**\d+[.)]\s+)/;

  // The text of the "Recommendation" section: its heading line plus the lines until the next heading.
  function recommendationSection(text) {
    const lines = String(text || "").split(/\r?\n/).map((line) => line.trim());
    const start = lines.findIndex((line) => RECOMMENDATION_HEADING.test(line) || /recommend(?:ation|ed action)?\s*\**\s*[:\-–]/i.test(line));
    if (start === -1) return "";
    const section = [lines[start]];
    for (const line of lines.slice(start + 1)) {
      if (NEXT_HEADING.test(line)) break;
      section.push(line);
    }
    return section.join("\n");
  }

  // Finds the action the LLM recommends, limited to legal actions when known.
  function extractRecommendedAction(text, legalActions = []) {
    const legal = (legalActions || []).map((action) => String(action).toLowerCase().replace("-", ""));
    const allowed = (word) => !legal.length || legal.includes(word.toLowerCase().replace("-", ""));
    const section = recommendationSection(text);
    if (!section) return null;
    const headingLine = stripMarkdown(section.split("\n")[0]);
    const afterColon = headingLine.match(/recommend(?:ation|ed action)?\s*[:\-–]\s*(.*)$/i)?.[1] || "";
    const candidates = [
      afterColon.match(ACTION_PATTERN)?.[1],
      section.match(BOLD_ACTION)?.[1],
      stripMarkdown(section).match(VERDICT_PHRASE)?.[1],
    ];
    const found = candidates.find((word) => word && allowed(word));
    return found ? canonicalAction(found) : null;
  }

  const SKIPPED_SECTIONS = /range interpretation|villain range|caveat|uncertaint|assumption/i;
  const CONCLUSION = /\b(?:bottom line|in summary|summary|conclusion|tl;dr|overall)\s*[:\-–]\s*/i;
  const INSTRUCTION_ECHO = /^(clearly|consider|state|explain|use|note|remember|give|provide|include|list|describe)\b/i;
  const BOILERPLATE = /legal actions|snippet|retrieved|template|study context|rangeBreakdown|rangeText|as supplied|payload shows|local baseline|no specific|(?:does|do|did) not (?:contain|apply|include)|directly applicable|generic (?:reminder|principle|advice)/i;
  const STRATEGY = /\b(value|protect\w*|deny|denial|fold equity|folds?|bluff\w*|draws?|charg\w+|equity (?:edge|advantage)|capped|pot control|position|thin|extract)\b/i;
  // Arithmetic ("EV = (equity × pot) − cost ≈ 3.7 bb") is evidence, not advice.
  const FORMULA = /[=×≈]|\d+(?:\.\d+)?\s*[-+*/x]\s*\d|(?:\d[\d.,]*\s*(?:bb|%)?[^\d]+){4,}\d/;
  const CAUSAL = /\b(because|so|therefore|consequently|since|which means|as a result)\b/i;

  // A short prose summary: keeps strategic sentences and drops tables, headings, the verdict line,
  // descriptive range/caveat sections, and prompt boilerplate.
  function splitSentences(text) {
    return text.split(/(?<=[.!?])\s+(?=[A-Z(])/).map((sentence) => sentence.trim()).filter(Boolean);
  }

  function clip(summary, maxLength) {
    return summary.length > maxLength ? `${summary.slice(0, maxLength - 1).trimEnd()}…` : summary;
  }

  function summarizeReasoning(text, { maxSentences = 2, maxLength = 360 } = {}) {
    const plain = stripMarkdown(text);
    const conclusionLine = plain.split(/\r?\n/).find((line) => CONCLUSION.test(line));
    if (conclusionLine) {
      const after = conclusionLine.slice(conclusionLine.search(CONCLUSION)).replace(CONCLUSION, "").trim();
      const sentences = splitSentences(after).slice(0, maxSentences);
      if (sentences.join(" ").length >= 30) return clip(sentences.join(" "), maxLength);
    }
    const candidates = [];
    let skipSection = false;
    for (const rawLine of plain.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("|")) continue;
      const heading = line.match(/^(?:#{1,6}\s+|\d+[.)]\s+)(.*)$/);
      if (heading && heading[1].length <= 80 && !/[.!?]\s/.test(heading[1])) {
        skipSection = SKIPPED_SECTIONS.test(heading[1]);
        if (!/^recommend/i.test(heading[1])) continue;
      }
      if (skipSection) continue;
      const body = line.replace(/^(\d+[.)]|[-*•])\s+/, "");
      if (/^\(?recommend(?:ation|ed action)?\s*[:\-–]/i.test(body)) continue;
      if (/^[A-Z][A-Za-z ]{0,40}:?$/.test(body)) continue;
      for (const sentence of splitSentences(body)) {
        const clean = sentence.replace(/^\((.*)\)$/, "$1").trim();
        if (clean.length < 30 || BOILERPLATE.test(clean) || INSTRUCTION_ECHO.test(clean) || FORMULA.test(clean)) continue;
        const score = (STRATEGY.test(clean) ? 2 : 0) + (CAUSAL.test(clean) ? 1 : 0);
        candidates.push({ clean, score, order: candidates.length });
      }
    }
    if (!candidates.length) return "";
    const picked = [...candidates]
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, maxSentences)
      .sort((a, b) => a.order - b.order)
      .map((item) => item.clean);
    return clip(picked.join(" "), maxLength);
  }

  const HEADING_LINE = /^\s*(?:#{1,6}\s+\S|\**\d*[.)]?\s*\*\*[^*]+\*\*\s*:?\s*$|[A-Z][A-Za-z ]{2,40}:\s*$)/;

  // The body of the section whose heading matches `headingPattern` ("## Recommendation", "**Recommendation**",
  // "Recommendation:"), up to the next heading.
  function extractSection(text, headingPattern) {
    const lines = String(text || "").split(/\r?\n/);
    const start = lines.findIndex((line) => HEADING_LINE.test(line) && headingPattern.test(line.replace(/[#*:]/g, "").replace(/^\s*\d+[.)]\s*/, "").trim()));
    if (start === -1) return "";
    const body = [];
    for (const line of lines.slice(start + 1)) {
      if (HEADING_LINE.test(line)) break;
      if (line.trim()) body.push(line.trim());
    }
    return stripMarkdown(body.join(" ")).replace(/\s+/g, " ").trim();
  }

  // Two-sentence blurb for a strategy card: the "Recommendation" section when there is one, else the general summary.
  function blurb(text, { maxSentences = 2, maxLength = 360 } = {}) {
    const section = extractSection(text, /^recommend(?:ation|ed action)?$/i);
    if (section.length >= 30) return clip(splitSentences(section).slice(0, maxSentences).join(" "), maxLength);
    return summarizeReasoning(text, { maxSentences, maxLength });
  }

  // Section names the Harrington and PokerSkill output contracts use; any of them ends the Recommendation section.
  const CONTRACT_HEADING = /^(recommend(?:ation|ed action)|situation|key evidence|skill layers(?: used)?|candidate actions(?:\s*\([^)]*\))?|recorded action comparison|confidence(?:\s*\/\s*caveats)?|caveats)\s*(\**)\s*(:?)\s*(?:\*\*(?=\s|$))?\s*(.*)$/i;
  const RECOMMENDATION_NAME = /^recommend(?:ation|ed action)\b/i;

  // "## Recommendation", "### 4. Recommendation", "4. **Recommendation**: Bet ...", "**Recommendation:**" -> the section name and
  // any text that follows it on the same line, or null when the line is not a section heading.
  function sectionHeading(line) {
    const marked = /^\s*(?:#{1,6}\s|\**\s*\d+[.)]|\*\*)/.test(line);
    const match = line.replace(/^\s*#{0,6}\s*\**\s*(?:\d+[.)]\s*)?\**\s*/, "").match(CONTRACT_HEADING);
    if (!match) return null;
    const [, name, stars, colon, rest] = match;
    if (!colon && !(marked && (stars || !rest.trim()))) return null;
    return { name, rest: rest.trim() };
  }

  // The markdown body of the Recommendation section, including text on the heading line itself.
  function recommendationWriteup(text) {
    const lines = String(text || "").split(/\r?\n/);
    let body = null;
    for (const line of lines) {
      const heading = sectionHeading(line);
      if (body === null) {
        if (heading && RECOMMENDATION_NAME.test(heading.name)) body = heading.rest ? [heading.rest] : [];
        continue;
      }
      if (heading) break;
      body.push(line);
    }
    return body ? body.join("\n").trim() : "";
  }

  const DASH = "[-–‑—]";
  const NUMBER = "\\d+(?:\\.\\d+)?";
  const POT_FRACTIONS = [
    [/\bhalf[\s-‑]*(?:pot\s*)?to[\s-‑]*(?:two|2)[\s-‑]*thirds?[\s-‑]*(?:of\s*the\s*)?pot\b/i, "1/2–2/3 pot"],
    [/\bhalf[\s-‑]*pot\s*to\s*(?:full[\s-‑]*pot|pot[\s-‑]*siz(?:e|ed)?)\b/i, "1/2 pot–pot"],
    [/(?:\b(?:two|2)[\s-‑]*thirds?|⅔|\b2\/3)[\s-‑]*(?:of\s*the\s*)?pot\b/i, "2/3 pot"],
    [/(?:\b(?:three|3)[\s-‑]*quarters?|¾|\b3\/4)[\s-‑]*(?:of\s*the\s*)?pot\b/i, "3/4 pot"],
    [/(?:\bhalf|½|\b1\/2)[\s-‑]*(?:(?:of\s*)?the\s*)?pot\b/i, "Half pot"],
    [/(?:\b(?:one[\s-‑]*)?third|⅓|\b1\/3)[\s-‑]*(?:of\s*the\s*)?pot\b/i, "1/3 pot"],
    [/(?:\b(?:one[\s-‑]*)?quarter|¼|\b1\/4)[\s-‑]*(?:of\s*the\s*)?pot\b/i, "1/4 pot"],
    [/\bover[\s-‑]*bet\b/i, "Overbet"],
    [/\b(?:full[\s-‑]*pot|pot[\s-‑]*siz(?:e|ed)?)\b/i, "Pot"],
  ];

  // Bet/raise size named in the recommendation, e.g. "~20–22 bb", "Half pot · ~15–16 bb", "3/4 pot".
  function extractSize(writeup) {
    const plain = stripMarkdown(writeup).replace(/\s+/g, " ");
    const lead = splitSentences(plain).slice(0, 2).join(" ");
    const percent = lead.match(new RegExp(`(${NUMBER})\\s*%\\s*(?:of\\s*(?:the\\s*)?)?pot`, "i"))?.[1] ||
      lead.match(/\b0?\.(\d{1,2})\s*[×x]\s*(?:the\s*)?pot\b/i)?.[1]?.padEnd(2, "0");
    const fraction = percent ? `${Number(percent)}% pot` : POT_FRACTIONS.find(([pattern]) => pattern.test(lead))?.[1] || "";
    const approx = "(~|≈|approx(?:imately)?\\.?|about|around|roughly)?\\s*";
    const range = lead.match(new RegExp(`${approx}(${NUMBER})\\s*(?:${DASH}|to)\\s*(${NUMBER})\\s*(bb|big blinds)?`, "i"));
    const single = lead.match(new RegExp(`${approx}(${NUMBER})\\s*(?:bb|big blinds)\\b`, "i"));
    let amount = "";
    if (range && (range[1] || range[4])) amount = `${range[1] ? "~" : ""}${range[2]}–${range[3]} bb`;
    else if (single) amount = `${single[1] ? "~" : ""}${single[2]} bb`;
    return [fraction, amount].filter(Boolean).join(" · ");
  }

  // The recommended action, its size when betting or raising, and the recommendation write-up.
  function extractDecision(text, legalActions = []) {
    const writeup = recommendationWriteup(text);
    const legal = (legalActions || []).map((action) => String(action).toLowerCase().replace("-", ""));
    const allowed = (word) => word && (!legal.length || legal.includes(word.toLowerCase().replace("-", "")));
    const plain = stripMarkdown(writeup);
    const firstSentence = splitSentences(plain.replace(/\s+/g, " "))[0] || "";
    const candidates = [
      writeup.match(BOLD_ACTION)?.[1],
      plain.match(new RegExp(`\\baction\\s*:\\s*(${ACTION_WORDS.join("|")})\\b`, "i"))?.[1],
      plain.match(new RegExp(`^\\W*(${ACTION_WORDS.join("|")})\\b`, "i"))?.[1],
      plain.match(VERDICT_PHRASE)?.[1],
      firstSentence.match(ACTION_PATTERN)?.[1],
    ];
    const found = candidates.find(allowed);
    const action = found ? canonicalAction(found) : extractRecommendedAction(text, legalActions);
    const size = action && actionTone(action) === "aggressive" && action !== "All-in" ? extractSize(writeup) : "";
    return { action, size, writeup };
  }

  const SUIT_NAME = { c: "clubs", d: "diamonds", h: "hearts", s: "spades" };
  const RANK_NUMBER = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };

  // Most board cards that fit in one five-rank window (an ace also counts low): the straight structure.
  function straightWindow(ranks) {
    const values = new Set(ranks);
    if (values.has(14)) values.add(1);
    let best = 0;
    for (let start = 1; start <= 10; start += 1) {
      let count = 0;
      for (let rank = start; rank < start + 5; rank += 1) if (values.has(rank)) count += 1;
      best = Math.max(best, count);
    }
    return best;
  }

  // One or two plain sentences on what the board allows, derived only from the cards ("8h 2s Qh" as ["8h","2s","Qh"]).
  function boardNote(cards = []) {
    const board = (cards || []).filter((card) => card && card.length === 2 && RANK_NUMBER[card[0]] && SUIT_NAME[card[1]]);
    if (board.length < 3) return "";
    const suitCounts = {};
    for (const card of board) suitCounts[card[1]] = (suitCounts[card[1]] || 0) + 1;
    const [topSuit, topCount] = Object.entries(suitCounts).sort((a, b) => b[1] - a[1])[0];
    const ranks = board.map((card) => RANK_NUMBER[card[0]]);
    const window = straightWindow(ranks);
    const notes = [];

    if (topCount >= 4) notes.push(`Four ${SUIT_NAME[topSuit]} on board: any ${topSuit === "s" ? "spade" : SUIT_NAME[topSuit].slice(0, -1)} makes a flush.`);
    else if (topCount === 3) notes.push(`Three ${SUIT_NAME[topSuit]}: two ${SUIT_NAME[topSuit]} in hand make a flush.`);
    else if (topCount === 2 && board.length === 3) notes.push(`Flush draw possible (two ${SUIT_NAME[topSuit]}).`);
    else if (topCount === 2) notes.push("Flush draws possible.");
    else notes.push("No flush draw.");

    if (window >= 4) notes.push("Four cards to a straight on board.");
    else if (window === 3) notes.push("Straight draws likely.");
    else if (window === 2) notes.push("Few straight draws.");
    else notes.push("No real straight draws.");

    if (new Set(ranks).size < ranks.length) notes.push("Paired board: trips and full houses are possible.");
    return notes.join(" ");
  }

  function isTableDivider(line) {
    return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(line.trim());
  }

  function splitTableRow(line) {
    return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  }

  // Parses a GitHub-style markdown table starting at `start`. Returns null when the lines are not a table.
  function parseMarkdownTable(lines, start) {
    const header = lines[start]?.trim() || "";
    if (!header.startsWith("|") || !isTableDivider(lines[start + 1] || "")) return null;
    const rows = [];
    let index = start + 2;
    while (index < lines.length && lines[index].trim().startsWith("|")) {
      rows.push(splitTableRow(lines[index]));
      index += 1;
    }
    return { header: splitTableRow(header), rows, end: index };
  }

  function actionTone(action) {
    const lower = String(action || "").toLowerCase();
    if (["bet", "raise", "all-in", "allin"].includes(lower)) return "aggressive";
    if (["check", "call"].includes(lower)) return "passive";
    if (lower === "fold") return "fold";
    return "neutral";
  }

  function verdictAgreement(aiAction, solverAction) {
    if (!aiAction || !solverAction) return null;
    return aiAction.toLowerCase() === solverAction.toLowerCase() ? "agree" : "disagree";
  }

  return {
    extractRecommendedAction,
    extractDecision,
    recommendationWriteup,
    summarizeReasoning,
    extractSection,
    blurb,
    boardNote,
    parseMarkdownTable,
    actionTone,
    verdictAgreement,
  };
});
