# Martin 2.0 against 1.16.1 and every competitor

The runner behind a warefeats page (slug `martin-2-tile-servers`, unpublished) that measures [Martin](https://martin.maplibre.org) 2.0, not yet released (the head of its release PR, 2.0.0-beta.5), against its most recent stable release (1.16.1) and against the most recent stable release of every server it competes with, in both of the jobs Martin does: cutting vector tiles from PostGIS on every request, and handing tiles out of a pre-built MBTiles or PMTiles archive. It repeats everything the two September tile-server pages measured ([postgis-vector-tile-servers](https://warefeats.com/benchmarks/postgis-vector-tile-servers/), [pmtiles-mbtiles-tile-servers](https://warefeats.com/benchmarks/pmtiles-mbtiles-tile-servers/)) and adds four dimensions they did not: CPU paid per tile, capacity within a latency SLO under open-loop load, a simulated busy map, and startup with a thousand sources configured.

Part of the [warefeats](https://warefeats.com) benchmark suite. Decisions are recorded in `docs/adr/`: the verdict rule was fixed before the first measured pass (0001), the load generator sits on the engine's Docker network because the host path has a ceiling of its own (0002), Martin 2.0 is a local build with the release recipe because the release PR's CI artifacts are debug builds (0003), a dedicated cloud host was proposed and not adopted (0004), cold starts get a warm-up and ten repetitions and every run has a second pass in reverse order (0005), the measured build is the release PR's head (0006), archive times are ranked above the harness floor (0007), and each category ends as won, tied or lost, with database-bound ties and archive memory allowed when the page is published (0008), and the four PostGIS categories that sit at the database's own cap are shown as context rather than ranked (0009). Since the Mac was sold, runs happen on dedicated c7g.metal hosts, one per family, dispatched from GitHub Actions like the kv-stores rig, with Martin 2.0 built the way its release builds the arm64 image, profile-guided (0010).

## Candidates

PostGIS family, all reading the same four tables through the same read-only role and an eight-connection pool:

| Candidate | Version | Image |
|-----------|---------|-------|
| Martin | 2.0.0-beta.5 (release PR maplibre/martin#3838 at `d176c39c`) | `wf-martin:2.0.0-beta.5-d176c39`, built on the rig with the release's profile-guided recipe (ADR 0010) |
| Martin | 1.16.1 | `ghcr.io/maplibre/martin:1.16.1` |
| Tegola | 0.21.2 | `gospatial/tegola:v0.21.2` |
| BBOX | 0.6.2 | `wf-bbox:0.6.2`, built from `bbox-services/bbox@v0.6.2` (the published image is amd64-only) |
| pg_tileserv | 2025-01-31 build | `pramsey/pg_tileserv:20250131` (no image exists for v1.0.11) |
| TiPg | 1.6.1 | `ghcr.io/developmentseed/tipg:1.6.1` |
| ldproxy | 4.8.2, as shipped and with `PGIS_TILES` | `iide/ldproxy:4.8.2` |

Archive family, one Planetiler build of Berlin stored as MBTiles and, converted losslessly, as PMTiles:

| Candidate | Version | Archive | Image |
|-----------|---------|---------|-------|
| Martin | 2.0.0-beta.5 and 1.16.1 | PMTiles and MBTiles | as above |
| go-pmtiles | 1.31.2 | PMTiles | `protomaps/go-pmtiles:v1.31.2` |
| VersaTiles | 5.4.1 | PMTiles and MBTiles | `versatiles/versatiles:v5.4.1` |
| BBOX | 0.6.2 | PMTiles and MBTiles | `wf-bbox:0.6.2` |
| mbtileserver | 0.11.0 | MBTiles | `wf-mbtileserver:0.11.0`, the release binary on Debian (no arm64 image) |
| tileserver-gl-light | 5.7.0 | MBTiles | `maptiler/tileserver-gl-light:v5.7.0` |

VersaTiles is new since the September archive page. Every other competitor's most recent stable release is the one those pages ran, except TiPg (1.5.0 then, 1.6.1 now), ldproxy (4.8.1 then, 4.8.2 now) and tileserver-gl-light (5.6.0 then, 5.7.0 now).

## Corpus

The Geofabrik Berlin extract of 2026-01-01 (MD5 `6d6de8da2d8192c5bbe7dd00e1004c82`), the same file both September pages used. PostGIS: the published run's database volume, copied (`m2-dbdata`), so the four tables are byte-for-byte what those numbers came from: 535,572 buildings, 451,317 roads, 141,188 POIs, 122 boundaries, PostgreSQL 18.1 with PostGIS 3.6.1. Archives: the published run's Planetiler 0.10.2 OpenMapTiles build (`berlin.mbtiles`, 40.9 MB) and its `pmtiles convert` (`berlin.pmtiles`, 40.2 MB), identical tile bytes.

Map data © OpenStreetMap contributors, [ODbL](https://www.openstreetmap.org/copyright).

## What is measured

Per candidate, one engine container at a time (4 CPUs, 4 GB), in this order:

1. **Time to first tile**: process start to the first 200 for the marquee tile, one unrecorded warm-up start and then ten recorded; idle memory five seconds later.
2. **Parity**: every test tile fetched once and decoded; bytes, encoding, layers and feature counts on record. Also recorded, never ranked: the marquee tile under the other encoding (archive: no `Accept-Encoding`; PostGIS: gzip) and under a current Chrome's `Accept-Encoding: gzip, deflate, br, zstd`.
3. **Single tile**: one connection, 3 warmup and 20 measured passes per test tile (PostGIS 5 requests per pass, archive 20, as published).
4. **Viewport burst**: four adjacent tiles at once, 20 repetitions.
5. **Throughput**: 10 and 100 closed-loop clients on the marquee tile, and 10 clients over a 256-tile random walk; one 10 s warmup, eight 12 s passes each. Engine and database CPU is read from the cgroups before and after every pass.
6. **Memory after load**: anonymous memory (heap) and file-backed memory (mmapped archives, the executable) separately.
7. **Capacity within an SLO**: open-loop offered load over the walk (oha `-q` with coordinated-omission correction), stepped up until a step is not held: p99 over 500 ms (PostGIS) or 50 ms (archive), more than 0.1% errors, or under 95% of the rate delivered.
8. **Map session**: 1 and 10 simulated MapLibre users fly into Berlin and pan (a 1920×1080 viewport over 512 px tiles, a per-user tile cache, six keep-alive connections each, no think time); the first flight warms and is discarded, three are recorded.
9. **A thousand sources** (separate run, `src/catalog.ts`): the same cold start with 1,000 extra sources configured, a warm-up and ten recorded, then one tile from the last of them.

A measured run does all of that twice, the second time in reverse candidate order, and pools each candidate's samples from both passes (ADR 0005). The archive family also measures a control, `floor`: nginx serving the archive's stored tiles as plain files, which is the least work any archive server can do through this harness. It runs the time to first tile, single tile, burst, session and thousand-source sections, is never ranked, and archive times are ranked on how far each server sits above it (ADR 0007).

## Fairness configuration

- Tile caches off everywhere. PMTiles directory caches stay on at go-pmtiles' 64 MB default: they hold directory entries, not tiles, and are each server's normal operating mode. Martin gets `cache: { size_mb: 256, tile_size_mb: 0 }` and `pmtiles.directory_cache.size_mb: 64`; the September archive run's `cache: disable` also zeroed Martin's directory cache.
- PostGIS servers keep the September page's settings unchanged (same files, same eight-connection pool; BBOX hard-codes eight).
- PostGIS requests send no `Accept-Encoding` (as the 2024 thesis and the September page did); archive requests send `Accept-Encoding: gzip` (as every map client does).
- The PostgreSQL buffer cache is prewarmed before the first candidate.
- Every engine is limited to 4 CPUs and sizes its threads to match: Martin and the floor are configured for 4 workers, Tegola, pg_tileserv and mbtileserver run with `GOMAXPROCS=4` (their Go runtimes predate CPU-limit awareness), and the rest size their thread pools from the container's limit or serve from a single event loop.

## Running

```bash
bun install
just images           # build/tag the images the runner never pulls during a run (Martin 2.0: scripts/build-martin-pgo.sh, ADR 0010)
just gated rc81a4e44  # a measured run on the Mac: both families and catalogs, twice, each candidate behind a quiet-host gate
just verdict --run=rc81a4e44   # docs/adr/0001 as amended by 0005, 0007, 0008 and 0009, pooled over both passes
just bench archive    # one pass of the archive protocol → results-archive.json (diagnostics; --reverse for mirror order)
just catalog archive  # one pass of the 1,000-source cold starts → results-archive-catalog.json
just import           # runs/<date>-m2-max.json + benchmark.json (story words from story.json)
just preview          # render the unpublished page on the site's dev server
```

The runner waits before each candidate until the VM is quiet (under half a core busy over three seconds) and records host and VM load. `scripts/run-gated.sh` also waits for a 1-minute host load under 6 and measures a candidate again when other work on the Mac went over 4 cores during its slot. Never measure while anything compiles.

## Cloud rig

Measured runs happen on dedicated c7g.metal hosts in us-east-1 (ADR 0010; ADR 0004 built the rig), one per family at the same time, each running its family's protocol unchanged: both passes, catalog included. GitHub Actions drives them the way kv-stores drives its rig (`.github/workflows/rig.yml`): it assumes an AWS role through OIDC, launches the hosts, starts `scripts/remote.sh` on each over SSM, prints each host's log as the run goes, and keeps the results as artifacts. The first dispatch's PostGIS host builds Martin 2.0 with the release's profile-guided recipe (`scripts/build-martin-pgo.sh`) and leaves the image in the rig's bucket, where the archive host and every later dispatch load it, so both families measure one binary. The inputs every run names (the helper images, the database volume and both archives) are pinned by a hash of their bytes in `scripts/rig-inputs.txt`.

Once, with AWS credentials:

```bash
just rig-deploy       # the stack: launch template, bucket, instance role
just setup-oidc       # the role the workflow assumes, stored as the repo's AWS_ROLE_ARN secret
just rig-inputs       # upload the pinned inputs (IMAGES and DBDATA name the saved copies, by default in .work/rig/c17/)
```

Then per run, with nothing but `gh`:

```bash
just rig-walk         # offline preflight: scripts, the workflow, user data, the SSM command, images, inputs
just rig-cloud smoke  # each family's smoke; read its results before measuring
just rig-cloud full   # both passes on both hosts, then the verdict
just rig-watch        # follow the latest dispatch
just rig-fetch <id>   # a dispatch's artifacts: results and the verdict into the repo, logs and the build record in .work/rig/gh-<id>/
```

A full family run takes four to five hours, and GitHub ends a hosted job at six. A host that outlives its job keeps running, uploads its results and terminates itself; `just rig-cloud collect both -f run_id=<run>` then gathers and scores them. A full dispatch refuses a run id that already has measured results. Every host terminates itself when its run ends and after ten hours at most.

## License

MIT. Map data © OpenStreetMap contributors, ODbL.
