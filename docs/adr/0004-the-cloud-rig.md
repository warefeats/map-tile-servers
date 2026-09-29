# 0004 — Runs move to a dedicated cloud host

Date: 2026-09-28. Status: proposed.

## Context

The M2 Max that produced every run so far is shared with other work, and that work does not stop for a benchmark. On 2026-09-28 the host load reached 26 during Martin 2.0.0's PostGIS slot and 49 an hour later; the candidate measured in the spike lost more than half its throughput, and the CPU it was charged per tile doubled, because a contended VM counts time it waits for the host as time it ran.

| PostGIS, Martin 2.0.0 | Quiet slot | Slot in the spike |
|-----------------------|-----------:|------------------:|
| Random walk, tiles/s | 935.9 | 406.4 |
| Cost per tile, µs | 6,575 | 11,327 |

Gating each candidate on a quiet host kept the numbers clean but left the run waiting for hours, and single-connection passes through OrbStack's VM still land in a slow wakeup mode whose frequency tracks the host rather than the server.

## Decision

Measured runs happen on one EC2 host that runs nothing else: c7g.metal, 64 Graviton3 cores, bare metal, so there is no hypervisor between the containers and the machine. The harness runs unchanged on it: the same compose files and per-container CPU and memory limits, the same images (the locally built ones are shipped, the published ones pulled by the same tags, all native arm64), and the same corpus bytes (the database volume and both archives are copied from the Mac). The laptop drives the host over SSM (`just rig-pack`, `just rig-run`, `just rig-fetch`); the host terminates itself when the run ends. The Mac stays the place for diagnostics.

## Consequences

- Absolute numbers are not comparable with the M2 Max runs; every candidate in a cloud run is measured on the same host, and the version comparison (2.0.0 against 1.16.1) is within the run.
- The page names the rig, the way ADR 0002 records the load generator's position.
- A run costs the instance's hourly price for its length, about four hours for both families.
