function normalizeCardToken(card) {
  const compact = String(card || "").trim().replace(/\s+/g, "");
  const match = compact.match(/^([2-9TJQKA])([cdhs])$/i);
  if (!match) return null;
  return match[1].toUpperCase() + match[2].toLowerCase();
}

export function normalizeImportedCardToken(card) {
  return normalizeCardToken(card);
}

function cardsFromCompactToken(token) {
  const compact = String(token || "").replace(/\s+/g, "");
  const match = compact.match(/^([2-9TJQKA][cdhs])([2-9TJQKA][cdhs])$/i);
  if (!match) return null;
  return [normalizeCardToken(match[1]), normalizeCardToken(match[2])].filter(Boolean);
}

function heroCardsFromNote(note) {
  const text = String(note || "");
  const explicit = text.match(/\bhero\b[^.:\n]*(?:has|hand|cards?)[^A-Za-z0-9]*([2-9TJQKA][cdhs])[\s,/+-]*([2-9TJQKA][cdhs])\b/i);
  if (explicit) return [normalizeCardToken(explicit[1]), normalizeCardToken(explicit[2])].filter(Boolean);

  const compact = text.match(/\bhero\b[^.:\n]*(?:has|hand|cards?)[^A-Za-z0-9]*([2-9TJQKA][cdhs][2-9TJQKA][cdhs])\b/i);
  return compact ? cardsFromCompactToken(compact[1]) : null;
}

export function repairImportedHeroHandFromNotes(hand = {}) {
  if (!Array.isArray(hand.heroHand) || hand.heroHand.length !== 2) return hand;
  const notes = Array.isArray(hand.confidenceNotes) ? hand.confidenceNotes : [];
  for (const note of notes) {
    const notedCards = heroCardsFromNote(note);
    if (notedCards?.length !== 2) continue;
    const sameRanks =
      notedCards[0][0] === String(hand.heroHand[0] || "")[0]?.toUpperCase() &&
      notedCards[1][0] === String(hand.heroHand[1] || "")[0]?.toUpperCase();
    if (!sameRanks) continue;
    return {
      ...hand,
      heroHand: notedCards,
      confidenceNotes: [
        ...notes,
        `Hero hand repaired from confidence-note suit cross-check: ${hand.heroHand.join(" ")} -> ${notedCards.join(" ")}.`,
      ],
    };
  }
  return hand;
}

export function shouldVerifyHeroHandWithFocusedVision(hand = {}, { actionIssues = [] } = {}) {
  if (!Array.isArray(hand.heroHand) || hand.heroHand.length !== 2) return false;
  if (actionIssues.length > 0) return true;
  if (new Set(hand.heroHand.map(normalizeCardToken).filter(Boolean)).size !== 2) return true;
  const notes = Array.isArray(hand.confidenceNotes) ? hand.confidenceNotes.join(" ") : "";
  if (/low confidence|unclear|uncertain|cannot read|not visible/i.test(notes)) return true;
  const namedHero = normalizePlayerIdentity(hand.heroName);
  const declaredHero = (hand.players || []).find((player) => player.isHero);
  return Boolean(namedHero && declaredHero && normalizePlayerIdentity(declaredHero.name) !== namedHero);
}

export function applyFocusedActionRepair(hand = {}, repair = {}) {
  const candidate = stripNonDecisionActions({
    ...hand,
    heroName: repair.heroName ?? hand.heroName,
    heroHand: Array.isArray(repair.heroHand) ? repair.heroHand : hand.heroHand,
    players: Array.isArray(repair.players) ? repair.players : hand.players,
    streets: Object.fromEntries(Object.entries(hand.streets || {}).map(([street, broadStreet]) => [
      street,
      {
        ...broadStreet,
        ...(repair.streets?.[street] || {}),
        potBb: repair.streets?.[street]?.potBb ?? broadStreet?.potBb ?? null,
      },
    ])),
  });
  for (const [street, repairedStreet] of Object.entries(repair.streets || {})) {
    if (!candidate.streets[street]) candidate.streets[street] = repairedStreet;
  }
  const cleanedCandidate = attributeYellowBubblesToHero(stripNonDecisionActions(candidate));
  cleanedCandidate.players = (cleanedCandidate.players || []).map((player) => ({
    ...player,
    isHero: normalizePlayerIdentity(player.name) === normalizePlayerIdentity(cleanedCandidate.heroName),
  }));
  const validation = validateImportedActionConsistency(cleanedCandidate);
  const hasHero = cleanedCandidate.players.some((player) => player.isHero);
  const issues = hasHero ? validation.issues : [
    ...validation.issues,
    { code: "HERO_NOT_IN_PLAYER_LIST", street: null, actor: cleanedCandidate.heroName || null, message: "Repaired hero is absent from the player list." },
  ];
  return issues.length
    ? { hand, accepted: false, reason: "unsafe-repair", issues }
    : { hand: cleanedCandidate, accepted: true, reason: "verified-action-identities", issues: [] };
}

