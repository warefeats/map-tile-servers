# 0009 — PostGIS categories the database decides

Date: 2026-10-09. Status: accepted after run rc81a4e44, on John's call. Amends ADR 0008.

## Context

Run rc81a4e44 measured where the PostGIS family's time goes. On the marquee tile (buildings, z14 8802/5371, 2,123 polygons), each server's tile query costs PostgreSQL about 12.4 ms of CPU, and the database container has 6 cores. That caps every server near 480 tiles/s, whatever the server does:

| Measurement on the marquee tile | Result |
|---------------------------------|--------|
| Martin 2.0's query in pgbench (8 clients, prepared, 6 database cores) | 484 queries/s |
| BBOX's query (rows, encoded in BBOX's own process) | 455 queries/s |
| Tegola's query | 249 queries/s |
| pg_tileserv's query | 217 queries/s |
| Where the database spends Martin 2.0's 12.4 ms | `ST_AsMVTGeom` 10.4 ms, encoding 1.2 ms, reading geometries 0.2 ms, index scan 0.6 ms |

Four PostGIS categories sit at that cap, with the leading servers inside its noise:

| Category | Martin 2.0 | Best rival | rc81a4e44 outcome |
|----------|------------|------------|-------------------|
| 10 clients, one tile | 452 tiles/s | BBOX 472 | Tie (database-bound) |
| 100 clients, one tile | 430 tiles/s | BBOX 434 | Tie (database-bound) |
| Capacity within the SLO | 800 tiles/s | BBOX 800 | Tie (database-bound) |
| Viewport burst | 5.78 ms | pg_tileserv 6.36 ms | Tie (database-bound), 10.0% ahead with overlapping intervals |

Those results measure PostgreSQL and PostGIS more than they measure the servers. On 2026-10-09 John ruled: "Where PostGIS is the floor, it doesn't seem reasonable to measure, so those benchmarks can go, except where they illustrate a clear difference in platforms."

## Decision

1. PostGIS 10 clients, 100 clients, capacity within the SLO and viewport burst leave the verdict. They get no outcome against rivals, are not counted, and never block publication. Their comparison with 1.16.1 is still computed and reported; a "slower" there gets a recommendation for a martin session but does not block.
2. The 10-client chart stays on the page as unranked context, because it shows a platform difference the database does not erase: some servers' queries cost PostgreSQL about twice as much per tile as others'.
3. The other PostGIS serving categories stay ranked: single tile, random walk, cost per tile and map session. In rc81a4e44 Martin 2.0 leads every rival in them by 11% to 77%. ADR 0008's database-bound tie rule still applies to them.
4. The archive family is unchanged. It has no database, and its throughput categories measure the servers.

## Consequences

- The verdict counts 18 categories: 7 in the PostGIS family and 11 in the archive family.
- This rule was set after rc81a4e44's data was seen. All four categories it removes were ties for Martin 2.0, none a loss, so the page names this ADR and the rule it replaces.
- A later run that moves PostgreSQL to faster hardware, or a faster PostGIS, could lift the cap and turn these categories back into measurements of the servers. That would need a new ADR.
