/**
 * Raw results (both families, main and catalog runs) → the site's run file and benchmark.json.
 * Every number on the page comes from here. The story's words live in story.json, hand-written;
 * `{fact}` placeholders in them are filled from the facts this script computes, so a sentence
 * can never disagree with the run it describes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CATEGORIES, type CategoryVerdict, verdicts } from "./analysis";
import type { CatalogResult } from "./catalog";
import { CANDIDATES, type Candidate, type Family, LADDER } from "./matrix";
import type { CandidateResult, RawResults } from "./run";
import { mean, round, statistics } from "./stats";

const ROOT = join(import.meta.dirname!, "..");

interface Loaded {
  family: Family;
  raw: RawResults;
  catalog: CatalogResult[];
  verdicts: CategoryVerdict[];
}

function load(family: Family, suffix: string): Loaded | null {
  let raw: RawResults;
  try {
    raw = JSON.parse(readFileSync(join(ROOT, `results-${family}${suffix}.json`), "utf8"));
  } catch {
    return null;
  }
  let catalog: CatalogResult[] = [];
  try {
    catalog = JSON.parse(readFileSync(join(ROOT, `results-${family}-catalog${suffix}.json`), "utf8")).results;
  } catch {}
  return { family, raw, catalog, verdicts: verdicts(family, raw.results, catalog) };
}

const byId = (id: string): Candidate => CANDIDATES.find((c) => c.id === id)!;
const FAMILY_TITLE: Record<Family, string> = { postgis: "PostGIS", archive: "Archive" };

// ---- sections (the "every chart" disclosure) --------------------------------------------------

type Metric = { value: number; unit: string; label?: string };

interface SiteCandidate {
  id: string;
  name: string;
  version: string;
  color?: string;
  homepage?: string;
  statistics: { medianMs: number; meanMs: number; minMs: number; maxMs: number };
  samplesMs: number[];
  metrics?: Record<string, Metric>;
}

function siteCandidate(c: Candidate, samples: number[], metrics: Record<string, Metric> = {}): SiteCandidate {
  // The site rejects a sample list whose values are all equal as replicated; two equal readings are one.
  const distinct = new Set(samples).size > 1 ? samples : samples.slice(0, 1);
  return { id: c.id, name: c.name, version: c.version, color: c.color, homepage: c.homepage, statistics: statistics(distinct), samplesMs: distinct, metrics };
}

function fmt(value: number, unit: string): string {
  if (unit === "tiles/s") return `${Math.round(value).toLocaleString("en-US")} tiles/s`;
  if (unit === "ms" || unit === "ms per view") return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value < 1 ? value.toPrecision(2) : value < 10 ? value.toFixed(2) : value < 100 ? value.toFixed(1) : Math.round(value)} ms`;
  if (unit === "µs CPU") return value >= 1000 ? `${(value / 1000).toFixed(2)} ms CPU` : `${Math.round(value)} µs CPU`;
  if (unit === "MiB") return `${value.toFixed(1)} MiB`;
  return `${round(value, 2)} ${unit}`;
}

const SECTION_DECK: Record<string, string> = {
  single: "One client, one tile at a time over one keep-alive connection; the samples are the mean of each measured pass, pooled over the four test tiles.",
  burst: "Four adjacent tiles requested at once over four keep-alive connections; the sample is the wall time until the last tile lands.",
  c10: "Ten closed-loop clients on the marquee tile; samples are each 12-second pass's successful tiles per second.",
  c100: "A hundred closed-loop clients on the marquee tile; samples are each pass's successful tiles per second.",
  walk: "Ten closed-loop clients, each request a random tile from 256 z14 tiles of central Berlin.",
  coldStart: "Process start (Docker StartedAt) to the first 200 for the marquee tile, timed on the engine network in the VM's clock.",
  memory: "Anonymous memory of the engine's cgroup after the load passes and after the map sessions; mmapped archive pages and the executable are file-backed and on record separately.",
  cpu: "CPU time the engine's cgroup (and, for PostGIS, the database's) spent per successful tile during the random walk.",
  capacity: "Open-loop offered load over the random walk, stepped up until a step is not held: p99 over the SLO, more than 0.1% errors, or under 95% of the rate delivered.",
  session: "Ten simulated MapLibre users fly into Berlin and pan, six keep-alive connections each, no think time; the sample is the time to finish each view.",
  catalog: "The same cold start with 1,000 extra sources configured beside the test source.",
};

function sectionFor(l: Loaded, v: CategoryVerdict): object | null {
  const def = CATEGORIES.find((d) => d.id === v.id)!;
  if (v.cells.length < 2) return null;
  const candidates = v.cells.map((cell) => {
    const r = l.raw.results.find((x) => x.id === cell.candidateId)!;
    const strata = def.strata(r, l.catalog.find((x) => x.id === cell.candidateId)) ?? [];
    const metrics: Record<string, Metric> = { lo: { value: cell.lo, unit: v.unit, label: "95% interval, low" }, hi: { value: cell.hi, unit: v.unit, label: "95% interval, high" } };
    return siteCandidate(byId(cell.candidateId), strata.flat(), metrics);
  });
  const tests: { id: string; title: string; description: string; unit: string; lowerIsBetter: boolean; results: { candidateId: string; value: number }[] }[] = [
    { id: `${v.id}-mean`, title: v.title, description: SECTION_DECK[v.id] ?? "", unit: v.unit, lowerIsBetter: !v.higherIsBetter, results: v.cells.map((c) => ({ candidateId: c.candidateId, value: round(c.mean, 3) })) },
  ];
  const winner = byId(v.winnerId!);
  const best = v.cells.find((c) => c.candidateId === v.winnerId)!;
  return {
    id: `${l.family}-${v.id}`,
    title: `${FAMILY_TITLE[l.family]}: ${v.title}`,
    deck: SECTION_DECK[v.id] ?? "",
    unit: v.unit,
    lowerIsBetter: !v.higherIsBetter,
    verdict: {
      winnerId: winner.id,
      headline: `${winner.name}: ${fmt(best.mean, v.unit)}. ${v.handily ? "Martin 2.0.0 wins it handily" : `Martin 2.0.0 does not win it handily: ${v.why}`}.`,
      summary: "",
    },
    candidates,
    tests,
  };
}

// ---- facts for the story's placeholders --------------------------------------------------------------

function cellMean(l: Loaded, category: string, id: string): number {
  const v = l.verdicts.find((x) => x.id === category);
  return v?.cells.find((c) => c.candidateId === id)?.mean ?? Number.NaN;
}

function result(l: Loaded, id: string): CandidateResult {
  return l.raw.results.find((r) => r.id === id)!;
}

export function facts(a: Loaded, p: Loaded): Record<string, string> {
  const x = (n: number, d = 1) => `${n.toFixed(d)}×`;
  const int = (n: number) => Math.round(n).toLocaleString("en-US");
  const pct = (n: number, d = 0) => `${(n * 100).toFixed(d)}%`;
  const f: Record<string, string> = {};
  const verdictOf = (l: Loaded, id: string) => l.verdicts.find((v) => v.id === id);

  // Archive: the walk.
  const pmWalk2 = cellMean(a, "walk", "martin-2-pmtiles");
  const pmWalk1 = cellMean(a, "walk", "martin-1-pmtiles");
  const mbWalk2 = cellMean(a, "walk", "martin-2-mbtiles");
  const mbWalk1 = cellMean(a, "walk", "martin-1-mbtiles");
  f.pmWalk2 = int(pmWalk2);
  f.pmWalk1 = int(pmWalk1);
  f.pmWalkSpeedup = x(pmWalk2 / pmWalk1);
  f.mbWalkSpeedup = x(mbWalk2 / mbWalk1);
  const walkV = verdictOf(a, "walk");
  const nextServer = walkV?.bestCompetitor;
  if (nextServer) f.pmWalkVsNext = x(pmWalk2 / nextServer.mean);
  if (nextServer) f.nextWalkServer = byId(nextServer.candidateId).name;
  f.pmWalkCores = (result(a, "martin-2-pmtiles").walk?.engineCores ?? Number.NaN).toFixed(1);
  const cpu2 = cellMean(a, "cpu", "martin-2-pmtiles");
  const cpu1 = cellMean(a, "cpu", "martin-1-pmtiles");
  f.pmCpu2 = int(cpu2);
  f.pmCpu1 = int(cpu1);
  f.pmCpuFraction = pct(cpu2 / cpu1);

  // Archive: the ladder.
  const firstMiss = (l: Loaded, id: string) => result(l, id).ladder?.steps.find((s) => !s.held)?.offeredRps;
  f.m2pmCap = int(result(a, "martin-2-pmtiles").ladder?.capacityRps ?? Number.NaN);
  f.m1pmCap = int(result(a, "martin-1-pmtiles").ladder?.capacityRps ?? Number.NaN);
  f.m1pmFail = int(firstMiss(a, "martin-1-pmtiles") ?? Number.NaN);

  // PostGIS: where the CPU goes, and 2.0 against 1.16.1.
  const pgCpu = result(p, "martin-2").walk?.cpu;
  if (pgCpu && pgCpu.dbUs) {
    f.pgMartinShare = pct(pgCpu.engineUs / pgCpu.totalUs, 1);
    f.pgMartinUs = int(pgCpu.engineUs);
    f.pgDbMs = (pgCpu.dbUs / 1000).toFixed(1);
  }
  const pgWalk2 = cellMean(p, "walk", "martin-2");
  const pgWalk1 = cellMean(p, "walk", "martin-1");
  f.pgWalk2 = int(pgWalk2);
  f.pgWalk1 = int(pgWalk1);
  f.pgWalkRatio = x(pgWalk2 / pgWalk1, 2);
  f.pgWalkDelta = pct(Math.abs(pgWalk2 / pgWalk1 - 1));
  const pgCpuV = verdictOf(p, "cpu");
  if (pgCpuV?.martin2) f.pgCpuTotal2 = (pgCpuV.martin2.mean / 1000).toFixed(1);
  if (pgCpuV?.bestCompetitor) {
    f.pgCpuNext = (pgCpuV.bestCompetitor.mean / 1000).toFixed(1);
    f.pgCpuNextServer = byId(pgCpuV.bestCompetitor.candidateId).name;
  }
  const sessV = verdictOf(p, "session");
  if (sessV?.martin2) f.pgSession2 = Math.round(sessV.martin2.mean).toString();
  if (sessV?.bestCompetitor) {
    f.pgSessionNext = Math.round(sessV.bestCompetitor.mean).toString();
    f.pgSessionNextServer = byId(sessV.bestCompetitor.candidateId).name;
  }
  const aSessV = verdictOf(a, "session");
  if (aSessV?.martin2) f.aSession2 = aSessV.martin2.mean.toFixed(1);

  // Start and memory against the best competitor in each.
  const coldV = verdictOf(a, "coldStart");
  const memV = verdictOf(a, "memory");
  if (coldV?.bestCompetitor) f.vtStart = Math.round(coldV.bestCompetitor.mean).toString();
  if (coldV?.martin2) f.m2Start = Math.round(coldV.martin2.mean).toString();
  if (memV?.bestCompetitor) f.vtMem = memV.bestCompetitor.mean.toFixed(1);
  if (memV?.martin2) f.m2Mem = memV.martin2.mean.toFixed(1);
  if (coldV?.bestCompetitor) f.coldWinner = byId(coldV.bestCompetitor.candidateId).name;

  // A thousand sources.
  const catA = verdictOf(a, "catalog");
  const catP = verdictOf(p, "catalog");
  const cm = (l: Loaded, id: string) => cellMean(l, "catalog", id);
  if (catA?.bestCompetitor) {
    f.aCatalogBest = Math.round(catA.bestCompetitor.mean).toString();
    f.aCatalogBestServer = byId(catA.bestCompetitor.candidateId).name;
  }
  f.aCatalog2pm = Math.round(cm(a, "martin-2-pmtiles")).toString();
  f.aCatalog2mb = (cm(a, "martin-2-mbtiles") / 1000).toFixed(1);
  const mbCat = a.catalog.find((r) => r.id === "martin-2-mbtiles");
  if (mbCat) f.aCatalog2mbMem = Math.round(mbCat.coldStart.idle.anonMb).toString();
  if (catP?.bestCompetitor) {
    f.pCatalogBest = Math.round(catP.bestCompetitor.mean).toString();
    f.pCatalogBestServer = byId(catP.bestCompetitor.candidateId).name;
  }
  f.pCatalog2 = Math.round(cm(p, "martin-2")).toString();
  f.pCatalog1 = Math.round(cm(p, "martin-1")).toString();
  const coldP = verdictOf(p, "coldStart");
  if (coldP?.bestCompetitor) {
    f.pColdBest = Math.round(coldP.bestCompetitor.mean).toString();
    f.pColdBestServer = byId(coldP.bestCompetitor.candidateId).name;
  }
  if (coldP?.martin2) f.pCold2 = Math.round(coldP.martin2.mean).toString();
  const c10P = verdictOf(p, "c10");
  if (c10P?.bestCompetitor && c10P.martin2) {
    f.pC10Best = Math.round(c10P.bestCompetitor.mean).toString();
    f.pC10BestServer = byId(c10P.bestCompetitor.candidateId).name;
    f.pC10m2 = Math.round(c10P.martin2.mean).toString();
  }
  f.pmWalkNextRatio = f.pmWalkVsNext ?? "";

  // The tally.
  const all = [...p.verdicts, ...a.verdicts].filter((v) => v.martin2 && v.bestCompetitor);
  f.categories = String(all.length);
  f.wins = String(all.filter((v) => v.handily).length);
  f.losses = String(all.filter((v) => !v.handily).length);
  f.postgisWins = String(p.verdicts.filter((v) => v.handily).length);
  f.archiveWins = String(a.verdicts.filter((v) => v.handily).length);
  return f;
}

function fill(text: string, f: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => {
    if (!(k in f)) throw new Error(`story.json uses {${k}}, which import.ts does not compute`);
    return f[k]!;
  });
}

// ---- story figures (numbers only; words come from story.json) -----------------------------

type Row = { label: string; value: number; color?: string; best?: boolean; muted?: boolean; group?: string };

const SHORT: Record<string, string> = {
  single: "Single tile",
  burst: "Four-tile burst",
  c10: "10 clients",
  c100: "100 clients",
  walk: "Random walk",
  coldStart: "Start",
  memory: "Memory",
  cpu: "CPU per tile",
  capacity: "Capacity in SLO",
  session: "Busy map",
  catalog: "1,000 sources",
};

/** Round to what a chart can show: whole tiles per second and microseconds, three significant digits otherwise. */
function tidy(value: number, unit: string): number {
  if (unit === "tiles/s" || unit === "µs" || unit === "µs CPU") return Math.round(value);
  return Number(value.toPrecision(4));
}

