# 0010 — The release PR head on the cloud rig

Date: 2026-10-29. Status: accepted before the measured pass.

## Context

The M2 Max that ran every measured pass so far was sold on 2026-10-27, and the machine that now holds this repo has no Docker and is not arm64. On 2026-10-29 John asked for the next run on a cloud rig like the kv-stores one (c7g.metal in us-east-1), measuring the release PR head again: maplibre/martin #3776 at `722fb6d1`, which cuts 2.0.0-beta.5. That commit is main at `44e40e7b` merged into release-plz's version bump and the beta.5 release notes. 1.16.1 is still the latest stable 1.x. ADR 0004 built a rig and did not adopt it; this run starts from it.

Since #3569 (2026-10-11), Martin's release and nightly builds make the arm64 Docker binary with profile-guided optimization. build-binary.yml runs `just pgo-install` and `just build-release aarch64-unknown-linux-gnu true` on ubuntu-24.04-arm: an instrumented build, a training run of the recipe's `just bench-http 20000 20000` against Martin's test fixtures and a PostGIS loaded by `tests/fixtures/initdb.sh`, and a second build with the profile. The 2.0.0-beta.4 release ran that path; its binary reports rustc 1.99.1 (58cf8f9c3 2026-10-13). A plain `--release` build, what ADR 0006 measured, is no longer what the image ships.

Three competitors have shipped a newer stable release since run rc81a4e44: VersaTiles 5.4.1 (was 4.14.0), tileserver-gl-light 5.7.0 (was 5.6.0; it no longer recompresses gzipped vector tiles, maptiler/tileserver-gl#2369) and ldproxy 4.8.2 (was 4.8.1).

On a 64-core host, a runtime that sizes itself by the host's cores instead of the container's CPU limit runs 64 threads against a 4-CPU quota. mbtileserver 0.11.0 is built with Go 1.23, which does that; Go 1.25 made GOMAXPROCS follow the limit. Tegola and pg_tileserv have run with GOMAXPROCS=4 since the September page. Every other server sizes itself by the limit or is configured for 4.

## Decision

- Martin 2.0 is #3776 at `722fb6d1` (2.0.0-beta.5), built on the rig the way the release builds its arm64 Docker binary: build-binary.yml's profile-guided path, with the same pinned PostGIS service image for the training run, on Ubuntu 24.04 arm64 with rustc 1.99.1 and oha 1.16.0. It is packaged with the commit's `.github/files/multi-platform.Dockerfile` as `wf-martin:2.0.0-beta.5-722fb6d`. `scripts/build-martin-pgo.sh` is the recipe; its record (commit, version, binary hash, `.comment`) is kept with the results.
- Every competitor runs its latest stable release: VersaTiles 5.4.1, tileserver-gl-light 5.7.0 and ldproxy 4.8.2 are new; the rest are the releases rc81a4e44 ran, which are still their projects' latest. mbtileserver runs with GOMAXPROCS=4.
- The database image is pinned to the digest of the tag every run so far pulled (`imresamu/postgis:18-3.6`, last pushed 2026-02-09). The corpus is the September database volume (the copy saved for ADR 0004's rig on 2026-09-28) and both archives, unchanged.
- The rig is c7g.metal (64 Graviton3 cores, bare metal) in us-east-1, the instance type the kv-stores rig runs its engines on, launched from ADR 0004's stack. Each family runs on its own host, both at the same time. The PostGIS host builds Martin 2.0 and the archive host loads that image, so both families measure one binary.
- Within a host, ADR 0005 holds unchanged: two passes, the second in mirrored order, thousand-source runs included. The host runs nothing else, so the Mac's quiet-host gate (`scripts/run-gated.sh`) gives way to the harness's own quiet check before each candidate. Each host first runs its family's smoke protocol and starts the measured passes only if no smoke step recorded a failure.
- The verdict rule is unchanged: ADR 0001 as amended by 0005, 0007, 0008 and 0009.

## Consequences

- Absolute numbers are not comparable with the M2 Max runs. Every comparison the verdict makes stays inside one family, so inside one host.
- The page names the rig and says that the two families ran on two hosts of the same type.
- A run costs two c7g.metal hosts for four to five hours each.
- If 2.0.0-beta.5 or 2.0.0 ships from different code, or its official image differs from this build, ADR 0003's rule applies: the page is re-run against the published image before publication.
