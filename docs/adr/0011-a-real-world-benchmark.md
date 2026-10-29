# 0011 — A real-world benchmark for map tile servers

Date: 2026-10-29. Status: proposed for John's review. Nothing is built from it until it is accepted.

## Context

Through run rcd176c39 the runner measured each server's request path cold. Tile caches were off and the other knobs were equalized: an 8-connection database pool everywhere and 4 workers. The Berlin corpus was small enough to stay in memory. PostGIS requests asked for no compression, and the 10- and 100-client tests hit a single hot tile. Every server ran in a 4-CPU quota container on one 64-core host, with the load generator on the same Docker network. On 2026-10-29 John judged it "not a useful real-world benchmark as designed". It answers which engine does the least work per tile. It does not answer which server an operator should deploy, or what that will cost.

Audits of every competitor's documentation on 2026-10-29 found three things:

- **A cache in front.** Each project's production guidance puts a caching proxy or a CDN in front of the server.
- **Defaults mostly kept.** Most servers ran on their documented defaults or on this runner's deliberate equalizations.
- **Departures that weren't deliberate:**
  - ldproxy's stock provider left on the count query its docs tell big datasets to turn off, and its pool sat at twice its recommended default.
  - TiPg's "8-connection pool" was four pools of 2.
  - Tegola gzipped and then un-gzipped every tile for requests without `Accept-Encoding`.
  - Per-request logging was on for some servers and off for others.
  - The provenance lines for BBOX and mbtileserver gave reasons that don't hold.
  - ldproxy's `initFailFast` key is from ldproxy 3, and 4.8.2 ignores it.

Martin's own reference configuration says good performance needs both directory and tile caching (a 256 MB tile cache by default), and its docs show a caching proxy in front. The runner ran Martin with its tile cache off and `auto_bounds: skip`.

Facts the design rests on, gathered on 2026-10-29, with sources in the runner's notes:

- **Archives at scale.** OpenFreeMap publishes a weekly planet in the OpenMapTiles schema, the schema of the Berlin corpus: MBTiles of 103 GB and PMTiles of 87 GB, under ODbL with the schema under CC-BY. Berlin's PMTiles has a single 2.4 KB root directory and no leaf directories, so it cannot show how servers handle a real archive.
- **Instances in us-east-1.**
  - c8g.xlarge (Graviton4, 4 cores, 8 GB) costs $0.1595/h, and c8i.xlarge (x86, 4 vCPUs) costs $0.1874/h.
  - At this size the network sustains about 1.9 Gbps. Burst credits allow up to 12.5 Gbps for 5–60 minutes, and every instance starts with full credits.
  - gp3 EBS defaults to 3,000 IOPS and 125 MB/s.
  - Data sent to the internet costs $0.09/GB.
- **OSM's tile request logs for 2026-10-28.** These cover OSMF's standard raster layer, counted at Fastly's edge.
  - There were 4.66 billion successful requests.
  - The listing names tiles with 10 or more requests from 3 or more IPs. Those 36.5 million tiles carry 84.75% of the requests, and 15.25% falls on tiles the listing leaves out.
  - 7.10% of requests were logged as CDN misses.
  - Moved one zoom down to vector tiles, zooms 0–14 carry 70% of the listed requests.
- **The landscape.**
  - Maintained servers in the set: Martin, go-pmtiles, VersaTiles, tileserver-gl-light, TiPg and ldproxy.
  - Unmaintained servers still in the set: BBOX (no commit since 2025-10), mbtileserver (since 2025-05) and pg_tileserv (since 2025-12).
  - Widely used setups missing from it: PMTiles read by the browser from object storage (the `pmtiles` npm package has about 5 million downloads a month), PMTiles on Lambda or Workers, Martin on Lambda, and static tile files behind nginx.
- **The rig.** On a 64-core host a 4-CPU quota throttles thread-heavy servers. With 1,000 MBTiles sources Martin runs about 2,000 sqlx threads, and its startup there took 6–8 times as long as on the Mac.

## Decision

### What the benchmark is for

- The headline answers an operator's question: which tile server to deploy for a map, and what it will cost. Today's runner continues underneath as a diagnostic lane for Martin's own work, under ADRs 0001–0010.
- Every lane is published whatever the result, and the page discloses John's contributions to Martin. ADR 0001's publish condition and ADR 0008's gate apply only to the diagnostic lane.
- The scope is everything Martin serves. The lanes are built and published one at a time, each as its own post, in this order:
  1. vector tiles from archives;
  2. vector tiles from PostGIS;
  3. raster from COG;
  4. style rendering;
  5. fonts, sprites and styles.

  Each later lane gets its own design ADR before anything is built.
- The new benchmark replaces the unpublished martin-2 story. The September `vector-tile-servers` and `archive-tile-servers` pages stay as they are, with a note pointing here.

### The archive lane

