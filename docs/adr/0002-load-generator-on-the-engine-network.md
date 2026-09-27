# 0002 — The load generator sits on the engine's Docker network

Date: 2026-09-26. Status: accepted.

## Context

The September tile-server runs drove every engine from oha on the macOS host through the container's published port. On this rig (M2 Max, OrbStack, 12 VM CPUs) that path has a ceiling of its own. Measured today against nginx 1.29 serving a static file from a 4-CPU container:

| Path | 242 KB file, 10 clients | 242 KB, 100 clients | 4 KB file, 10 clients | 4 KB, 100 clients |
|------|------------------------:|--------------------:|----------------------:|------------------:|
| host oha → published port | 13,831/s | 8,823/s | 25,327/s | 43,623/s |
| oha in a container on the same Docker network (6 CPUs) | 57,236/s | 54,128/s | 72,499/s | 44,828/s |

The published archive page's fastest numbers (Martin at 12,634 tiles/s on the 242 KB marquee tile at 100 clients, 13,724 on the walk) sit at the host path's ceiling, and its drop from 10 to 100 clients (Martin MBTiles 11,145 → 9,185) matches the host path's own drop (13,831 → 8,823). Those results measured the harness as much as the servers.

## Decision

Every measuring client runs in one long-lived container (`wf-client`: Bun 1.4.0 and oha 1.16.0) on the engine network: oha passes, the viewport bursts, the map sessions, the parity fetches and the cold-start poller. Engines publish no host port. The client gets 6 CPUs in archive runs and 2 in PostGIS runs, where the database keeps its 6 and the engine its 4.

Cold start is timed in one clock: the poller is already polling on the engine network when the container starts, and records the first 200 in the VM's clock, which is also the clock of Docker's `StartedAt`.

## Consequences

- Absolute numbers are not comparable with the September pages; every candidate in this run is measured the same way, and the version comparison (2.0.0 against 1.16.1) is within the run.
- Latency now excludes the macOS port forwarder, so single-tile times are lower for everyone.
- The client shares the VM's CPUs with the engine; its budget is capped so it cannot starve the engine, and its ceiling (above) is several times the fastest engine measured.
