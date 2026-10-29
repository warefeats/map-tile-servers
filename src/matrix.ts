import { childTiles, type TileCoord } from "./tiles";

/**
 * Two families share one rig: servers that cut tiles from PostGIS per request, and servers that
 * hand out tiles from a pre-built archive. Martin is the one server in both.
 */
export type Family = "postgis" | "archive";
export type Archive = "pmtiles" | "mbtiles";

export interface Candidate {
  id: string;
  family: Family;
  /** The server behind the candidate; two candidates with the same server differ by version or archive. */
  server: string;
  /** Display name, as it appears on the site. */
  name: string;
  version: string;
  /** Docker image reference the compose file runs. */
  image: string;
  /** Where the image came from, when it is not the project's own published tag. */
  provenance?: string;
  homepage: string;
  color: string;
  archive?: Archive;
  /** Port the server listens on inside its container. */
  port: number;
  /** Tile path for `layer` at z/x/y (archive servers ignore the layer: one tileset, every layer). */
  tilePath: (layer: string, tile: TileCoord) => string;
  /** A reference measurement, not a server (docs/adr/0007): measured like a candidate, never ranked or shown as one. */
  control?: boolean;
}

export const MARTIN_2 = { version: "2.0.0-beta.5", image: process.env.WF_MARTIN_2_IMAGE ?? "wf-martin:2.0.0-beta.5-722fb6d" } as const;
export const MARTIN_2_PROVENANCE =
  "maplibre/martin release PR #3776 at 722fb6d1 (2.0.0-beta.5, not yet released), built the way Martin's release builds its arm64 Docker binary (profile-guided, trained by the recipe's own bench-http run) on rustc 1.99.1 and packaged with that commit's .github/files/multi-platform.Dockerfile (docs/adr/0010)";
export const MARTIN_1 = { version: "1.16.1", image: "ghcr.io/maplibre/martin:1.16.1" } as const;

/** nginx 1.30.4, `nginx:stable` of 2026-08-25, pinned by digest: the archive family's floor control (docs/adr/0007). */
export const FLOOR_IMAGE = "nginx@sha256:09cc2702709e6388d979d8030e3ab4eb1ceb699b2dced26d7543e872a822e823";

const martinPath = (layer: string, t: TileCoord) => `/${layer}/${t.z}/${t.x}/${t.y}`;
const archiveTileset = "berlin";

