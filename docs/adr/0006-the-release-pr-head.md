# 0006 — Martin 2.0 is the release PR's head

Date: 2026-10-08. Status: accepted before the measured pass.

## Context

ADR 0001 and ADR 0003 named Martin 2.0.0 at release PR maplibre/martin#3343, head `055d4eaa`. That PR closed unmerged. Release PR #3406 merged on 2026-09-29 and shipped 2.0.0 as a series of prereleases instead: 2.0.0-beta.0 (2026-09-29, no image), beta.1 (2026-09-30) and beta.2 (2026-10-01). On 2026-10-08 the open release PR, #3525, cuts beta.3, and 1.16.1 is still the latest stable release. The same day John asked to measure the release PR's head instead of waiting for a particular release, so the results can decide what to work on next.

## Decision

- Martin 2.0 is maplibre/martin #3525 at `81a4e444` (`martin` 2.0.0-beta.3): main at `e508209b` plus release-plz's version bump.
- ADR 0003's trap still holds: Martin's CI builds pull requests with `release_mode: github.event_name != 'pull_request'`, release PRs included, so the PR's own artifacts are debug builds.
- The build follows Martin's own release recipe (`just build-release`): `cargo build --release --target aarch64-unknown-linux-gnu --package martin --locked` with `-C strip=symbols` and the workspace's release profile (fat LTO, one codegen unit).
- The compiler is the one the latest official 2.0 binary reports in its `.comment` section: 2.0.0-beta.2 says rustc 1.99.0 (b940084d7 2026-09-28). The build runs on Ubuntu 24.04, the CI runner's OS.
- The binary is packaged with the commit's own `.github/files/multi-platform.Dockerfile` as `wf-martin:2.0.0-beta.3-81a4e44`.
- The version comparison stays against the official `ghcr.io/maplibre/martin:1.16.1` image.
- Everything ADR 0001 says about Martin 2.0.0 applies to this build.

The build locks actix-server 2.9.8 (the parallel worker start, through #3471), actix-router 0.5.4 and actix-web-prom 0.10.0. Unlike the int16 and int17 diagnostic builds, it carries no vendored dependency patches, so its startup and memory read the way a release from this commit would.

## Consequences

- The page names the commit it measured, not a release.
- If a release ships from different code, ADR 0003's rule applies: the page is re-run against that release's image before publication.
