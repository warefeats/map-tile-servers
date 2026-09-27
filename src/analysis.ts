/**
 * The verdict of docs/adr/0001-verdict-rule.md, computed from the raw results: per category, each
 * candidate's statistic with a 95% bootstrap interval, the winner, whether Martin 2.0.0 won it
 * handily, and 2.0.0 against 1.16.1.
 */
import type { CatalogResult } from "./catalog";
import { CANDIDATES, type Candidate, type Family, isMartin2 } from "./matrix";
import type { CandidateResult } from "./run";
import { mean, round } from "./stats";

export type Kind = "samples" | "ladder" | "memory";

export interface CategoryDef {
  id: string;
  title: string;
  unit: string;
  higherIsBetter: boolean;
  kind: Kind;
  previouslyMeasured: boolean;
  /** Samples, grouped into strata that are resampled separately (one stratum for most categories). */
  strata(r: CandidateResult, catalog: CatalogResult | undefined): number[][] | null;
}

const one = (xs: number[] | undefined | null): number[][] | null => (xs && xs.length ? [xs] : null);

export const CATEGORIES: CategoryDef[] = [
  { id: "single", title: "Single tile, one client", unit: "ms", higherIsBetter: false, kind: "samples", previouslyMeasured: true, strata: (r) => (r.single ? Object.values(r.single).map((s) => s.samplesMs) : null) },
  { id: "burst", title: "Viewport burst, four tiles", unit: "ms", higherIsBetter: false, kind: "samples", previouslyMeasured: true, strata: (r) => one(r.burst?.samplesMs) },
  { id: "c10", title: "Throughput, 10 clients, one tile", unit: "tiles/s", higherIsBetter: true, kind: "samples", previouslyMeasured: true, strata: (r) => one(r.concurrency?.["10"]?.samplesRps) },
  { id: "c100", title: "Throughput, 100 clients, one tile", unit: "tiles/s", higherIsBetter: true, kind: "samples", previouslyMeasured: true, strata: (r) => one(r.concurrency?.["100"]?.samplesRps) },
  { id: "walk", title: "Random walk, 10 clients, 256 tiles", unit: "tiles/s", higherIsBetter: true, kind: "samples", previouslyMeasured: true, strata: (r) => one(r.walk?.samplesRps) },
  { id: "coldStart", title: "Time to first tile", unit: "ms", higherIsBetter: false, kind: "samples", previouslyMeasured: true, strata: (r) => one(r.coldStart?.samplesMs) },
  {
    id: "memory",
    title: "Memory after load",
    unit: "MiB",
    higherIsBetter: false,
    kind: "memory",
    previouslyMeasured: true,
    strata: (r) => one([r.memoryAfterLoad?.anonMb, r.memoryAfterSessions?.anonMb].filter((x): x is number => typeof x === "number")),
  },
  { id: "cpu", title: "Cost per tile", unit: "µs CPU", higherIsBetter: false, kind: "samples", previouslyMeasured: false, strata: (r) => one((r.walk as { samplesCpuUs?: number[] } | undefined)?.samplesCpuUs) },
  { id: "capacity", title: "Capacity within the SLO", unit: "tiles/s", higherIsBetter: true, kind: "ladder", previouslyMeasured: false, strata: (r) => (r.ladder ? [[r.ladder.capacityRps]] : null) },
  { id: "session", title: "Map session, 10 users", unit: "ms per view", higherIsBetter: false, kind: "samples", previouslyMeasured: false, strata: (r) => one(r.sessions?.["10"]?.samplesMs) },
  { id: "catalog", title: "A thousand sources", unit: "ms", higherIsBetter: false, kind: "samples", previouslyMeasured: false, strata: (_r, cat) => one(cat?.coldStart.samplesMs) },
];

// ---- bootstrap -------------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RESAMPLES = 10_000;

/** One bootstrap replicate of the pooled mean: each stratum resampled with replacement, pooled. */
function replicate(strata: number[][], rand: () => number): number {
  let sum = 0;
  let n = 0;
  for (const s of strata) {
    for (let i = 0; i < s.length; i++) sum += s[Math.floor(rand() * s.length)]!;
    n += s.length;
  }
  return sum / n;
}