- **Data.** Berlin, plus OpenFreeMap's planet as MBTiles and as PMTiles, pinned to one weekly build. On an 8 GB instance the planet does not fit in memory, which is what an operator faces too.
- **Servers.** One entry per server, measured on every archive format it supports:
  - Martin, VersaTiles, BBOX and tileserver-gl-light on PMTiles and on MBTiles;
  - go-pmtiles on PMTiles;
  - mbtileserver on MBTiles;
  - static tile files behind nginx.

  Martin appears as 1.16.1, the stable release, and as the newest published 2.0 beta, labelled a pre-release; 2.0.0 replaces the beta when it ships. BBOX and mbtileserver are marked unmaintained. Every server runs as the image or binary its project tells users to install, at its latest release, configured as its docs recommend for production.
- **Two scenarios, reported separately.**
  - **Server alone:** each server takes the whole replay with its own cache on.
  - **Behind a CDN:** the server receives only what a CDN would pass on. The modelled CDN holds the most popular tiles until 92.9% of the replay's requests hit it, so the origin gets the least popular 7.1%, the share OSM's CDN measured.

  The CDN scenario also measures the serverless setups:
  - PMTiles read by the browser from S3 through CloudFront;
  - PMTiles on Lambda behind CloudFront;
  - Martin on Lambda behind CloudFront, shown under Martin.

  They run at modest volume, for latency and per-request resource use, and their cost comes from AWS list prices; pushing terabytes through CloudFront would exceed the budget. Cloudflare setups may follow later.
- **Traffic.**
  - **Replay.** OSM's counts for 2026-10-28, moved one zoom down to vector tiles as Planetiler's top-osm-tiles does, with 2026-10-02 as a cross-check. Demand at zoom 15 and above folds into the zoom-14 parent tiles a vector map fetches. Berlin runs use the tiles that touch Berlin's box.
  - **The unlisted 15.25%.** It is spread over the archive's unlisted tiles, weighted toward the zooms that have more of them, at no more than 9 requests per tile per day.
  - **Simulated map users.** They start where real users look, sampled from the same counts, move with think time between views, and run as 10 and as 100 users, each over HTTP/1.1 with 6 connections.
  - **Encoding.** Every request carries a browser's `Accept-Encoding`.
- **Hardware.** Each server runs alone on a c8g.xlarge (Graviton4) and on a c8i.xlarge (x86), both 4 vCPUs with gp3 storage at its defaults. The load generator runs on a separate network-optimized instance in the same availability zone and cluster placement group. Traffic is plain HTTP; TLS ends at a CDN or proxy at the same cost for every server, and the page says so.
- **Measurement.**
  - Capacity and cost are measured in a warm steady state, after a warm-up replay of fixed length. A just-started server's first map view and first tile are reported separately.
  - Capacity is the highest offered load held with p99 within 50 ms, fewer than 0.1% errors and at least 95% of the rate delivered. It is then capped at what the sustained network rate carries: bytes per tile against about 1.9 Gbps. The page names the servers that hit that ceiling, and the instances' own network-allowance counters confirm it.
  - Every candidate runs three passes, each on fresh instances, one after another. The confidence intervals span the three instance pairs. Where the account's vCPU quota is too small, a pass runs in waves.
- **Result.**
  - **The headline:** dollars per million tiles, as an operator pays at AWS list prices. That is instance time at the measured capacity, plus storage, plus data sent to the internet, with each part shown.
  - **Ranking:** one per format, PMTiles and MBTiles, for each scenario and architecture. Each server is shown once, its measurements side by side. A difference counts only when the 95% confidence intervals do not overlap; otherwise it is a tie.
  - **Reported but not ranked:** p99 latency, the view load time users see, memory, cold start, and startup with 1,000 sources.
- **Budget.** A full run may use up to $50 and 3 hours; the estimate for this design is about $20 and 2 hours. A smoke may use up to $10 and 30 minutes, and data costs up to $100 once.

### The diagnostic lane

After run rcd176c39 finishes, the diagnostic lane changes:

- every server's per-request log is quiet;
- each engine is pinned to 4 dedicated cores instead of a 4-CPU quota;
- every server that has a switch skips computing extents at startup: Martin `auto_bounds: skip`, TiPg `SPATIAL_EXTENT=false`, ldproxy `spatialComputed: false` and `temporalComputed: false`;
- PostGIS requests send `Accept-Encoding: gzip`;
- every server gets the performance settings its own docs explicitly recommend, within the equalizations the comparison needs (CPU, memory, an 8-connection ceiling), each recorded in the README.

The mistakes the audits found are fixed at the same time. The diagnostic lane then re-measures only when a Martin release or a Martin session needs it.

## Consequences

- The cloud rig carries over: the workflow, the OIDC role, the stack and the bundled inputs. It needs:
  - new instance types and a client instance;
  - scheduling across many instances;
  - a replay generator built from OSM's logs;
  - the CDN-miss model;
  - a cost calculator.

  The stack change is an infrastructure deploy that John runs.
- Results depend on AWS list prices on the day of a run, and the page dates them. Internet egress outweighs instance time by far, so wherever servers send different bytes for the same tile, compression weighs more than CPU in the total.
- The replay is a model. It rests on one day of OSM's raster-layer logs moved to vector tiles, with a modelled tail and a modelled CDN, and the page says so.
- The serverless setups scale on demand, so their capacity is not measured: only their latency and their cost per million tiles.
- Running every candidate at once may need more on-demand vCPUs than the account allows. Then a pass runs in waves, or John asks AWS for a higher quota.