export function normalizePlayerIdentity(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function applyFocusedHeroHandVerification(hand = {}, focused = {}) {
  const focusedCards = Array.isArray(focused.heroHand)
    ? focused.heroHand.map(normalizeCardToken).filter(Boolean)
    : [];
  const original = Array.isArray(hand.heroHand)
    ? hand.heroHand.map(normalizeCardToken).filter(Boolean)
    : [];
  const notes = Array.isArray(hand.confidenceNotes) ? hand.confidenceNotes : [];
  const normalizedSeat = String(focused.seat || "").trim().toLowerCase();
  const focusedPlayerIdentity = normalizePlayerIdentity(focused.playerName);
  const matchedPlayer = (hand.players || []).find(
    (player) => normalizePlayerIdentity(player.name) === focusedPlayerIdentity,
  );
  let reason = "verified-bottom-center-player";

  if (original.length !== 2) reason = "invalid-provisional-cards";
  else if (focusedCards.length !== 2) reason = "invalid-focused-cards";
  else if (new Set(focusedCards).size !== 2) reason = "duplicate-focused-cards";
  else if (normalizedSeat !== "bottom-center") reason = "wrong-seat";
  else if (!matchedPlayer) reason = "focused-player-not-found";
  else if (String(focused.confidence || "").toLowerCase() !== "high") reason = "insufficient-confidence";

  const accepted = reason === "verified-bottom-center-player";
  const focusedHeroDecision = {
    accepted,
    reason,
    originalCards: original,
    focusedCards,
    playerName: matchedPlayer?.name || String(focused.playerName || "").trim() || null,
  };

  if (!accepted) {
    return {
      ...hand,
      focusedHeroDecision,
      confidenceNotes: [
        ...notes,
        `Focused bottom-seat card verification was not applied (${reason}); review the imported cards.`,
      ],
    };
  }

  const evidenceText = focused.evidence || focused.colorEvidence;
  const evidence = evidenceText ? ` Evidence: ${evidenceText}` : "";
  return {
    ...hand,
    heroName: matchedPlayer.name,
    heroHandOwner: matchedPlayer.name,
    heroHand: focusedCards,
    players: (hand.players || []).map((player) => ({
      ...player,
      isHero: normalizePlayerIdentity(player.name) === focusedPlayerIdentity,
    })),
    focusedHeroDecision,
    confidenceNotes: [
      ...notes,
      `Hero hand repaired from focused bottom-seat card verification: ${original.join(" ")} -> ${focusedCards.join(" ")}.${evidence}`,
    ],
  };
}
import { stripNonDecisionActions, validateImportedActionConsistency } from "./importActionConsistency.js";

// Yellow bubbles carry no player name, so attribution is mechanical: they are always Hero's.
export function attributeYellowBubblesToHero(hand = {}) {
  const heroName = hand.heroName;
  const hero = (hand.players || []).find((player) => player.isHero || (heroName && player.name === heroName));
  if (!heroName || !hero) return hand;
  const streets = Object.fromEntries(Object.entries(hand.streets || {}).map(([street, data]) => [
    street,
    {
      ...data,
      actions: (data?.actions || []).map((action) => (String(action?.bubble || "").toLowerCase() === "yellow"
        ? { ...action, actor: heroName, position: hero.position ?? null }
        : action)),
    },
  ]));
  return { ...hand, streets };
}