export const CANDIDATES: readonly Candidate[] = [
  // PostGIS family. Martin 2.0.0 first and 1.16.1 second, so the version pair runs back to back.
  { id: "martin-2", family: "postgis", server: "martin", name: `Martin ${MARTIN_2.version}`, ...MARTIN_2, provenance: MARTIN_2_PROVENANCE, homepage: "https://martin.maplibre.org", color: "#1D4ED8", port: 3000, tilePath: martinPath },
  { id: "martin-1", family: "postgis", server: "martin", name: "Martin 1.16.1", ...MARTIN_1, homepage: "https://martin.maplibre.org", color: "#93C5FD", port: 3000, tilePath: martinPath },
  { id: "tegola", family: "postgis", server: "tegola", name: "Tegola", version: "0.21.2", image: "gospatial/tegola:v0.21.2", homepage: "https://tegola.io", color: "#16A34A", port: 8080, tilePath: (l, t) => `/maps/bench/${l}/${t.z}/${t.x}/${t.y}.pbf` },
  { id: "bbox", family: "postgis", server: "bbox", name: "BBOX", version: "0.6.2", image: "wf-bbox:0.6.2", provenance: "built from bbox-services/bbox@v0.6.2 (the published image is amd64-only)", homepage: "https://www.bbox.earth", color: "#9333EA", port: 8080, tilePath: (l, t) => `/xyz/${l}/${t.z}/${t.x}/${t.y}.mvt` },
  { id: "pg-tileserv", family: "postgis", server: "pg-tileserv", name: "pg_tileserv", version: "20250131", image: "pramsey/pg_tileserv:20250131", homepage: "https://github.com/CrunchyData/pg_tileserv", color: "#0891B2", port: 7800, tilePath: (l, t) => `/bench.${l}/${t.z}/${t.x}/${t.y}.pbf` },
  { id: "tipg", family: "postgis", server: "tipg", name: "TiPg", version: "1.6.1", image: "ghcr.io/developmentseed/tipg:1.6.1", homepage: "https://developmentseed.org/tipg/", color: "#EA580C", port: 8080, tilePath: (l, t) => `/collections/bench.${l}/tiles/WebMercatorQuad/${t.z}/${t.x}/${t.y}` },
  // OGC API Tiles addresses tiles as tileMatrix/tileRow/tileCol, i.e. z/y/x.
  { id: "ldproxy", family: "postgis", server: "ldproxy", name: "ldproxy", version: "4.8.2", image: "iide/ldproxy:4.8.2", homepage: "https://www.ldproxy.net", color: "#DC2626", port: 7080, tilePath: (l, t) => `/bench/collections/${l}/tiles/WebMercatorQuad/${t.z}/${t.y}/${t.x}` },
  { id: "ldproxy-pgis", family: "postgis", server: "ldproxy", name: "ldproxy (PGIS_TILES)", version: "4.8.2", image: "iide/ldproxy:4.8.2", homepage: "https://www.ldproxy.net", color: "#A16207", port: 7080, tilePath: (l, t) => `/bench/collections/${l}/tiles/WebMercatorQuad/${t.z}/${t.y}/${t.x}` },

  // Archive family. The floor control comes first, so the reverse pass measures it last (docs/adr/0005, 0007).
  { id: "floor", family: "archive", server: "floor", name: "Floor (nginx serving the tiles as files)", version: "1.30.4", image: FLOOR_IMAGE, provenance: "nginx:stable of 2026-08-25 (nginx 1.30.4) run directly, serving the archive's stored tile bytes as files from a Docker volume", homepage: "https://nginx.org", color: "#94A3B8", port: 8080, tilePath: (_, t) => `/tiles/${archiveTileset}/${t.z}/${t.x}/${t.y}`, control: true },
  { id: "martin-2-pmtiles", family: "archive", server: "martin", name: `Martin ${MARTIN_2.version} (PMTiles)`, ...MARTIN_2, provenance: MARTIN_2_PROVENANCE, homepage: "https://martin.maplibre.org", color: "#1D4ED8", archive: "pmtiles", port: 3000, tilePath: (_, t) => `/${archiveTileset}/${t.z}/${t.x}/${t.y}` },
  { id: "martin-1-pmtiles", family: "archive", server: "martin", name: "Martin 1.16.1 (PMTiles)", ...MARTIN_1, homepage: "https://martin.maplibre.org", color: "#93C5FD", archive: "pmtiles", port: 3000, tilePath: (_, t) => `/${archiveTileset}/${t.z}/${t.x}/${t.y}` },
  { id: "martin-2-mbtiles", family: "archive", server: "martin", name: `Martin ${MARTIN_2.version} (MBTiles)`, ...MARTIN_2, provenance: MARTIN_2_PROVENANCE, homepage: "https://martin.maplibre.org", color: "#3B82F6", archive: "mbtiles", port: 3000, tilePath: (_, t) => `/${archiveTileset}/${t.z}/${t.x}/${t.y}` },
  { id: "martin-1-mbtiles", family: "archive", server: "martin", name: "Martin 1.16.1 (MBTiles)", ...MARTIN_1, homepage: "https://martin.maplibre.org", color: "#BFDBFE", archive: "mbtiles", port: 3000, tilePath: (_, t) => `/${archiveTileset}/${t.z}/${t.x}/${t.y}` },
  { id: "go-pmtiles", family: "archive", server: "go-pmtiles", name: "go-pmtiles", version: "1.31.2", image: "protomaps/go-pmtiles:v1.31.2", homepage: "https://docs.protomaps.com/deploy/server", color: "#16A34A", archive: "pmtiles", port: 8080, tilePath: (_, t) => `/${archiveTileset}/${t.z}/${t.x}/${t.y}.mvt` },
  { id: "versatiles-pmtiles", family: "archive", server: "versatiles", name: "VersaTiles (PMTiles)", version: "5.4.1", image: "versatiles/versatiles:v5.4.1", homepage: "https://versatiles.org", color: "#0D9488", archive: "pmtiles", port: 8080, tilePath: (_, t) => `/tiles/${archiveTileset}/${t.z}/${t.x}/${t.y}` },
  { id: "versatiles-mbtiles", family: "archive", server: "versatiles", name: "VersaTiles (MBTiles)", version: "5.4.1", image: "versatiles/versatiles:v5.4.1", homepage: "https://versatiles.org", color: "#5EEAD4", archive: "mbtiles", port: 8080, tilePath: (_, t) => `/tiles/${archiveTileset}/${t.z}/${t.x}/${t.y}` },
  { id: "bbox-pmtiles", family: "archive", server: "bbox", name: "BBOX (PMTiles)", version: "0.6.2", image: "wf-bbox:0.6.2", provenance: "built from bbox-services/bbox@v0.6.2 (the published image is amd64-only)", homepage: "https://www.bbox.earth", color: "#9333EA", archive: "pmtiles", port: 8080, tilePath: (_, t) => `/xyz/${archiveTileset}/${t.z}/${t.x}/${t.y}.mvt` },
  { id: "bbox-mbtiles", family: "archive", server: "bbox", name: "BBOX (MBTiles)", version: "0.6.2", image: "wf-bbox:0.6.2", provenance: "built from bbox-services/bbox@v0.6.2 (the published image is amd64-only)", homepage: "https://www.bbox.earth", color: "#C084FC", archive: "mbtiles", port: 8080, tilePath: (_, t) => `/xyz/${archiveTileset}/${t.z}/${t.x}/${t.y}.mvt` },
  { id: "mbtileserver", family: "archive", server: "mbtileserver", name: "mbtileserver", version: "0.11.0", image: "wf-mbtileserver:0.11.0", provenance: "the consbio/mbtileserver v0.11.0 linux_arm64 release binary on debian:bookworm-slim (no arm64 image is published)", homepage: "https://github.com/consbio/mbtileserver", color: "#64748B", archive: "mbtiles", port: 8000, tilePath: (_, t) => `/services/${archiveTileset}/tiles/${t.z}/${t.x}/${t.y}.pbf` },
  { id: "tileserver-gl", family: "archive", server: "tileserver-gl", name: "tileserver-gl-light", version: "5.7.0", image: "maptiler/tileserver-gl-light:v5.7.0", homepage: "https://tileserver.readthedocs.io", color: "#EA580C", archive: "mbtiles", port: 8080, tilePath: (_, t) => `/data/${archiveTileset}/${t.z}/${t.x}/${t.y}.pbf` },
];

