/**
 * The popularity replay of docs/adr/0011: OSM's daily tile request counts for its standard raster layer,
 * moved one zoom down to 512 px vector tiles (as Planetiler's top-osm-tiles does), with demand past the
 * archive's maxzoom folded into the tiles a vector map overzooms. Tiles the log leaves out (fewer than 10
 * requests or 3 IPs a day) get a modelled tail, and a modelled CDN keeps the most popular tiles so the
 * origin sees only the least popular share. The output is a seeded, weighted list of tiles: oha picks a
 * random line of its URL file for every request, so repeats in the list carry the popularity.
 */
import { lonLatToTile } from "./tiles";

/** The archives' maxzoom (OpenMapTiles); demand at deeper zooms lands on these tiles. */
export const MAX_ZOOM = 14;
/** At most this many tail requests per unlisted tile per day: the log lists every tile with 10 or more. */
export const MAX_TAIL_PER_TILE = 9;
/** OSM's standard layer on 2026-10-28: 711,374,272 of 4,663,255,500 successful requests fell on unlisted tiles. */
export const TAIL_SHARE = 711_374_272 / 4_663_255_500;
/** The same day's requests logged as CDN misses: 331,200,551 of 4,663,255,500. */
export const MISS_SHARE = 331_200_551 / 4_663_255_500;

export type Scenario = "alone" | "cdn";

export interface Region {
  name: string;
  /** [minLon, minLat, maxLon, maxLat]; the planet has none. */
  bbox?: [number, number, number, number];
}

export const PLANET: Region = { name: "planet" };
export const BERLIN: Region = { name: "berlin", bbox: [13.08, 52.33, 13.77, 52.68] };

