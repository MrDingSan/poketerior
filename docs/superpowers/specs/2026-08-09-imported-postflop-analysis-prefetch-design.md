# Imported Postflop Analysis Prefetch Design

## Problem

Imported screenshot decisions are analyzed only after the user clicks a decision point. Each analysis runs local calculations plus several independent LLM, range, and solver requests, so the most important post-flop decisions can take a long time to become fully usable. The application already caches a completed imported-decision UI snapshot, but the cache is populated only by an explicit click.

## Goal

After a screenshot import passes validation, automatically analyze the two post-flop decision points the user is most likely to open. Reuse the existing imported-analysis cache so a completed prefetched point appears immediately when clicked, without duplicating work already in progress.

## Eligible Decision Points

Only flop, turn, and river points are eligible. A point is eligible when either:

- the recorded action belongs to Hero, representing Hero's decision immediately before that action; or
- an opponent bets, raises, or moves all-in and the imported decision model represents the following unresolved Hero response.

Passive opponent actions such as calls, checks, and folds are not prefetch candidates. A Hero action that is first on a newly dealt street remains eligible because it represents Hero's check-or-bet decision after the board changes.

Unsafe imports, imports with invalid or incomplete cards, and points whose imported decision context cannot be constructed are not queued.

## Priority Model

Candidates are ranked deterministically in this order:

1. Hero facing an all-in.
2. Hero facing a raise.
3. Hero facing a bet, ordered by descending bet-to-pot ratio when that ratio is available.
4. Hero facing any remaining bet.
5. Hero making the first action on a newly dealt flop, turn, or river.
6. Other recorded Hero post-flop actions.

Stable hand-history order breaks ties. Only the highest-ranked two candidates are selected.

## Prefetch Queue

The application owns one import-prefetch queue for the active imported hand. It runs one selected point at a time. Sequential execution limits the burst of requests because a full analysis launches Gemini reasoning, Harrington, PokerSkill, range interpretation, and solver work in addition to local calculations.

Each queue entry has a stable decision cache state and one lifecycle status: queued, running, completed, or failed. The queue must deduplicate entries by the same stable cache key used by the imported-analysis cache.

When the user clicks an eligible point:

- a completed snapshot is restored immediately;
- a queued point is promoted ahead of other queued work;
- a running point reuses its in-flight promise and displays its current analysis state rather than starting duplicate requests;
- a failed point may be retried through the normal foreground analysis path.

A failure is isolated to its entry and does not prevent the queue from continuing with the next candidate.

## Analysis Isolation

The current `analyze()` function writes directly into the visible analyzer and uses one global request ID to discard stale responses. Background prefetch must not repeatedly navigate or overwrite the screen the user is viewing.

The analysis workflow will therefore expose a prefetched execution path that can produce the same complete snapshot as foreground analysis while keeping its request state separate from the visible request. It must run the full analysis bundle:

- local range, equity, pot-odds, EV, and recommendation calculations;
- Gemini coaching reasoning;
- Harrington-style analysis;
- PokerSkill analysis;
- LLM range interpretation; and
- the post-flop solver recommendation.

The resulting snapshot must use the same format consumed by `restoreImportedAnalysisSnapshot()`. Existing foreground behavior remains unchanged for manual analysis and non-prefetched imported points.

## Cache and Invalidation

Prefetched results are stored in the existing in-memory imported-analysis cache using `importedDecisionCacheState()`. The state already includes the import ID, selected Hero, target street/index, cards, positions, range mode, game type, and action rows.

Changing imported cards, selecting a different Hero, replacing the screenshot import, or otherwise changing state represented in the cache key must cancel or supersede the active queue. Responses from an obsolete queue generation must not populate the active import's cache or visible UI. New valid state creates a fresh ranked queue.

## User Experience

Prefetch begins automatically after the imported hand is rendered and card/action validation succeeds. It does not switch the application away from import mode or move the visible analyzer to a decision point.

Decision buttons may expose concise status text such as `Preparing`, `Ready`, or `Retry`, but prefetch failures must not replace the import's primary status with a blocking error. When a ready point is clicked, its completed analysis appears immediately. When a running point is clicked, the visible analyzer adopts the existing in-flight work and continues updating until complete.

## Testing

Pure model tests must verify:

- preflop points and passive opponent actions are excluded;
- all-ins outrank raises, raises outrank bets, and bets outrank first-to-act Hero decisions;
- larger bet-to-pot ratios rank ahead of smaller bets;
- stable hand-history order breaks ties;
- only two candidates are selected;
- queue keys are deduplicated;
- queued points can be promoted; and
- one failed job does not stop the next job.

Integration-oriented tests must verify:

- a valid screenshot import starts prefetch automatically;
- the full analysis bundle is requested for selected points;
- completed background work populates the existing snapshot cache;
- clicking completed work restores it without another analysis request;
- clicking running work does not duplicate requests;
- background execution does not overwrite an unrelated visible analysis; and
- import edits or Hero changes prevent stale queue results from being used.

## Scope

This feature preloads at most two likely post-flop decisions from a screenshot import. It does not prefetch preflop decisions, expand the number of analysis providers, persist results across browser sessions, or change the strategic recommendation algorithms.
