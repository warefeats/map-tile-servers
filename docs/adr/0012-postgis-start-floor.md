# 0012 — PostGIS start times are ranked above a floor

Date: 2026-11-11. Status: accepted before the measured pass.

## Context

ADR 0007 gave the archive family a floor and left PostGIS without one: PostGIS servers make their own tiles, and the database's work is the job being measured. That holds for serving a tile. It does not hold for starting up, which also includes Docker starting a container and the network between two containers, work no server can skip.

Run rc08bc08f (2026-11-11, both families on c7g.metal) shows how much that is. The archive family's floor, nginx serving plain files, took 106 ms to its first tile. In the PostGIS family,

| PostGIS start | Martin 2.0.0-beta.7 | Tegola | pg_tileserv |
|---------------|--------------------:|-------:|------------:|
| Time to first tile, ms (mean of 20) | 145.7 | 148.7 | 178.1 |
| A thousand sources, ms (mean of 20) | 200.1 | 302.3 | 212.1 |

Martin's start without the container was timed locally on the same corpus, settings and config: about 36 ms from process start to the first tile, of which about 10 ms is PostgreSQL loading the PostGIS library for the first PostGIS call and about 12 ms is making the tile. ADR 0001's 10% margin, applied to totals that are mostly container start, asks Martin to finish in 135 ms, which means cutting a quarter of its own time, while the same lead measured on the time each server controls is already near 8%. On 2026-11-11 John agreed to give the PostGIS host a floor of its own; this is that ADR.

## Decision

- The PostGIS family gets a control, `floor-postgis`: the archive floor's nginx 1.30.4 (pinned by digest), run directly with the same settings and the same 4 CPU and 4 GB limits as every engine.
- It serves one file, the marquee tile, gzipped: the bytes PostGIS makes from the corpus with the tile parameters every server uses (extent 4096, buffer 64, clipped). The runner makes it with `ST_AsMVT` itself, so the bytes are the database's, not any server's. Any other tile is empty (204).
- The control runs the two start sections: time to first tile, and the thousand-sources start with nothing extra to load. It is never ranked and never shown as a competitor.
- Under ADR 0005 the control runs in both passes, first in the forward order and so last in the reverse one, and its samples are pooled like a candidate's.
- Two PostGIS categories rank time above the floor: time to first tile and a thousand sources. ADR 0007's rules apply unchanged: a candidate's time above the floor is its statistic minus the control's in the same run, a negative difference counts as zero, the margin of condition 2 is computed on those times, the intervals of condition 3 are unchanged, and the comparison with 1.16.1 uses full times.
- The PostGIS serving categories stay on full times: single tile, viewport burst and the map session are the database's work, as ADR 0007 says.

## Consequences

- A lead in a PostGIS start category is a share of the time a server controls, as in the archive family.
- The page shows the floor next to the two categories it adjusts.
- Run files from before this ADR have no PostGIS control and are scored on full times.