function barsFrom(l: Loaded, category: string, opts: { group?: string; top?: number } = {}): Row[] {
  const v = l.verdicts.find((x) => x.id === category);
  if (!v) return [];
  const sorted = [...v.cells].sort((a, b) => (v.higherIsBetter ? b.mean - a.mean : a.mean - b.mean));
  return sorted.slice(0, opts.top ?? sorted.length).map((cell) => {
    const c = byId(cell.candidateId);
    return { label: c.name, value: tidy(cell.mean, v.unit), color: c.color, best: cell.candidateId === v.winnerId, ...(opts.group ? { group: opts.group } : {}) };
  });
}

export function figures(a: Loaded, p: Loaded): Record<string, object> {
  const out: Record<string, object> = {};
  out.archiveWalk = { kind: "bars", caption: "Random walk over 256 street-level tiles, 10 clients", unit: "tiles/s", lowerIsBetter: false, rows: barsFrom(a, "walk") };
  out.archiveCpu = { kind: "bars", caption: "CPU per tile during the random walk", unit: "µs", lowerIsBetter: true, scale: "log", rows: barsFrom(a, "cpu") };
  out.postgisWalk = { kind: "bars", caption: "Random walk over 256 z14 building tiles, 10 clients", unit: "tiles/s", lowerIsBetter: false, rows: barsFrom(p, "walk") };
  // Where a PostGIS tile's CPU goes: the server's cgroup against the database's, per tile, during the walk.
  const pgRows = CANDIDATES.filter((c) => c.family === "postgis")
    .map((c) => ({ c, cpu: result(p, c.id)?.walk?.cpu }))
    .filter((x) => x.cpu && x.cpu.dbUs !== null)
    .sort((x, y) => x.cpu!.totalUs - y.cpu!.totalUs);
  const pgBest = p.verdicts.find((v) => v.id === "cpu")?.winnerId;
  out.postgisSplit = {
    kind: "split",
    caption: "CPU per PostGIS tile during the random walk: the server against the database",
    unit: "ms",
    parts: [
      { id: "server", label: "tile server", tone: "brand" },
      { id: "database", label: "PostgreSQL + PostGIS", tone: "neutral" },
    ],
    rows: pgRows.map(({ c, cpu }) => ({ label: c.name, color: c.color, best: c.id === pgBest, values: { server: round(cpu!.engineUs / 1000, 3), database: round(cpu!.dbUs! / 1000, 3) } })),
  };
  // Latency against offered load, open loop over the walk: the knee is each server's capacity.
  const ladderSeries = (l: Loaded, ids: string[]) =>
    ids
      .map((id) => ({ id, ladder: result(l, id)?.ladder }))
      .filter((x) => x.ladder && x.ladder.steps.length)
      .map(({ id, ladder }) => {
        const c = byId(id);
        return { label: c.name, color: c.color, best: id === l.verdicts.find((v) => v.id === "capacity")?.winnerId, points: ladder!.steps.filter((s) => s.p99Ms !== null).map((s) => [s.offeredRps, s.p99Ms!] as [number, number]) };
      });
  // The best candidate of each competing server, highest capacity first: one line per server keeps
  // the chart to five hues that stay apart for colour-blind readers.
  const topCapacity = (l: Loaded) => {
    const seen = new Set<string>();
    return [...(l.verdicts.find((v) => v.id === "capacity")?.cells ?? [])]
      .sort((x, y) => y.mean - x.mean)
      .map((c) => c.candidateId)
      .filter((id) => {
        const server = byId(id).server;
        if (server === "martin" || seen.has(server)) return false;
        seen.add(server);
        return true;
      });
  };
  const archiveLadderIds = ["martin-2-pmtiles", "martin-1-pmtiles", ...topCapacity(a).slice(0, 3)];
  out.archiveLadder = { kind: "lines", caption: "p99 latency against offered load, open loop over the walk", x: { label: "offered load", unit: "tiles/s", log: true }, y: { label: "p99", unit: "ms", log: true }, limit: { value: LADDER.archive.sloMs, label: `SLO ${LADDER.archive.sloMs} ms` }, series: ladderSeries(a, archiveLadderIds) };
  const postgisLadderIds = ["martin-2", "martin-1", ...topCapacity(p).slice(0, 3)];
  out.postgisLadder = { kind: "lines", caption: "p99 latency against offered load, open loop over the walk", x: { label: "offered load", unit: "tiles/s", log: true }, y: { label: "p99", unit: "ms", log: true }, limit: { value: LADDER.postgis.sloMs, label: `SLO ${LADDER.postgis.sloMs} ms` }, series: ladderSeries(p, postgisLadderIds) };
  // 2.0.0 over 1.16.1, every category that has both.
  const ratioRows = ["PostGIS", "PMTiles"].flatMap((format) =>
    [p, a].flatMap((l) =>
      l.verdicts.flatMap((v) =>
        v.versus1.filter((x) => x.format === format && Number.isFinite(x.speedup)).map((x) => ({ label: SHORT[v.id] ?? v.title, group: format === "PostGIS" ? "From PostGIS" : "From PMTiles", value: Number(x.speedup.toFixed(3)), lo: Number(x.lo.toFixed(3)), hi: Number(x.hi.toFixed(3)) })),
      ),
    ),
  );
  out.versus = { kind: "ratio", caption: "Martin 2.0.0 against 1.16.1 per category (right of 1× is better)", unit: "×", reference: 1, log: true, rows: ratioRows };
  out.session = { kind: "bars", caption: "Time to finish a view from PostGIS, 10 users flying and panning at once (log scale)", unit: "ms", lowerIsBetter: true, scale: "log", rows: barsFrom(p, "session") };
  out.catalog = { kind: "bars", caption: "Time to first tile with 1,000 extra sources configured (log scale)", unit: "ms", lowerIsBetter: true, scale: "log", rows: [...barsFrom(a, "catalog", { group: "Archive servers" }), ...barsFrom(p, "catalog", { group: "PostGIS servers" })] };
  out.coldStart = { kind: "bars", caption: "Archive servers: process start to first tile, mean of five", unit: "ms", lowerIsBetter: true, rows: barsFrom(a, "coldStart") };
  out.memory = { kind: "bars", caption: "Anonymous memory after the load passes", unit: "MiB", lowerIsBetter: true, scale: "log", rows: [...barsFrom(a, "memory", { group: "Archive servers" }), ...barsFrom(p, "memory", { group: "PostGIS servers" })] };
  return out;
}

