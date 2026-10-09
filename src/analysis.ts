/**
 * The verdict of docs/adr/0001-verdict-rule.md as amended by 0005 (two passes, pooled), 0007 (archive
 * times above the harness floor) and 0008 (rivals only, three outcomes, database-bound ties, the
 * publish gate), computed from the raw results: per category, each candidate's statistic with a 95%
 * bootstrap interval, the outcome for Martin 2.0, and 2.0 against 1.16.1.
 */
import type { CatalogResult } from "./catalog";
import { CANDIDATES, type Candidate, type Family, isMartin2, isRival } from "./matrix";
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
  /** Ranked on time above the floor in the archive family (docs/adr/0007). */
  floored?: boolean;
  /** Serves tiles, so it can be database-bound in the PostGIS family (docs/adr/0008). */
  serving?: boolean;
  /** One pass's samples, grouped into strata that are resampled separately (one stratum for most categories). */
  strata(r: CandidateResult, catalog: CatalogResult | undefined): number[][] | null;
}

const one = (xs: number[] | undefined | null): number[][] | null => (xs && xs.length ? [xs] : null);

export const CATEGORIES: CategoryDef[] = [
  { id: "single", title: "Single tile, one client", unit: "ms", higherIsBetter: false, kind: "samples", previouslyMeasured: true, floored: true, serving: true, strata: (r) => (r.single ? Object.values(r.single).map((s) => s.samplesMs) : null) },
  { id: "burst", title: "Viewport burst, four tiles", unit: "ms", higherIsBetter: false, kind: "samples", previouslyMeasured: true, floored: true, serving: true, strata: (r) => one(r.burst?.samplesMs) },
  { id: "c10", title: "Throughput, 10 clients, one tile", unit: "tiles/s", higherIsBetter: true, kind: "samples", previouslyMeasured: true, serving: true, strata: (r) => one(r.concurrency?.["10"]?.samplesRps) },
  { id: "c100", title: "Throughput, 100 clients, one tile", unit: "tiles/s", higherIsBetter: true, kind: "samples", previouslyMeasured: true, serving: true, strata: (r) => one(r.concurrency?.["100"]?.samplesRps) },
  { id: "walk", title: "Random walk, 10 clients, 256 tiles", unit: "tiles/s", higherIsBetter: true, kind: "samples", previouslyMeasured: true, serving: true, strata: (r) => one(r.walk?.samplesRps) },
  { id: "coldStart", title: "Time to first tile", unit: "ms", higherIsBetter: false, kind: "samples", previouslyMeasured: true, floored: true, strata: (r) => one(r.coldStart?.samplesMs) },
  {
    id: "memory",
    title: "Memory after load",
    unit: "MiB",
    higherIsBetter: false,
    kind: "memory",
    previouslyMeasured: true,
    strata: (r) => one([r.memoryAfterLoad?.anonMb, r.memoryAfterSessions?.anonMb].filter((x): x is number => typeof x === "number")),
  },
  { id: "cpu", title: "Cost per tile", unit: "µs CPU", higherIsBetter: false, kind: "samples", previouslyMeasured: false, serving: true, strata: (r) => one((r.walk as { samplesCpuUs?: number[] } | undefined)?.samplesCpuUs) },
  { id: "capacity", title: "Capacity within the SLO", unit: "tiles/s", higherIsBetter: true, kind: "ladder", previouslyMeasured: false, serving: true, strata: (r) => (r.ladder ? [[r.ladder.capacityRps]] : null) },
  { id: "session", title: "Map session, 10 users", unit: "ms per view", higherIsBetter: false, kind: "samples", previouslyMeasured: false, floored: true, serving: true, strata: (r) => one(r.sessions?.["10"]?.samplesMs) },
  { id: "catalog", title: "A thousand sources", unit: "ms", higherIsBetter: false, kind: "samples", previouslyMeasured: false, floored: true, strata: (_r, cat) => one(cat?.coldStart.samplesMs) },
];

/** One pass of a run (docs/adr/0005): the main results and the thousand-sources results. */
export interface Pass {
  results: CandidateResult[];
  catalog: CatalogResult[];
}

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

// ---- pooling ---------------------------------------------------------------------------------

/**
 * A candidate's strata over every pass it has results in, stratum by stratum. Capacity is the highest
 * step held in every pass (docs/adr/0008); everything else pools its samples (docs/adr/0005).
 */
