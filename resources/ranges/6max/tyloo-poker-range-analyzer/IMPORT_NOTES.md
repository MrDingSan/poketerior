# Import Notes

Imported from:

```text
https://github.com/Tyloo/poker-range-analyzer
```

License:

```text
MIT
```

The upstream project describes these as 6-max No-Limit Hold'em GTO preflop ranges.

## What We Imported

```text
lib/ranges/utg.ts
lib/ranges/mp.ts
lib/ranges/co.ts
lib/ranges/btn.ts
lib/ranges/sb.ts
lib/ranges/bb.ts
lib/ranges/index.ts
LICENSE
README.upstream.md
```

## Coverage

- `UTG`, `MP`, `CO`, `BTN`, `SB`: opening/RFI style ranges.
- `BB`: documented upstream as a big blind defense range versus button open.
- Each hand class has raise/call/fold frequencies.

## Caveats For Poker Coach

Poker Coach currently uses `HJ`, not `MP`. For six-max naming, `MP` can usually be mapped to `HJ`, but we should verify that assumption.

These files do not cover every possible preflop node we need. Missing examples include:

- BTN versus UTG open
- SB versus HJ open
- HJ response versus SB 3-bet
- 4-bet and 5-bet lines
- cold-call lines by position

These ranges should be treated as a licensed first reference source, not the final strategic truth.