export function candidate(id: string): Candidate {
  const found = CANDIDATES.find((c) => c.id === id);
  if (!found) throw new Error(`unknown candidate ${id}; known: ${CANDIDATES.map((c) => c.id).join(", ")}`);
  return found;
}

export function isMartin2(c: Candidate): boolean {
  return c.server === "martin" && c.version === MARTIN_2.version;
}

/** A rival is any ranked candidate that is not Martin (docs/adr/0008). */
export function isRival(c: Candidate): boolean {
  return c.server !== "martin" && !c.control;
}

/**
 * Request headers per family. PostGIS tiles are requested without Accept-Encoding, as the 2024
 * thesis did, so the numbers are tile generation and not gzip; the previously published PostGIS
 * page did the same. Archive tiles are stored gzip-compressed and every map client accepts gzip,
 * so archive requests accept it and a server can pass the stored bytes through.
 */
export const REQUEST_HEADERS: Record<Family, Readonly<Record<string, string>>> = {
  postgis: { Accept: "application/vnd.mapbox-vector-tile" },
  archive: { Accept: "application/vnd.mapbox-vector-tile", "Accept-Encoding": "gzip" },
};

/** What a current Chrome sends; recorded per server (encoding chosen, bytes, time), never ranked. */
export const BROWSER_ACCEPT_ENCODING = "gzip, deflate, br, zstd";