interface Range {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const ranges = new Map<Region, Range[]>();

/** The tile ranges of a region at one zoom, inclusive: every tile whose extent touches the box. */
export function regionRange(region: Region, z: number): Range {
  let byZoom = ranges.get(region);
  if (!byZoom) {
    byZoom = Array.from({ length: MAX_ZOOM + 1 }, (_, zz) => {
      const n = 2 ** zz;
      if (!region.bbox) return { x0: 0, x1: n - 1, y0: 0, y1: n - 1 };
      const [minLon, minLat, maxLon, maxLat] = region.bbox;
      const nw = lonLatToTile(minLon, maxLat, zz);
      const se = lonLatToTile(maxLon, minLat, zz);
      return { x0: nw.x, x1: Math.min(se.x, n - 1), y0: nw.y, y1: Math.min(se.y, n - 1) };
    });
    ranges.set(region, byZoom);
  }
  return byZoom[z]!;
}

export function regionTileCount(region: Region, z: number): number {
  const r = regionRange(region, z);
  return (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1);
}

const key = (z: number, x: number, y: number) => x * 2 ** z + y;

/** A raster tile's vector tile one zoom down, folded to MAX_ZOOM; raster z0 has no parent and is dropped. */
export function vectorTileOf(z: number, x: number, y: number): { z: number; x: number; y: number } | null {
  if (z < 1) return null;
  let vz = z - 1;
  let vx = x >> 1;
  let vy = y >> 1;
  if (vz > MAX_ZOOM) {
    const shift = vz - MAX_ZOOM;
    vx = Math.floor(vx / 2 ** shift);
    vy = Math.floor(vy / 2 ** shift);
    vz = MAX_ZOOM;
  }
  return { z: vz, x: vx, y: vy };
}

/** Listed demand per vector tile, per zoom (key x·2^z + y), with what came from each source counted apart. */
export interface Listed {
  counts: Map<number, number>[];
  /** Requests whose raster zoom mapped straight to the vector zoom, and those folded in from deeper zooms. */
  direct: number[];
  folded: number[];
  /** Raster z0 requests, which have no vector parent. */
  dropped: number;
  lines: number;
}

export function emptyListed(): Listed {
  return { counts: Array.from({ length: MAX_ZOOM + 1 }, () => new Map()), direct: new Array(MAX_ZOOM + 1).fill(0), folded: new Array(MAX_ZOOM + 1).fill(0), dropped: 0, lines: 0 };
}

/** Add one `z/x/y count` line of OSM's tile log; tiles outside the region are skipped. */
export function addLine(listed: Listed, line: string, region: Region): void {
  const s1 = line.indexOf("/");
  const s2 = line.indexOf("/", s1 + 1);
  const sp = line.indexOf(" ", s2 + 1);
  if (s1 < 0 || s2 < 0 || sp < 0) return;
  const z = Number(line.slice(0, s1));
  const x = Number(line.slice(s1 + 1, s2));
  const y = Number(line.slice(s2 + 1, sp));
  const n = Number(line.slice(sp + 1));
  listed.lines++;
  const v = vectorTileOf(z, x, y);
  if (!v) {
    listed.dropped += n;
    return;
  }
  const r = regionRange(region, v.z);
  if (v.x < r.x0 || v.x > r.x1 || v.y < r.y0 || v.y > r.y1) return;
  const k = key(v.z, v.x, v.y);
  const m = listed.counts[v.z]!;
  m.set(k, (m.get(k) ?? 0) + n);
  if (z - 1 > MAX_ZOOM) listed.folded[v.z]! += n;
  else listed.direct[v.z]! += n;
}

export interface ZoomModel {
  z: number;
  listedTiles: number;
  listedRequests: number;
  unlistedTiles: number;
  tailRequests: number;
  /** Tail requests that a CDN passes on to the origin. */
  missTailRequests: number;
}

export interface Model {
  region: Region;
  zooms: ZoomModel[];
  listedRequests: number;
  tailRequests: number;
  /** The tail the shares asked for, before the per-tile cap. */
  tailWanted: number;
  totalRequests: number;
  missRequests: number;
  /** The least popular listed tiles that also miss (when the tail alone is smaller than the miss share). */
  missListed: { z: number; k: number; requests: number }[];
}

/**
 * The tail is TAIL_SHARE of all requests, spread over each zoom's unlisted tiles in proportion to how many
 * there are, at most MAX_TAIL_PER_TILE each. The CDN holds the most popular tiles until 1 - MISS_SHARE of
 * requests hit; every tail tile is less popular than every listed one, so misses come from the tail first.
 */
export function buildModel(listed: Listed, region: Region, tailShare = TAIL_SHARE, missShare = MISS_SHARE): Model {
  const zooms: ZoomModel[] = listed.counts.map((m, z) => {
    let requests = 0;
    for (const n of m.values()) requests += n;
    return { z, listedTiles: m.size, listedRequests: requests, unlistedTiles: Math.max(0, regionTileCount(region, z) - m.size), tailRequests: 0, missTailRequests: 0 };
  });
  const listedRequests = zooms.reduce((s, z) => s + z.listedRequests, 0);
  const tailWanted = (listedRequests * tailShare) / (1 - tailShare);
  const unlisted = zooms.reduce((s, z) => s + z.unlistedTiles, 0);
  for (const z of zooms) z.tailRequests = unlisted > 0 ? Math.min((tailWanted * z.unlistedTiles) / unlisted, MAX_TAIL_PER_TILE * z.unlistedTiles) : 0;
  const tailRequests = zooms.reduce((s, z) => s + z.tailRequests, 0);
  const totalRequests = listedRequests + tailRequests;

  // Misses: the tail first. Every tail tile is equally popular (the share and the cap are both per tile),
  // so each zoom passes on the same fraction of its tail; then the least requested listed tiles.
  let need = missShare * totalRequests;
  const fromTail = tailRequests > 0 ? Math.min(1, need / tailRequests) : 0;
  for (const z of zooms) z.missTailRequests = z.tailRequests * fromTail;
  need -= tailRequests * fromTail;
  const missListed: Model["missListed"] = [];
  if (need > 0) {
    const all: { z: number; k: number; requests: number }[] = [];
    listed.counts.forEach((m, z) => m.forEach((n, k) => all.push({ z, k, requests: n })));
    all.sort((a, b) => a.requests - b.requests);
    for (const t of all) {
      if (need <= 0) break;
      const take = Math.min(t.requests, need);
      missListed.push({ ...t, requests: take });
      need -= take;
    }
  }
  const missRequests = zooms.reduce((s, z) => s + z.missTailRequests, 0) + missListed.reduce((s, t) => s + t.requests, 0);
  return { region, zooms, listedRequests, tailRequests, tailWanted, totalRequests, missRequests, missListed };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Vose's alias method: O(1) draws from a discrete distribution. */
export function aliasTable(weights: ArrayLike<number>): (rand: () => number) => number {
  const n = weights.length;
  let total = 0;
  for (let i = 0; i < n; i++) total += weights[i]!;
  const prob = new Float64Array(n);
  const alias = new Int32Array(n);
  const small: number[] = [];
  const large: number[] = [];
  for (let i = 0; i < n; i++) {
    prob[i] = (weights[i]! * n) / total;
    (prob[i]! < 1 ? small : large).push(i);
  }
  while (small.length && large.length) {
    const s = small.pop()!;
    const l = large.pop()!;
    alias[s] = l;
    prob[l] = prob[l]! + prob[s]! - 1;
    (prob[l]! < 1 ? small : large).push(l);
  }
  for (const i of [...small, ...large]) prob[i] = 1;
  return (rand) => {
    const i = Math.floor(rand() * n);
    return rand() < prob[i]! ? i : alias[i]!;
  };
}

/**
 * Draws tiles for a scenario. Alone: listed tiles by their counts, plus the tail. CDN: only the misses.
 * A tail draw picks a zoom by its tail requests, then a uniformly random unlisted tile of the region at that
 * zoom; a zoom the CDN only partly passes on draws from all its unlisted tiles, since they are equally popular.
 */
export function sampler(listed: Listed, model: Model, scenario: Scenario, seed: number): () => string {
  const rand = mulberry32(seed);
  const zoomOf: number[] = [];
  const keyOf: number[] = [];
  const weight: number[] = [];
  const add = (z: number, k: number, w: number) => {
    zoomOf.push(z);
    keyOf.push(k);
    weight.push(w);
  };
  if (scenario === "alone") listed.counts.forEach((m, z) => m.forEach((n, k) => add(z, k, n)));
  else for (const t of model.missListed) add(t.z, t.k, t.requests);
  const listedWeight = weight.reduce((s, w) => s + w, 0);
  const tail = model.zooms.map((z) => (scenario === "alone" ? z.tailRequests : z.missTailRequests));
  const tailWeight = tail.reduce((s, w) => s + w, 0);
  const pickListed = weight.length ? aliasTable(weight) : null;
  const pickTailZoom = tailWeight > 0 ? aliasTable(tail) : null;
  const tailShare = tailWeight / (tailWeight + listedWeight);
  return () => {
    if (pickTailZoom && (!pickListed || rand() < tailShare)) {
      const z = pickTailZoom(rand);
      const r = regionRange(model.region, z);
      for (;;) {
        const x = r.x0 + Math.floor(rand() * (r.x1 - r.x0 + 1));
        const y = r.y0 + Math.floor(rand() * (r.y1 - r.y0 + 1));
        if (!listed.counts[z]!.has(key(z, x, y))) return `${z}/${x}/${y}`;
      }
    }
    const i = pickListed!(rand);
    const z = zoomOf[i]!;
    const k = keyOf[i]!;
    return `${z}/${Math.floor(k / 2 ** z)}/${k % 2 ** z}`;
  };
}
