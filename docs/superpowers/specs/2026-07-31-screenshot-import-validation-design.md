# Screenshot Import Validation and Vision Debug Design

## Goal

Prevent impossible Texas Hold'em card layouts from reaching the UI and retain complete vision-model output for every screenshot-backed analysis.

## Design

The server will validate and normalize the vision result before returning it to the browser. A five-card array returned in `board.flop` is treated as an unambiguous full-board sequence and split into three flop cards, one turn card, and one river card. Other invalid street counts, duplicate community cards, or collisions between the hero hand and board are rejected with a clear validation error.

The vision prompt will explicitly require two unique hero cards and a unique community board structured as 3 flop cards, at most 1 turn card, and at most 1 river card. Application validation remains authoritative.

The screenshot import request will carry an import identifier. The server will create an import debug record containing the complete raw primary vision response, provider/model metadata, parsed output, normalization notes, focused-verification output, and final hand. When the user starts an analysis from that import, the client will pass the import identifier so the import debug record is copied into the per-analysis log.

## Error Handling

Invalid vision JSON remains a provider failure and may use the configured fallback provider. Structurally impossible poker cards fail import validation rather than being silently displayed. Raw model text is retained in server-side logs even when parsing or validation fails, but image base64 data and API credentials are never logged.

## Testing

Regression tests cover five cards incorrectly placed in `flop`, duplicate board cards, hero/board collisions, and preservation/association of complete raw vision debug output. The full existing check suite must remain green.
