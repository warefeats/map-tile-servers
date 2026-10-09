# 0007 — Archive times are ranked above the harness floor

Date: 2026-10-08. Status: accepted before the measured pass.

## Context

Every time this harness records includes work no server can skip: Docker starting a container, the client's connections, the network between two containers, the client's own scheduling. On 2026-09-27 a static file server (nginx 1.30.4 run directly, the archive's tiles as files in a Docker volume) went through the harness's own cold-start, single-tile, burst and session code. In the archive family, that floor is most of every number:

| Archive test | Static file server | Martin 2.0 (PMTiles) | VersaTiles (PMTiles) |
|--------------|-------------------:|---------------------:|---------------------:|
| Time to first tile, ms | 64.65 (median of 10) | 77.9 | 67.1 |
| Single tile z14 / z12 / z9 / z5, ms | 0.0845 / 0.046 / 0.039 / 0.0365 | 0.0985 / 0.055 / 0.0465 / 0.055 | 0.104 / 0.056 / 0.0565 / 0.0385 |
| Viewport burst, ms | 1.43 | 1.48 | 1.55 |
| Map session, 10 users, ms per view | 8.29 | 8.41 | 9.99 |

ADR 0001's 10% margin, applied to totals like these, asks a server to beat the floor itself: to lead 1.55 ms by 10%, a burst has to finish in 1.41 ms, under the 1.43 ms a file server needs. No server can win those categories, whatever it does. On 2026-09-28 John agreed that floor-bound measurements are fixed by an ADR written before the next run and applied to every server; this is that ADR.

## Decision

- The archive family gets a control, `floor`: nginx 1.30.4 (`nginx:stable` of 2026-08-25, pinned by digest), run directly with no entrypoint scripts. It has 4 worker processes, the access log off, the open file cache on, and the same 4 CPU and 4 GB limits as every engine.
- It serves every tile the floored sections request as a file holding the archive's stored bytes, with `Content-Encoding: gzip`, and answers 204 for a tile the archive does not have, as Martin does. The runner extracts those files from `berlin.mbtiles` itself, so the bytes are the archive's, not any server's.
- The control runs the sections a file server can run: time to first tile, parity, single tile, viewport burst, both map sessions, and the thousand-sources start (with nothing extra to load). It is never ranked and never shown as a competitor.
- Under ADR 0005 the control runs in both passes, first in the forward order and so last in the reverse one, and its samples are pooled like a candidate's.
- Five archive categories rank time above the floor: single tile, viewport burst, time to first tile, map session with 10 users, and a thousand sources. A candidate's time above the floor is its statistic minus the control's in the same run; a negative difference counts as zero.
- ADR 0001's margin (condition 2) is computed on those times above the floor. When Martin's is zero and a rival's is not, Martin's lead counts as at least 10%; when both are zero, neither leads.
- The intervals of condition 3 are unchanged. Subtracting one number from every candidate moves every interval by the same amount, so whether two intervals overlap does not change.
- The comparison with 1.16.1 uses the full times, as before; the subtraction cannot change which build is slower.

The PostGIS family has no floor. In the archive family every candidate serves the same stored bytes, so a file server holding them does the least work any server can. PostGIS servers each make their own tiles from the database, and the database's work is the job being measured, so a file server is not a floor for them.

Throughput, capacity, cost per tile and memory are not floored either. For throughput a file server sets a ceiling, not a floor, and ADR 0002 already put the load generator where archive throughput is the servers' own.

## Consequences

- A lead in a floored category is a share of the time a server controls. Two servers that both sit within noise of the floor tie, because their intervals overlap.
- The page shows the floor next to each category it adjusts.
- Run files from before this ADR have no control and are scored on full times.
