// Vision models sometimes write suits as symbols ("J♥") even when asked for letters. Rewrite them to the
// letter form every card parser expects, so a correct read isn't discarded as an invalid card.
const SUIT_SYMBOLS = { "♥": "h", "♡": "h", "♦": "d", "♢": "d", "♣": "c", "♧": "c", "♠": "s", "♤": "s" };

export function cardText(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[♥♡♦♢♣♧♠♤]/g, (symbol) => SUIT_SYMBOLS[symbol]);
}