export function pooledStrata(def: CategoryDef, id: string, passes: Pass[]): number[][] | null {
  const perPass: number[][][] = [];
  for (const p of passes) {
    const r = p.results.find((x) => x.id === id);
    if (!r) continue;
    const s = def.strata(r, p.catalog.find((x) => x.id === id));
    if (s && s.flat().length) perPass.push(s);
  }
  if (perPass.length === 0) return null;
  if (def.kind === "ladder") return [[Math.min(...perPass.map((s) => s.flat()[0]!))]];
  const width = Math.max(...perPass.map((s) => s.length));
  return Array.from({ length: width }, (_, i) => perPass.flatMap((s) => s[i] ?? []));
}

// ---- verdict ---------------------------------------------------------------------------------

export interface Cell {
  candidateId: string;
  mean: number;
  lo: number;
  hi: number;
  n: number;
}

export type Outcome = "won" | "tie" | "lost";

export interface CategoryVerdict {
  id: string;
  title: string;
  family: Family;
  unit: string;
  higherIsBetter: boolean;
  previouslyMeasured: boolean;
  /** Ranked candidates only; the floor control is in `floor`. */
  cells: Cell[];
  winnerId: string | null;
  /** The best Martin 2.0 candidate (archive: the better of its two formats). */
  martin2: Cell | null;
  /** The best rival: the best candidate that is not Martin. */
  bestCompetitor: Cell | null;
  /** The floor control's cell, when this category is ranked above the floor (docs/adr/0007). */
  floor: Cell | null;
  /** How much better Martin 2.0 is than the best rival, as a fraction (negative: the rival is better); above the floor where floored. */
  margin: number | null;
  outcome: Outcome | null;
  /** ADR 0001's "handily wins", read against rivals: the same as outcome "won". */
  handily: boolean;
  /** PostGIS serving categories when the database does at least 90% of Martin 2.0's CPU per tile in the walk (docs/adr/0008). */
  databaseBound: boolean;
  /** Archive memory: reported, never decides publication (docs/adr/0008). */
  reportedOnly: boolean;
  /** Whether this category stops the page from being published, and why. */
  blocks: boolean;
  why: string;
  /** 2.0 over 1.16.1, per format; >1 means 2.0 is better (the ratio is oriented by higherIsBetter). Full times, never floored. */
  versus1: { format: string; speedup: number; lo: number; hi: number; call: "much faster" | "faster" | "no change" | "slower" }[];
}

/** The database's share of Martin 2.0's CPU per tile in the PostGIS walk, over every pass. */
export function databaseShare(passes: Pass[]): number | null {
  const shares: number[] = [];
  for (const p of passes) {
    const cpu = p.results.find((r) => r.id === "martin-2")?.walk?.cpu;
    if (cpu && cpu.dbUs !== null && cpu.totalUs > 0) shares.push(cpu.dbUs / cpu.totalUs);
  }
  return shares.length ? mean(shares) : null;
}

const DATABASE_BOUND = 0.9;

