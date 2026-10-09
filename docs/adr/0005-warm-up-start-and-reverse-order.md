# 0005 — A warm-up start, ten cold starts, and a second pass in reverse order

Date: 2026-09-28. Status: accepted 2026-10-08, before the measured pass of the release PR's head (ADR 0006); first applied there.

## Context

Two effects in the protocol are larger than the margins ADR 0001 ranks on, and neither is a property of any server.

The first start in each candidate's cold-start series is the slowest for every server, by an amount that changes from run to run. With three starts, that one start decides the interval.

| Run | Server | Starts, ms |
|-----|--------|-----------|
| int16, PostGIS, 1,000 sources | Martin 2.0.0 | 183.1, 113.2, 112.3 |
| int16, PostGIS, 1,000 sources | pg_tileserv | 140.5, 130.5, 131.6 |
| re-run the same afternoon | Martin 2.0.0 | 137.4, 114.9, 105.0 |
| re-run the same afternoon | pg_tileserv | 136.6, 122.8, 123.4 |
| int3, archive, 1,000 sources | Martin 2.0.0 (PMTiles) | 150.5, 74.8, 79.2 |
| int3, archive, 1,000 sources | go-pmtiles | 100.6, 80.7, 71.1 |

Candidates run one after another, about eight minutes each, on a host that other work shares. Two candidates within a few percent of each other trade places with the host's load. The same two builds, measured three times by the full protocol and once alternating round by round:

| PostGIS, 10 clients, tiles/s | Martin 2.0.0 | Martin 1.16.1 |
|------------------------------|-------------:|--------------:|
| int2 | 428.7 | 277.1 |
| int2b | 508.2 | 506.4 |
| int16 | 464.3 | 474.3 |
| alternating, 5 rounds | 468.7 | 465.7 |

## Decision

- Every cold-start category (time to first tile, a thousand sources) starts each candidate once without recording it, then records ten starts, where the protocol recorded five (time to first tile) and three (a thousand sources).
- Each family's protocol runs twice, the second time in reverse candidate order, and each candidate's samples from both passes are pooled before the statistics and intervals of ADR 0001 are computed.

The categories, the statistics and the verdict rule of ADR 0001 are unchanged.

## Consequences

- A full run takes about twice as long.
- Drift that grows or shrinks over a run lands on the first candidates of one pass and the last of the other, so it no longer favours whoever runs first.
- Results from runs before this ADR stay as they are; the published page uses the first run under it.
