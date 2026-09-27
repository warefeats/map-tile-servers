# 0001 — The verdict rule, fixed before the data

Date: 2026-09-26. Status: accepted before the first measured pass.

## Context

This benchmark asks two questions about Martin 2.0.0 (release PR #3343 at `055d4eaa`, not yet released): is it faster than Martin 1.16.1, its most recent stable release, in the things the two September tile-server pages measured; and does it beat every competitor's most recent stable release in every category, including dimensions those pages never measured. The answer to the second decides whether the page is published without a further go-ahead. A rule chosen after seeing the numbers could be bent to fit them, so it is written down here first.

## Categories

A category is one ranked section. Each family has its own; the archive family treats Martin's two archive formats as one server (Martin wins a category if either of its 2.0.0 candidates does, and the same holds for BBOX and VersaTiles).

| # | Category | Family | Statistic (lower is better unless marked) | Previously measured |
|---|----------|--------|-------------------------------------------|---------------------|
| 1 | Single tile, one client | both | mean of pass means, pooled over the four test tiles | yes |
| 2 | Viewport burst, four tiles | both | mean wall time | yes |
| 3 | Throughput, 10 clients on the marquee tile | both | mean tiles/s (higher) | yes |
| 4 | Throughput, 100 clients on the marquee tile | both | mean tiles/s (higher) | yes |
| 5 | Random walk, 10 clients over 256 tiles | archive (new for PostGIS) | mean tiles/s (higher) | archive yes |
| 6 | Time to first tile after start | both | mean of repetitions | yes |
| 7 | Memory after load | both | anonymous memory, MiB | yes (as `docker stats` RSS) |
| 8 | Cost per tile | both | CPU µs per tile during the walk, engine plus database | no |
| 9 | Capacity within an SLO | both | highest open-loop rate held with p99 ≤ SLO (higher) | no |
| 10 | Map session, 10 users | both | mean time to finish a view | no |
| 11 | A thousand sources | both | time to first tile with 1,000 extra sources configured | no |

Memory ranks anonymous memory because an mmapped archive's pages are file-backed, shared with the OS page cache and reclaimable; counting them would penalise a server for choosing mmap. The `docker stats` figure the September pages used is recorded beside it.

Behaviours that are defensible choices (what a server sends a client without `Accept-Encoding`, the encoding it picks for a browser's `Accept-Encoding`, 204 vs 404 for an empty tile) are recorded and never ranked, per the rule the archive page set on 2026-09-08.

## Handily wins

Martin 2.0.0 handily wins a category when all three hold:

1. Its statistic is the best of every candidate in the family.
2. It beats the best competitor (any candidate that is not Martin) by at least 10%.
3. The gap is larger than the noise: the 95% confidence intervals of the two means do not overlap.

Intervals are percentile bootstrap intervals of the mean (10,000 resamples, fixed seed) over the category's samples: pass means for single tile (resampled within each test tile), bursts, per-pass tiles/s, per-pass CPU per tile, cold-start repetitions, view times for sessions. Two categories have no sample distribution, and condition 3 reads differently for them: capacity within an SLO is a step on a fixed ladder, so Martin must hold at least one step more than the best competitor; memory is two readings (after load, after the sessions), so the margin in condition 2 must be at least 20% instead of 10%.

## Faster than 1.16.1

Per category, the ratio 2.0.0 / 1.16.1 of the same statistic with a 95% bootstrap interval. "Much faster" is a ratio of at least 1.25× in 2.0.0's favour with the interval clear of 1.0; "no change" is an interval that contains 1.0; "slower" is an interval wholly on 1.16.1's side. A regression against 1.16.1 in any category counts as a category lost, whatever the competitors did.

## Consequences

- Publish only if Martin 2.0.0 handily wins all categories of both families and regresses against 1.16.1 in none.
- Otherwise, every category it does not handily win gets a written recommendation (what the time or memory is spent on, measured, and the direction of a fix) for a separate martin session to turn into PRs. Nothing is posted.
- The rule is applied to the full protocol run only. Smoke runs inform the harness, never the verdict.
