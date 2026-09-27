# 0003 — Which Martin binaries are measured

Date: 2026-09-26. Status: accepted.

## Context

Martin 2.0.0 is not released. Its release PR (maplibre/martin#3343, head `055d4eaa`) has CI artifacts for `aarch64-unknown-linux-gnu`, and a first A/B against the official 1.16.1 image made 2.0.0 look three to four times slower on archive tiles (0.80 ms against 0.23 ms per 242 KB tile at one client). Martin's CI builds pull requests, the release PR included, with `release_mode: github.event_name != 'pull_request'`, so those artifacts are debug builds. The official images come from the `release` event, which builds with `--release` (fat LTO, one codegen unit).

## Decision

Both versions are built from source on the same toolchain the official 1.16.1 binary reports in its `.comment` section (rustc 1.98.1, 2026-09-01), with the release recipe's flags (`cargo build --release --target aarch64-unknown-linux-gnu --package martin --locked`, `-C strip=symbols`), on Ubuntu 24.04 (the CI runner's OS), and packaged with each tag's own `.github/files/multi-platform.Dockerfile`.

- `martin-2`: `wf-martin:2.0.0-055d4ea`, built from the release PR head.
- `martin-1`: the official `ghcr.io/maplibre/martin:1.16.1` image, what 1.16.1 users run.
- Control, not ranked: `wf-martin:1.16.1-local`, built from `martin-v1.16.1` with the same recipe as the 2.0.0 build.

## The control

Interleaved, two rounds, in-network oha, 4-CPU engine, archive configs from this repo:

| Binary | Archive | One client, marquee tile (p50) | Walk, 10 clients | Marquee, 100 clients |
|--------|---------|-------------------------------:|-----------------:|---------------------:|
| official 1.16.1 | PMTiles | 0.229 / 0.226 ms | 21,468 / 21,865/s | 18,218 / 17,822/s |
| local 1.16.1 | PMTiles | 0.241 / 0.274 ms | 21,743 / 22,120/s | 18,061 / 18,500/s |
| local 2.0.0 | PMTiles | 0.086 / 0.083 ms | 93,366 / 98,884/s | 53,161 / 54,018/s |
| official 1.16.1 | MBTiles | 0.251 / 0.245 ms | 21,394 / 22,410/s | 13,315 / 13,545/s |
| local 1.16.1 | MBTiles | 0.236 / 0.239 ms | 21,965 / 22,260/s | 13,503 / 13,568/s |
| local 2.0.0 | MBTiles | 0.153 / 0.182 ms | 31,363 / 31,583/s | 18,493 / 18,231/s |

The local 1.16.1 build is indistinguishable from the official image, so the local 2.0.0 build stands in for the official 2.0.0 image. The official 1.16.1 binary also carries rendering (a default feature until 2.0 moved it to `-full`) and statically linked ICU and image libraries; the local builds link those dynamically, and the control shows no effect on tile serving.

## Consequences

- If the published 2.0.0 image differs from this build, the page is re-run against it before publication.
- Anyone benchmarking Martin from pull-request artifacts is benchmarking a debug build.