export interface TileSpec {
  id: string;
  layer: string;
  tile: TileCoord;
  title: string;
  description: string;
}

/**
 * Prenzlauer Berg, Berlin (Helmholtzplatz / Kollwitzplatz): a dense 19th-century block grid with
 * about 2,000 buildings, 2,500 road segments and 2,800 POIs in one z14 tile; in the OpenMapTiles
 * archive the same tile carries 8,031 features in 12 layers.
 */
export const MARQUEE: TileCoord = { z: 14, x: 8802, y: 5371 };

export const TILES: Record<Family, readonly TileSpec[]> = {
  postgis: [
    { id: "buildings-z14", layer: "buildings", tile: MARQUEE, title: "Buildings z14", description: "Every building footprint in a 1.5 km Prenzlauer Berg tile (about 2,000 polygons)." },
    { id: "roads-z14", layer: "roads", tile: MARQUEE, title: "Roads z14", description: "Every highway=* way in the same tile (about 2,500 lines)." },
    { id: "pois-z14", layer: "pois", tile: MARQUEE, title: "Points z14", description: "Amenity, shop and tourism nodes in the same tile (about 2,800 points)." },
    { id: "boundaries-z9", layer: "boundaries", tile: { z: 9, x: 275, y: 167 }, title: "Boundaries z9", description: "The administrative boundary polygons covering most of Berlin." },
  ],
  archive: [
    { id: "city-z14", layer: archiveTileset, tile: MARQUEE, title: "Street level z14", description: "8,031 features in 12 OpenMapTiles layers; 242,407 bytes gzipped." },
    { id: "district-z12", layer: archiveTileset, tile: { z: 12, x: 2200, y: 1342 }, title: "District z12", description: "Prenzlauer Berg and Mitte, buildings dropped: 2,541 features." },
    { id: "region-z9", layer: archiveTileset, tile: { z: 9, x: 275, y: 167 }, title: "Region z9", description: "Most of Berlin: boundaries, major roads, water, place names." },
    { id: "country-z5", layer: archiveTileset, tile: { z: 5, x: 17, y: 10 }, title: "Overview z5", description: "The extract's footprint in one tile: 8 features." },
  ],
};

/** Four tiles fetched in parallel. PostGIS: the marquee's z15 children; archive: the marquee and its E, S, SE neighbours (the archive stops at z14). */
export const VIEWPORT: Record<Family, { layer: string; tiles: TileCoord[] }> = {
  postgis: { layer: "buildings", tiles: childTiles(MARQUEE) },
  archive: {
    layer: archiveTileset,
    tiles: [MARQUEE, { ...MARQUEE, x: MARQUEE.x + 1 }, { ...MARQUEE, y: MARQUEE.y + 1 }, { ...MARQUEE, x: MARQUEE.x + 1, y: MARQUEE.y + 1 }],
  },
};

/** 16 x 16 z14 tiles of central Berlin, every one present in the archive (BBOX answers a missing archive tile with 500). */
export const WALK = { z: 14, x: { min: 8794, max: 8809 }, y: { min: 5366, max: 5381 } } as const;

/** The walk's tiles for one candidate, in a fixed LCG shuffle; oha picks one per request. PostGIS walks the buildings layer. */
export function walkPaths(c: Candidate): string[] {
  const layer = c.family === "postgis" ? "buildings" : archiveTileset;
  const paths: string[] = [];
  for (let x = WALK.x.min; x <= WALK.x.max; x++) for (let y = WALK.y.min; y <= WALK.y.max; y++) paths.push(c.tilePath(layer, { z: WALK.z, x, y }));
  let seed = 20260908;
  for (let i = paths.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [paths[i], paths[j]] = [paths[j]!, paths[i]!];
  }
  return paths;
}

