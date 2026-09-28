# Preflop Range Sources

## 6-max open-raise ranges

Source PDF:

- `preflop-charts-open-raises-6max-cash.pdf`
- Original title: `Preflop Charts: Open Raise in 6-max Poker Cash Games`
- Author line in PDF: Nick Korolev, in consultation with other pro players

The app uses the PDF's purple plus optional blue hands as the default RFI/open-raise range for 6-max.

Extracted selected-combo totals checked against the chart labels:

- UTG / EP: 226 combos, 17.0%
- MP / HJ: 292 combos, 22.0%
- CO: 388 combos, 29.3%
- BTN / BU: 638 combos, 48.1%
- SB: 626 combos, 47.2%

Scope:

- Used for open-raise / RFI spots only.
- Existing built-in ranges remain in use for call-vs-open, 3bet-vs-open, and call-vs-3bet until separate source PDFs are added.

## Range profile modes

The UI offers two opponent opening-range profiles:

- Loose low-stakes online: default. Starts from the PDF chart, forces all pocket pairs into the opening range, then adds the next highest-ranked missing hand classes until the range is about 30% wider than the PDF baseline.
- Tight PDF baseline: uses the PDF chart exactly.

Loose-mode theoretical combo totals:

- UTG / EP: 298 combos
- MP / HJ: 382 combos
- CO: 506 combos
- BTN / BU: 834 combos
- SB: 822 combos
