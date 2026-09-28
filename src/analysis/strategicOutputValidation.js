const HARRINGTON_SECTIONS = [
  ["Situation", "Situation"],
  ["Key Evidence", "Key Evidence"],
  ["Candidate Actions", "Candidate Actions"],
  ["Recommendation", "Recommendation"],
  ["Caveats", "(?:Harrington[- ]style\\s+)?Caveats?"],
];

function repetitionReason(text) {
  const words = text.toLowerCase().replace(/[^a-z0-9'-]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const counts = new Map();
  const width = 8;
  for (let index = 0; index <= words.length - width; index += 1) {
    const phrase = words.slice(index, index + width).join(" ");
    const count = (counts.get(phrase) || 0) + 1;
    if (count >= 8) return `Repeated phrase detected at least ${count} times: "${phrase}".`;
    counts.set(phrase, count);
  }
  return null;
}

export function validateStrategicOutput({ text = "", format = "generic", completion = {} } = {}) {
  const reasons = [];
  const normalized = String(text || "").trim();
  const finishReason = String(completion?.finishReason || "").trim();

  if (!normalized) reasons.push("Response is empty.");
  if (finishReason && finishReason.toUpperCase() !== "STOP") {
    reasons.push(`Provider finish reason was ${finishReason}, not STOP.`);
  }

  const repetition = repetitionReason(normalized);
  if (repetition) reasons.push(repetition);

  if (format === "harrington") {
    for (const [label, pattern] of HARRINGTON_SECTIONS) {
      if (!new RegExp(`(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:\\d+[.)]?\\s*)?${pattern}\\s*:?(?:\\s|$)`, "im").test(normalized)) {
        reasons.push(`Missing required Harrington section: ${label}.`);
      }
    }
  }

  if (normalized && !/[.!?\]>)`*_]$/.test(normalized)) {
    reasons.push("Response appears to end in an incomplete fragment.");
  }

  return { valid: reasons.length === 0, reasons };
}