/**
 * Open-loop offered loads for the latency-under-load ladder, in tiles per second over the walk.
 * A candidate stops climbing at the first step it cannot hold: p99 over the SLO, errors, or less
 * than 95% of the offered rate delivered.
 */
export const LADDER: Record<Family, { rates: number[]; sloMs: number; budgetMs: number }> = {
  postgis: { rates: [25, 50, 100, 200, 400, 600, 800, 1000, 1200, 1500, 2000], sloMs: 500, budgetMs: 20 },
  archive: { rates: [1000, 2000, 4000, 8000, 16000, 24000, 32000, 48000, 64000, 96000, 128000], sloMs: 50, budgetMs: 2 },
};

/**
 * Connections for one ladder step: enough to carry the offered rate at `budgetMs` per request,
 * 16 at least and 256 at most. Sized to the rate so no connection sits idle long enough to race a
 * server's keep-alive timeout (200 idle connections at 100/s did, as transport errors).
 */
export function ladderConnections(family: Family, rate: number): number {
  return Math.min(256, Math.max(16, Math.ceil((rate * LADDER[family].budgetMs) / 1000)));
}

export interface Protocol {
  /** `warmups` starts run first and are not recorded (docs/adr/0005). */
  coldStart: { warmups: number; reps: number; timeoutMs: number };
  single: { warmupPasses: number; passes: number; requestsPerPass: number };
  burst: { warmups: number; reps: number };
  concurrency: { levels: readonly number[]; warmupSeconds: number; passes: number; passSeconds: number };
  walk: { connections: number; warmupSeconds: number; passes: number; passSeconds: number };
  ladder: { warmupSeconds: number; stepSeconds: number };
  session: { users: readonly number[]; rounds: number };
  catalog: { warmups: number; reps: number; timeoutMs: number };
  requestTimeoutSeconds: number;
}

/**
 * The previously published protocol plus the new sections. PostGIS single-tile passes were 5 requests,
 * archive 20. Cold starts: one unrecorded warm-up, then ten recorded (docs/adr/0005).
 */
export function protocol(family: Family, smoke: boolean): Protocol {
  if (smoke) {
    return {
      coldStart: { warmups: 0, reps: 1, timeoutMs: 300_000 },
      single: { warmupPasses: 1, passes: 3, requestsPerPass: 3 },
      burst: { warmups: 1, reps: 3 },
      concurrency: { levels: [10], warmupSeconds: 2, passes: 2, passSeconds: 3 },
      walk: { connections: 10, warmupSeconds: 2, passes: 2, passSeconds: 3 },
      ladder: { warmupSeconds: 1, stepSeconds: 3 },
      session: { users: [1, 10], rounds: 1 },
      catalog: { warmups: 0, reps: 1, timeoutMs: 600_000 },
      requestTimeoutSeconds: 60,
    };
  }
  return {
    coldStart: { warmups: 1, reps: 10, timeoutMs: 300_000 },
    single: { warmupPasses: 3, passes: 20, requestsPerPass: family === "postgis" ? 5 : 20 },
    burst: { warmups: 3, reps: 20 },
    concurrency: { levels: [10, 100], warmupSeconds: 10, passes: 8, passSeconds: 12 },
    walk: { connections: 10, warmupSeconds: 10, passes: 8, passSeconds: 12 },
    ladder: { warmupSeconds: 3, stepSeconds: 12 },
    session: { users: [1, 10], rounds: 3 },
    catalog: { warmups: 1, reps: 10, timeoutMs: 600_000 },
    requestTimeoutSeconds: 60,
  };
}

/** Engines answer on the shared Docker network under their compose service name; one engine runs at a time. */
export function engineOrigin(c: Candidate): string {
  return `http://engine:${c.port}`;
}

export function tileUrl(c: Candidate, layer: string, tile: TileCoord): string {
  return engineOrigin(c) + c.tilePath(layer, tile);
}