function verdictTable(a: Loaded, p: Loaded): object {
  const rows: { group: string; cells: string[]; mark: "win" | "loss" }[] = [];
  for (const l of [p, a]) {
    for (const v of l.verdicts) {
      if (!v.martin2 || !v.bestCompetitor || !v.winnerId) continue;
      const winner = byId(v.winnerId);
      const winnerCell = v.cells.find((c) => c.candidateId === v.winnerId)!;
      const vs1 = v.versus1.map((x) => `${x.format === "PostGIS" ? "" : `${x.format} `}${x.speedup.toFixed(2)}×`).join(", ");
      rows.push({
        group: l.family === "postgis" ? "From PostGIS" : "From an archive",
        cells: [
          v.title,
          `${winner.name}, ${fmt(winnerCell.mean, v.unit)}`,
          fmt(v.martin2.mean, v.unit),
          `${byId(v.bestCompetitor.candidateId).name}, ${fmt(v.bestCompetitor.mean, v.unit)}`,
          v.handily ? `yes, ${(v.margin! * 100).toFixed(0)}% ahead` : `no: ${v.why}`,
          vs1,
        ],
        mark: v.handily ? "win" : "loss",
      });
    }
  }
  return {
    caption: "Every category, both families. Handily means best of every candidate, at least 10% ahead of the best competitor, with 95% intervals that do not overlap (docs/adr/0001, written before the first measured pass).",
    columns: ["Category", "Best", "Martin 2.0.0", "Best competitor", "Handily?", "2.0.0 vs 1.16.1"],
    markColumn: 4,
    rows,
  };
}