export function verdictFor(family: Family, def: CategoryDef, passes: Pass[]): CategoryVerdict {
  const cands = CANDIDATES.filter((c) => c.family === family);
  const byId = (id: string) => cands.find((c) => c.id === id)!;
  const cellOf = (c: Candidate): Cell | null => {
    const s = pooledStrata(def, c.id, passes);
    if (!s || s.flat().length === 0) return null;
    const b = def.kind === "samples" ? bootstrapMean(s) : { mean: mean(s.flat()), lo: mean(s.flat()), hi: mean(s.flat()) };
    return { candidateId: c.id, mean: round(b.mean, 4), lo: round(b.lo, 4), hi: round(b.hi, 4), n: s.flat().length };
  };
  const cells = cands.filter((c) => !c.control).map(cellOf).filter((x): x is Cell => x !== null);
  const control = cands.find((c) => c.control);
  const floor = family === "archive" && def.floored && control ? cellOf(control) : null;

  const better = (a: Cell, b: Cell) => (def.higherIsBetter ? a.mean > b.mean : a.mean < b.mean);
  const sorted = [...cells].sort((a, b) => (def.higherIsBetter ? b.mean - a.mean : a.mean - b.mean));
  const winnerId = sorted[0]?.candidateId ?? null;
  const martin2 = sorted.find((cell) => isMartin2(byId(cell.candidateId))) ?? null;
  const bestCompetitor = sorted.find((cell) => isRival(byId(cell.candidateId))) ?? null;

  /** How much `a` beats `b`, as a fraction; above the floor for floored times (a zero time above the floor beats any other). */
  const lead = (a: Cell, b: Cell): number => {
    if (def.higherIsBetter) return a.mean / b.mean - 1;
    const f = floor?.mean ?? 0;
    const ta = Math.max(0, a.mean - f);
    const tb = Math.max(0, b.mean - f);
    if (ta === 0) return tb === 0 ? 0 : Number.POSITIVE_INFINITY;
    return tb / ta - 1;
  };
  /** `a` is ahead of `b` beyond the noise: intervals apart (capacity: a higher step; memory has no interval). */
  const clear = (a: Cell, b: Cell): boolean => {
    if (!better(a, b)) return false;
    if (def.kind !== "samples") return true;
    return def.higherIsBetter ? a.lo > b.hi : a.hi < b.lo;
  };
  const needed = def.kind === "memory" ? 0.2 : 0.1;

  const share = family === "postgis" ? databaseShare(passes) : null;
  const databaseBound = family === "postgis" && !!def.serving && share !== null && share >= DATABASE_BOUND;
  const reportedOnly = family === "archive" && def.id === "memory";

  let margin: number | null = null;
  let outcome: Outcome | null = null;
  let why = "";
  if (!martin2 || !bestCompetitor) {
    why = "not measured for Martin 2.0 and at least one rival";
  } else {
    const rival = byId(bestCompetitor.candidateId).name;
    const ahead = lead(martin2, bestCompetitor);
    const behind = lead(bestCompetitor, martin2);
    margin = better(martin2, bestCompetitor) || martin2.mean === bestCompetitor.mean ? ahead : -behind;
    const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : "all of the time above the floor");
    if (ahead >= needed && clear(martin2, bestCompetitor)) {
      outcome = "won";
      why = `${pct(ahead)} ahead of ${rival}`;
    } else if (behind >= needed && clear(bestCompetitor, martin2)) {
      outcome = "lost";
      why = `${rival} is ${pct(behind)} ahead`;
    } else {
      outcome = "tie";
      if (better(martin2, bestCompetitor)) why = ahead < needed ? `only ${pct(ahead)} ahead of ${rival} (needs ${needed * 100}%)` : `${pct(ahead)} ahead of ${rival} but inside the noise`;
      else why = behind < needed ? `${rival} ${pct(behind)} ahead, under ${needed * 100}%` : `${rival} ${pct(behind)} ahead but inside the noise`;
    }
  }

  // 2.0 against 1.16.1, per format, on full times.
  const versus1: CategoryVerdict["versus1"] = [];
  const pairs: [string, string, string][] = family === "postgis" ? [["martin-2", "martin-1", "PostGIS"]] : [["martin-2-pmtiles", "martin-1-pmtiles", "PMTiles"], ["martin-2-mbtiles", "martin-1-mbtiles", "MBTiles"]];
  for (const [a, b, format] of pairs) {
    const sa = pooledStrata(def, a, passes);
    const sb = pooledStrata(def, b, passes);
    if (!sa || !sb || !sa.flat().length || !sb.flat().length) continue;
    const r = def.kind === "samples" ? bootstrapRatio(sa, sb) : { ratio: mean(sa.flat()) / mean(sb.flat()), lo: mean(sa.flat()) / mean(sb.flat()), hi: mean(sa.flat()) / mean(sb.flat()) };
    // Orient so that >1 is always "2.0 is better".
    const speedup = def.higherIsBetter ? r.ratio : 1 / r.ratio;
    const lo = def.higherIsBetter ? r.lo : 1 / r.hi;
    const hi = def.higherIsBetter ? r.hi : 1 / r.lo;
    const call = lo > 1 && speedup >= 1.25 ? "much faster" : lo > 1 ? "faster" : hi < 1 ? "slower" : "no change";
    versus1.push({ format, speedup: round(speedup, 3), lo: round(lo, 3), hi: round(hi, 3), call });
  }

  const slower = versus1.some((v) => v.call === "slower");
  const outcomeBlocks = outcome !== "won" && !(outcome === "tie" && databaseBound) && !reportedOnly;
  const blocks = slower || outcomeBlocks;
  return {
    id: def.id,
    title: def.title,
    family,
    unit: def.unit,
    higherIsBetter: def.higherIsBetter,
    previouslyMeasured: def.previouslyMeasured,
    cells,
    winnerId,
    martin2,
    bestCompetitor,
    floor,
    margin: margin === null ? null : Number.isFinite(margin) ? round(margin, 4) : margin,
    outcome,
    handily: outcome === "won",
    databaseBound,
    reportedOnly,
    blocks,
    why,
    versus1,
  };
}

export function verdictsForPasses(family: Family, passes: Pass[]): CategoryVerdict[] {
  return CATEGORIES.filter((d) => family === "archive" || d.id !== "walk" || passes.some((p) => p.results.some((r) => r.walk))).map((d) => verdictFor(family, d, passes));
}

