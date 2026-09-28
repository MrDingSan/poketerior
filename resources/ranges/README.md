# Range Resources

This folder stores external range resources before they are converted into Poker Coach's internal range model.

## Current Sources

```text
6max/tyloo-poker-range-analyzer/
```

Source: `https://github.com/Tyloo/poker-range-analyzer`

License: MIT, copied in the source folder as `LICENSE`.

## Notes

The imported Tyloo source includes 6-max position ranges with raise/call/fold frequencies. It is a good first public, licensed reference set for RFI/opening ranges and one BB defense file, but it is not a complete preflop solver tree for every facing-open, facing-3bet, 4bet, and cold-call configuration.

Before wiring this into the app, verify:

- whether `MP` should map to our `HJ`
- whether the ranges are appropriate for your target stakes and stack depth
- whether we want pure actions only or mixed-frequency handling
- how to supplement missing facing-open and facing-3bet spots