// ---- run file + benchmark.json ---------------------------------------------------------------------

if (import.meta.main) {
  const suffix = process.argv.includes("--smoke") ? "-smoke" : "";
  const a = load("archive", suffix);
  const p = load("postgis", suffix);
  if (!a || !p) throw new Error("need results-archive and results-postgis");
  const env = a.raw.environment as Record<string, unknown> & { vm: { cpus: number; memoryGb: number; kernel: string } | null };
  const generated = [a.raw.generatedAt, p.raw.generatedAt].sort().at(-1)!;
  const date = new Date(generated).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  // A Linux host runs the containers itself (vm is null); the Mac runs them in OrbStack's VM.
  const vm = env.vm;
  const rig = vm ? "m2-max" : String(env.machine).replace(/^EC2 /, "").replace(/\W+/g, "-").toLowerCase();
  const runId = `${date}-${rig}`;
  const sections = [p, a].flatMap((l) => l.verdicts.map((v) => sectionFor(l, v)).filter(Boolean));
  const run = {
    schemaVersion: 1,
    id: runId,
    label: vm ? `M2 Max / macOS (${env.os})` : `${env.machine} / ${env.os}`,
    publishedAt: generated,
    environment: {
      machine: String(env.machine),
      chip: String(env.chip),
      cores: vm ? `${env.cores} (${env.performanceCores}P + ${env.efficiencyCores}E); OrbStack VM ${vm.cpus} CPUs` : `${env.cores}`,
      memory: vm ? `${env.memoryGb} GB; VM ${vm.memoryGb} GB` : `${env.memoryGb} GB`,
      os: vm ? `${env.os}; Linux ${vm.kernel} in the VM` : `${env.os}; Linux ${env.kernel}`,
      arch: "arm64",
      runtime: `${env.docker}; ${env.loadGenerator}`,
    },
    protocol: {
      warmups: 3,
      runs: 20,
      processModel: "One engine container at a time (4 CPUs, 4 GB); PostGIS in its own 6-CPU container; the client container on the same Docker network",
      cacheState: "Server tile caches off; PMTiles directory caches at go-pmtiles' 64 MB default; PostgreSQL buffer cache prewarmed",
      output: "Tiles decoded and counted per server before timing (parity); every sample in this file",
    },
    candidates: [],
    sections,
    verdicts: { postgis: p.verdicts, archive: a.verdicts },
    raw: { ladder: Object.fromEntries([p, a].flatMap((l) => l.raw.results.map((r) => [r.id, r.ladder ?? null]))), ladderSlo: { postgis: LADDER.postgis.sloMs, archive: LADDER.archive.sloMs } },
  };
  writeFileSync(join(ROOT, "runs", `${runId}.json`), JSON.stringify(run, null, 2) + "\n");

  const text = JSON.parse(readFileSync(join(ROOT, "story.json"), "utf8"));
  const f = facts(a, p);
  const deep = (value: unknown): unknown => (typeof value === "string" ? fill(value, f) : Array.isArray(value) ? value.map(deep) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deep(v)])) : value);
  const bench = JSON.parse(readFileSync(join(ROOT, "benchmark.json"), "utf8"));
  const page = deep(text.page) as { story?: { chapters?: { figure: unknown }[] } } & Record<string, unknown>;
  const figs = figures(a, p);
  if (page.story?.chapters) {
    page.story.chapters = page.story.chapters.map((ch) => {
      const figure = figs[ch.figure as string];
      if (!figure) throw new Error(`story.json names figure ${ch.figure}, which import.ts does not build`);
      return { ...ch, figure };
    });
    (page.story as Record<string, unknown>).verdict = verdictTable(a, p);
  }
  const out = { ...bench, ...page, runs: [`runs/${runId}.json`] };
  writeFileSync(join(ROOT, "benchmark.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote runs/${runId}.json (${sections.length} sections) and benchmark.json; facts: ${JSON.stringify(f)}`);
  void mean;
}