/** One pass (the run files from before docs/adr/0005). */
export function verdicts(family: Family, results: CandidateResult[], catalog: CatalogResult[]): CategoryVerdict[] {
  return verdictsForPasses(family, [{ results, catalog }]);
}

// ---- report ----------------------------------------------------------------------------------

function fmt(x: number, unit: string): string {
  const digits = Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : Math.abs(x) >= 1 ? 2 : 4;
  return `${x.toFixed(digits)} ${unit}`;
}

export function report(family: Family, vs: CategoryVerdict[], passes: Pass[]): string {
  const name = (id: string) => CANDIDATES.find((c) => c.id === id)?.name ?? id;
  const lines: string[] = [`## ${family}`];
  if (family === "postgis") {
    const share = databaseShare(passes);
    lines.push(`database share of Martin 2.0's CPU per tile in the walk: ${share === null ? "n/a" : `${(share * 100).toFixed(1)}%`} (database-bound at 90% or more)`);
  }
  for (const v of vs) {
    const tag = v.outcome === "won" ? "WON " : v.outcome === "lost" ? "LOST" : v.outcome === "tie" ? "TIE " : "----";
    const gate = v.blocks ? "blocks" : v.reportedOnly ? "reported" : v.databaseBound && v.outcome === "tie" ? "db-bound tie" : "ok";
    const m2 = v.martin2 ? `${name(v.martin2.candidateId)} ${fmt(v.martin2.mean, v.unit)} [${fmt(v.martin2.lo, "").trim()}-${fmt(v.martin2.hi, "").trim()}]` : "Martin 2.0 n/a";
    const rival = v.bestCompetitor ? `${name(v.bestCompetitor.candidateId)} ${fmt(v.bestCompetitor.mean, v.unit)} [${fmt(v.bestCompetitor.lo, "").trim()}-${fmt(v.bestCompetitor.hi, "").trim()}]` : "no rival";
    const floor = v.floor ? `; floor ${fmt(v.floor.mean, v.unit)}` : "";
    const v1 = v.versus1.map((x) => `${x.format} ${x.speedup}x [${x.lo}-${x.hi}] ${x.call}`).join("; ");
    lines.push(`${tag} ${v.title.padEnd(36)} ${gate.padEnd(13)} ${v.why}`);
    lines.push(`       ${m2} vs ${rival}${floor}${v1 ? ` | vs 1.16.1: ${v1}` : ""}`);
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const root = new URL("..", import.meta.url).pathname;
  const load = async (f: string) => (await Bun.file(`${root}${f}`).json().catch(() => undefined)) as { results: CandidateResult[] } | undefined;
  // --run=rc81 pools results-<family>-rc81-p1.json and -p2.json (+ the catalog files of the same run);
  // --suffix=int16 scores the single-pass results-<family>-int16.json (+ results-<family>-catalog-int16.json).
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const runName = arg("run");
  const named = arg("suffix");
  const suffixes = runName ? [`-${runName}-p1`, `-${runName}-p2`] : [named ? `-${named}` : process.argv.includes("--smoke") ? "-smoke" : ""];
  const all: Record<string, CategoryVerdict[]> = {};
  let publishable = true;
  for (const family of ["postgis", "archive"] as Family[]) {
    const passes: Pass[] = [];
    for (const s of suffixes) {
      const main = await load(`results-${family}${s}.json`);
      if (!main) continue;
      const cat = await load(`results-${family}-catalog${s}.json`);
      passes.push({ results: main.results, catalog: (cat?.results ?? []) as unknown as CatalogResult[] });
    }
    if (!passes.length) continue;
    const vs = verdictsForPasses(family, passes);
    all[family] = vs;
    if (vs.some((v) => v.blocks)) publishable = false;
    console.log(`\n${report(family, vs, passes)}  (${passes.length} pass${passes.length > 1 ? "es" : ""})`);
  }
  const flat = Object.values(all).flat();
  const count = (o: Outcome) => flat.filter((v) => v.outcome === o).length;
  console.log(`\n${count("won")} won, ${count("tie")} tied, ${count("lost")} lost of ${flat.length}; ${flat.filter((v) => v.blocks).length} block publication: ${publishable && flat.length ? "PUBLISHABLE under docs/adr/0008" : "not publishable under docs/adr/0008"}`);
  if (runName) await Bun.write(`${root}verdict-${runName}.json`, JSON.stringify({ generatedAt: new Date().toISOString(), run: runName, publishable: publishable && flat.length > 0, verdicts: all }, null, 2) + "\n");
}