function quantile(sorted: number[], p: number): number {
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

export function bootstrapMean(strata: number[][], seed = 20260926): { mean: number; lo: number; hi: number } {
  const pooled = strata.flat();
  const m = mean(pooled);
  if (pooled.length < 2) return { mean: m, lo: m, hi: m };
  const rand = mulberry32(seed);
  const reps = Array.from({ length: RESAMPLES }, () => replicate(strata, rand)).sort((a, b) => a - b);
  return { mean: m, lo: quantile(reps, 0.025), hi: quantile(reps, 0.975) };
}

/** Ratio of means a/b with a bootstrap interval. */
export function bootstrapRatio(a: number[][], b: number[][], seed = 20260927): { ratio: number; lo: number; hi: number } {
  const ratio = mean(a.flat()) / mean(b.flat());
  const rand = mulberry32(seed);
  const reps = Array.from({ length: RESAMPLES }, () => replicate(a, rand) / replicate(b, rand)).sort((x, y) => x - y);
  return { ratio, lo: quantile(reps, 0.025), hi: quantile(reps, 0.975) };
}

// ---- verdict ---------------------------------------------------------------------------------

export interface Cell {
  candidateId: string;
  mean: number;
  lo: number;
  hi: number;
  n: number;
}

export interface CategoryVerdict {
  id: string;
  title: string;
  family: Family;
  unit: string;
  higherIsBetter: boolean;
  previouslyMeasured: boolean;
  cells: Cell[];
  winnerId: string | null;
  /** The best Martin 2.0.0 candidate (archive: the better of its two formats). */
  martin2: Cell | null;
  /** The best candidate that is not Martin. */
  bestCompetitor: Cell | null;
  /** How much better Martin 2.0.0 is than the best competitor, as a fraction (negative: worse). */
  margin: number | null;
  handily: boolean;
  why: string;
  /** 2.0.0 over 1.16.1, per format; >1 means 2.0.0 is better (the ratio is oriented by higherIsBetter). */
  versus1: { format: string; speedup: number; lo: number; hi: number; call: "much faster" | "faster" | "no change" | "slower" }[];
}

export function verdictFor(family: Family, def: CategoryDef, results: CandidateResult[], catalog: CatalogResult[]): CategoryVerdict {
  const cands = CANDIDATES.filter((c) => c.family === family);
  const strataOf = (c: Candidate) => {
    const r = results.find((x) => x.id === c.id);
    if (!r) return null;
    return def.strata(r, catalog.find((x) => x.id === c.id));
  };
  const cells: Cell[] = [];
  for (const c of cands) {
    const s = strataOf(c);
    if (!s || s.flat().length === 0) continue;
    const b = def.kind === "samples" ? bootstrapMean(s) : { mean: mean(s.flat()), lo: mean(s.flat()), hi: mean(s.flat()) };
    cells.push({ candidateId: c.id, mean: round(b.mean, 4), lo: round(b.lo, 4), hi: round(b.hi, 4), n: s.flat().length });
  }
  const byId = (id: string) => cands.find((c) => c.id === id)!;
  const sorted = [...cells].sort((a, b) => (def.higherIsBetter ? b.mean - a.mean : a.mean - b.mean));
  const winnerId = sorted[0]?.candidateId ?? null;
  const martin2 = sorted.find((cell) => isMartin2(byId(cell.candidateId))) ?? null;
  const bestCompetitor = sorted.find((cell) => byId(cell.candidateId).server !== "martin") ?? null;
  let margin: number | null = null;
  let handily = false;
  let why = "";
  if (!martin2 || !bestCompetitor) {
    why = "not measured for every candidate";
  } else {
    margin = def.higherIsBetter ? martin2.mean / bestCompetitor.mean - 1 : bestCompetitor.mean / martin2.mean - 1;
    const isBest = winnerId !== null && isMartin2(byId(winnerId));
    const needed = def.kind === "memory" ? 0.2 : 0.1;
    let clear: boolean;
    if (def.kind === "ladder") {
      clear = martin2.mean > bestCompetitor.mean; // at least one ladder step higher
    } else if (def.kind === "memory") {
      clear = true;
    } else {
      clear = def.higherIsBetter ? martin2.lo > bestCompetitor.hi : martin2.hi < bestCompetitor.lo;
    }
    handily = isBest && margin >= needed && clear;
    const comp = byId(bestCompetitor.candidateId).name;
    if (!isBest) why = `${byId(winnerId!).name} is best`;
    else if (margin < needed) why = `only ${(margin * 100).toFixed(1)}% ahead of ${comp} (needs ${needed * 100}%)`;
    else if (!clear) why = `ahead of ${comp} by ${(margin * 100).toFixed(1)}% but inside the noise`;
    else why = `${(margin * 100).toFixed(1)}% ahead of ${comp}`;
  }
  // 2.0.0 against 1.16.1, per format.
  const versus1: CategoryVerdict["versus1"] = [];
  const pairs: [string, string, string][] = family === "postgis" ? [["martin-2", "martin-1", "PostGIS"]] : [["martin-2-pmtiles", "martin-1-pmtiles", "PMTiles"], ["martin-2-mbtiles", "martin-1-mbtiles", "MBTiles"]];
  for (const [a, b, format] of pairs) {
    const sa = strataOf(byId(a));
    const sb = strataOf(byId(b));
    if (!sa || !sb || !sa.flat().length || !sb.flat().length) continue;
    const r = def.kind === "samples" ? bootstrapRatio(sa, sb) : { ratio: mean(sa.flat()) / mean(sb.flat()), lo: mean(sa.flat()) / mean(sb.flat()), hi: mean(sa.flat()) / mean(sb.flat()) };
    // Orient so that >1 is always "2.0.0 is better".
    const speedup = def.higherIsBetter ? r.ratio : 1 / r.ratio;
    const lo = def.higherIsBetter ? r.lo : 1 / r.hi;
    const hi = def.higherIsBetter ? r.hi : 1 / r.lo;
    const call = lo > 1 && speedup >= 1.25 ? "much faster" : lo > 1 ? "faster" : hi < 1 ? "slower" : "no change";
    versus1.push({ format, speedup: round(speedup, 3), lo: round(lo, 3), hi: round(hi, 3), call });
  }
  return { id: def.id, title: def.title, family, unit: def.unit, higherIsBetter: def.higherIsBetter, previouslyMeasured: def.previouslyMeasured, cells, winnerId, martin2, bestCompetitor, margin: margin === null ? null : round(margin, 4), handily, why, versus1 };
}

export function verdicts(family: Family, results: CandidateResult[], catalog: CatalogResult[]): CategoryVerdict[] {
  return CATEGORIES.filter((d) => family === "archive" || d.id !== "walk" || results.some((r) => r.walk)).map((d) => verdictFor(family, d, results, catalog));
}

if (import.meta.main) {
  const root = new URL("..", import.meta.url).pathname;
  const load = async (f: string) => (await Bun.file(`${root}${f}`).json().catch(() => undefined)) as { results: never[] } | undefined;
  const suffix = process.argv.includes("--smoke") ? "-smoke" : "";
  for (const family of ["postgis", "archive"] as Family[]) {
    const main = await load(`results-${family}${suffix}.json`);
    if (!main) continue;
    const cat = await load(`results-${family}-catalog${suffix}.json`);
    const vs = verdicts(family, main.results, (cat?.results ?? []) as CatalogResult[]);
    console.log(`\n## ${family}`);
    for (const v of vs) {
      const v1 = v.versus1.map((x) => `${x.format} ${x.speedup}x [${x.lo}-${x.hi}] ${x.call}`).join("; ");
      console.log(`${v.handily ? "WIN " : "----"} ${v.title.padEnd(38)} winner ${String(v.winnerId).padEnd(20)} ${v.why}${v1 ? `   | vs 1.16.1: ${v1}` : ""}`);
    }
  }
}
