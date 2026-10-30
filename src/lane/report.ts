/**
 * The archive lane's report (docs/adr/0011). It reads a run's records and caps each capacity at what the server
 * instance's sustained network rate carries for its bytes per tile. Then it prices a million tiles part by part
 * at the dated list prices and ranks the servers by that price, per dataset, format, scenario and architecture.
 * A difference counts only where the 95% confidence intervals over the passes do not overlap: a server's rank is
 * one more than the number of servers whose interval lies wholly below its own. Behind a CDN, CloudFront sends
 * every tile, so its bytes are the whole replay's, measured from the same server alone. Beside each ranking, unranked,
 * stand the capacity measured before the cap and the server's CPU per tile at it, from the container's own CPU
 * counter over the capacity step. The start with 1,000 more
 * sources is reported beside the rankings, not ranked.
 *   bun run src/lane/report.ts --records=<dir> --prices=prices/aws-us-east-1-2026-10-29.json --out=<dir>
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { behindCdn, type Breakdown, parsePrices, type Prices, serverAlone } from "../cost";
import { MISS_SHARE } from "../replay";
import type { Scenario } from "./client-script";
import type { UnitRecord } from "./orchestrate";
import type { Arch } from "./servers";
import type { UsersResult } from "./users";

export const INSTANCE: Record<Arch, string> = { arm64: "c8g.xlarge", amd64: "c8i.xlarge" };
/** Sustained network rate per instance type (describe-instance-types, us-east-1, 2026-10-29); bursts last minutes. */
export const BASELINE_GBPS: Record<string, number> = { "c8g.xlarge": 1.875, "c8i.xlarge": 1.875 };
/** Each server's gp3 volume (infra/lib/martin-2-bench-stack.ts). */
export const STORAGE_GB = 200;
/** Two-sided 95% Student t for n - 1 degrees of freedom. */
const T95: Record<number, number> = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571 };

/** What src/lane/unit.ts writes for one scenario. */
export interface ScenarioRecord {
  server: string;
  version: string;
  scenario: Scenario;
  firstView: { wallMs: number; statuses: Record<string, number> };
  users: UsersResult[];
  capacity: { capacityRps: number | null; atCeiling: boolean; steps?: { offeredRps: number; achievedRps: number; held: boolean; fromS?: number; toS?: number; statusCodes?: Record<string, number> }[] };
  /** The status the server declares for a tile its archive lacks, where it is not 204 or 404. */
  emptyStatus?: number | null;
  clientBoundAtRps: number | null;
  bytesPerTile: number | null;
  p99AtCapacityMs: number | null;
}

export interface Measurement {
  unit: string;
  pass: number;
  server: string;
  version: string;
  stable: boolean;
  format: string;
  dataset: string;
  arch: Arch;
  scenario: Scenario;
  measuredRps: number | null;
  networkCapRps: number | null;
  /** Capacity as priced: the measured one, or the network's when that is lower. */
  capacityRps: number | null;
  networkBound: boolean;
  /** The client was busy at a rate it failed to carry: the server's capacity may be higher. */
  clientBound: boolean;
  bytesPerTile: number | null;
  p99AtCapacityMs: number | null;
  readyMs: number | null;
  firstViewMs: number | null;
  users: UsersResult[];
  cost: Breakdown | null;
  /** The network card's allowance counters over the scenario, and the server's peak memory. */
  allowanceExceeded: Record<string, number>;
  peakAnonBytes: number | null;
  /** The server container's CPU time per tile over the capacity step; null where fewer than two samples fell in it. */
  cpuPerTileUs: number | null;
  /** The share of the capacity step's answers that were empty tiles, and the status the server declares for one. */
  emptyShare: number | null;
  emptyStatus: number | null;
  /** The unit's catalog start, on its alone measurement only: to the dataset's first tile and to the last source's. */
  catalogFirstMs: number | null;
  catalogLastMs: number | null;
}

/** Tiles a second a sustained rate carries at this size. */
export const networkCap = (gbps: number, bytesPerTile: number) => (gbps * 1e9) / 8 / bytesPerTile;

export interface Sample {
  at: number;
  anon: number | null;
  /** The server container's cumulative CPU time. */
  usageUsec: number | null;
  counters: Record<string, number>;
}

/** The server's sampler: `<epoch> anon=<b> file=<b> usage_usec=<µs> cpu=<busy>/<total> <counter>:<n> ...`. */
export function parseSamples(text: string): Sample[] {
  return text
    .split("\n")
    .filter((l) => /^\d+(\.\d+)? /.test(l))
    .map((l) => {
      const [at, ...fields] = l.trim().split(/\s+/);
      const counters: Record<string, number> = {};
      let anon: number | null = null;
      let usageUsec: number | null = null;
      for (const f of fields) {
        const kv = /^(\w+)[=:](\d+)$/.exec(f);
        if (!kv) continue;
        if (kv[1] === "anon") anon = Number(kv[2]);
        else if (kv[1] === "usage_usec") usageUsec = Number(kv[2]);
        else if (kv[1]!.endsWith("allowance_exceeded")) counters[kv[1]!] = Number(kv[2]);
      }
      return { at: Number(at), anon, usageUsec, counters };
    });
}

/** The share of a step's answers that were empty tiles: 204, 404, or the status the server declares for one. */
export function emptyShare(codes: Record<string, number> | undefined, emptyStatus: number | null | undefined): number | null {
  if (!codes) return null;
  let empty = 0;
  let all = 0;
  for (const [code, n] of Object.entries(codes)) {
    all += n;
    if (code === "204" || code === "404" || code === String(emptyStatus)) empty += n;
  }
  return all ? empty / all : null;
}

/** The server container's CPU time per tile at a step's rate: its counter's growth over the step, per tile served. */
export function cpuPerTile(samples: readonly Sample[], step: { achievedRps: number; fromS?: number; toS?: number } | undefined): number | null {
  if (!step?.fromS || !step.toS || !(step.achievedRps > 0)) return null;
  const inside = samples.filter((s) => s.at >= step.fromS! && s.at <= step.toS! && s.usageUsec !== null);
  const [a, b] = [inside[0], inside.at(-1)];
  if (!a || !b || b.at <= a.at) return null;
  return (b.usageUsec! - a.usageUsec!) / (step.achievedRps * (b.at - a.at));
}

/** Over a window of epoch seconds: each counter's growth, and the peak anonymous memory. */
export function windowStats(samples: readonly Sample[], from: number, to: number): { allowanceExceeded: Record<string, number>; peakAnonBytes: number | null } {
  const before = samples.filter((s) => s.at <= from).at(-1);
  const inside = samples.filter((s) => s.at > from && s.at <= to);
  const last = inside.at(-1);
  const allowanceExceeded: Record<string, number> = {};
  if (before && last) for (const [k, v] of Object.entries(last.counters)) allowanceExceeded[k] = v - (before.counters[k] ?? 0);
  const anon = inside.map((s) => s.anon).filter((a): a is number => a !== null);
  return { allowanceExceeded, peakAnonBytes: anon.length ? Math.max(...anon) : null };
}

/** When a scenario ran on the server: from its cold start's end to the client's end, from the unit's log. */
export function scenarioWindow(rec: Pick<UnitRecord, "log">, scenario: Scenario): [number, number] | null {
  const at = (step: string) => {
    const line = rec.log.find((l) => l.endsWith(` ${step} Success`));
    return line ? Date.parse(line.split(" ")[0]!) / 1000 : null;
  };
  const from = at(`start-${scenario}`);
  const to = at(scenario);
  return from !== null && to !== null ? [from, to] : null;
}

export function measurementOf(rec: UnitRecord, s: ScenarioRecord, prices: Prices, samples: readonly Sample[], aloneBytes: number | null): Measurement {
  const instanceType = INSTANCE[rec.arch];
  const measured = s.capacity.capacityRps;
  const cap = s.bytesPerTile ? networkCap(BASELINE_GBPS[instanceType]!, s.bytesPerTile) : null;
  const capacity = measured !== null && cap !== null ? Math.min(measured, cap) : measured;
  const server = { instanceType, capacity: capacity ?? 0, storageGb: STORAGE_GB };
  let cost: Breakdown | null = null;
  if (capacity && s.bytesPerTile) {
    if (s.scenario === "alone") cost = serverAlone(prices, server, s.bytesPerTile);
    else if (aloneBytes) cost = behindCdn(prices, server, MISS_SHARE, aloneBytes);
  }
  const window = scenarioWindow(rec, s.scenario);
  const stats = window ? windowStats(samples, window[0], window[1]) : { allowanceExceeded: {}, peakAnonBytes: null };
  const atCapacity = s.capacity.steps?.filter((st) => st.held && st.offeredRps === measured).at(-1);
  return {
    unit: rec.id,
    pass: rec.pass,
    server: rec.server,
    version: rec.version,
    stable: rec.stable,
    format: rec.format,
    dataset: rec.dataset,
    arch: rec.arch,
    scenario: s.scenario,
    measuredRps: measured,
    networkCapRps: cap,
    capacityRps: capacity,
    networkBound: measured !== null && cap !== null && cap < measured,
    clientBound: s.clientBoundAtRps !== null,
    bytesPerTile: s.bytesPerTile,
    p99AtCapacityMs: s.p99AtCapacityMs,
    readyMs: rec.readyMs[s.scenario] ?? null,
    firstViewMs: s.firstView?.wallMs ?? null,
    users: s.users ?? [],
    cost,
    ...stats,
    cpuPerTileUs: cpuPerTile(samples, atCapacity),
    emptyShare: emptyShare(atCapacity?.statusCodes, s.emptyStatus),
    emptyStatus: s.emptyStatus ?? null,
    catalogFirstMs: s.scenario === "alone" ? (rec.catalog?.firstMs ?? null) : null,
    catalogLastMs: s.scenario === "alone" ? (rec.catalog?.lastMs ?? null) : null,
  };
}

export interface Interval {
  n: number;
  mean: number;
  /** null with fewer than two passes */
  lo: number | null;
  hi: number | null;
}

export function interval(values: readonly number[]): Interval | null {
  const n = values.length;
  if (!n) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { n, mean, lo: null, hi: null };
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1));
  const half = (T95[n - 1] ?? 1.96) * (sd / Math.sqrt(n));
  return { n, mean, lo: mean - half, hi: mean + half };
}

/** Lower is better. Without intervals every difference counts. */
export function ranks(costs: ReadonlyMap<string, Interval>): Map<string, number> {
  const lo = (i: Interval) => i.lo ?? i.mean;
  const hi = (i: Interval) => i.hi ?? i.mean;
  const out = new Map<string, number>();
  for (const [id, a] of costs) out.set(id, 1 + [...costs.values()].filter((b) => b !== a && hi(b) < lo(a)).length);
  return out;
}

export interface Entry {
  server: string;
  version: string;
  stable: boolean;
  rank: number;
  costPerMillion: Interval;
  capacityRps: Interval | null;
  /** Measured before the network cap, and the server's CPU per tile at it: reported, not ranked. */
  measuredRps: Interval | null;
  cpuPerTileUs: Interval | null;
  emptyStatus: number | null;
  emptyShare: Interval | null;
  bytesPerTile: Interval | null;
  p99AtCapacityMs: Interval | null;
  networkBound: number;
  clientBound: number;
  passes: number[];
}

export interface Ranking {
  dataset: string;
  format: string;
  scenario: Scenario;
  arch: Arch;
  entries: Entry[];
}

const num = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null && Number.isFinite(x));

export function rankings(ms: readonly Measurement[]): Ranking[] {
  const groups = new Map<string, Measurement[]>();
  for (const m of ms) {
    const key = [m.dataset, m.format, m.scenario, m.arch].join("/");
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, group]) => {
      const byServer = new Map<string, Measurement[]>();
      for (const m of group) byServer.set(m.server, [...(byServer.get(m.server) ?? []), m]);
      const costs = new Map<string, Interval>();
      for (const [server, list] of byServer) {
        const c = interval(num(list.map((m) => m.cost?.total ?? null)));
        if (c) costs.set(server, c);
      }
      const rank = ranks(costs);
      const entries = [...costs.entries()].map(([server, costPerMillion]): Entry => {
        const list = byServer.get(server)!;
        return {
          server,
          version: list[0]!.version,
          stable: list[0]!.stable,
          rank: rank.get(server)!,
          costPerMillion,
          capacityRps: interval(num(list.map((m) => m.capacityRps))),
          measuredRps: interval(num(list.map((m) => m.measuredRps))),
          cpuPerTileUs: interval(num(list.map((m) => m.cpuPerTileUs))),
          emptyStatus: list[0]!.emptyStatus,
          emptyShare: interval(num(list.map((m) => m.emptyShare))),
          bytesPerTile: interval(num(list.map((m) => m.bytesPerTile))),
          p99AtCapacityMs: interval(num(list.map((m) => m.p99AtCapacityMs))),
          networkBound: list.filter((m) => m.networkBound).length,
          clientBound: list.filter((m) => m.clientBound).length,
          passes: list.filter((m) => m.cost).map((m) => m.pass),
        };
      });
      entries.sort((a, b) => a.rank - b.rank || a.costPerMillion.mean - b.costPerMillion.mean);
      const m = group[0]!;
      return { dataset: m.dataset, format: m.format, scenario: m.scenario, arch: m.arch, entries };
    });
}

const fmt = (x: number | null | undefined, digits: number) => (x === null || x === undefined ? "–" : x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }));
const ci = (i: Interval | null, digits: number) => (i?.lo !== null && i?.lo !== undefined ? `${fmt(i.lo, digits)}–${fmt(i.hi, digits)}` : "–");

export interface CatalogRow {
  server: string;
  version: string;
  format: string;
  arch: Arch;
  firstMs: Interval | null;
  lastMs: Interval | null;
  /** Passes whose last source never answered within the wait. */
  neverServed: number;
  passes: number;
}

/** The catalog starts, per server, format and architecture (Berlin units run them). */
export function catalogRows(ms: readonly Measurement[]): CatalogRow[] {
  const groups = new Map<string, Measurement[]>();
  for (const m of ms) {
    if (m.scenario !== "alone" || m.dataset !== "berlin") continue;
    const key = [m.format, m.arch, m.server].join("/");
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, list]) => ({
      server: list[0]!.server,
      version: list[0]!.version,
      format: list[0]!.format,
      arch: list[0]!.arch,
      firstMs: interval(num(list.map((m) => m.catalogFirstMs))),
      lastMs: interval(num(list.map((m) => m.catalogLastMs))),
      neverServed: list.filter((m) => m.catalogFirstMs !== null && m.catalogLastMs === null).length,
      passes: list.length,
    }));
}

export function markdown(rs: readonly Ranking[], prices: Prices, catalog: readonly CatalogRow[] = []): string {
  const out = [`# Archive lane`, "", `Dollars per million tiles at AWS list prices of ${prices.date} (${prices.region}); lower is better. A rank is shared unless the 95% confidence intervals over the passes do not overlap. The price takes each server's capacity capped at the instance's sustained network rate (${BASELINE_GBPS["c8g.xlarge"]} Gbps); the measured capacity and the server container's CPU per tile at it stand beside each ranking, unranked.`, ""];
  const label = (e: Entry) => `${e.server} ${e.version}${e.stable ? "" : " (pre-release)"}`;
  for (const r of rs) {
    out.push(`## ${r.dataset}, ${r.format}, ${r.scenario === "alone" ? "server alone" : "behind a CDN"}, ${r.arch}`, "");
    // the ranked question: what a million tiles cost
    out.push("| rank | server | $ per M tiles | 95% CI | passes |", "| --: | :-- | --: | --: | --: |");
    for (const e of r.entries) out.push(`| ${e.rank} | ${label(e)} | ${fmt(e.costPerMillion.mean, 3)} | ${ci(e.costPerMillion, 3)} | ${e.passes.length} |`);
    // reported beside it, not ranked: how hard each server worked for that price
    out.push("", "| server | measured (tiles/s) | priced at (tiles/s) | CPU per tile (µs) | tile (KB) | p99 at capacity (ms) |", "| :-- | --: | --: | --: | --: | --: |");
    for (const e of r.entries) {
      const flags = [e.networkBound ? "network-bound" : "", e.clientBound ? "client-bound" : ""].filter(Boolean).join(", ");
      out.push(`| ${label(e)}${flags ? ` (${flags})` : ""} | ${fmt(e.measuredRps?.mean, 0)} | ${fmt(e.capacityRps?.mean, 0)} | ${fmt(e.cpuPerTileUs?.mean, 0)} | ${fmt(e.bytesPerTile ? e.bytesPerTile.mean / 1000 : null, 1)} | ${fmt(e.p99AtCapacityMs?.mean, 1)} |`);
    }
    out.push("");
    // a server that answers a missing tile with something other than 204 or 404, set beside the others' empty answers
    for (const e of r.entries.filter((x) => x.emptyStatus && x.emptyShare)) {
      const others = r.entries.filter((x) => !x.emptyStatus && x.emptyShare).map((x) => x.emptyShare!.mean * 100);
      const range = others.length ? `, where the others' empty answers are ${fmt(Math.min(...others), 1)}–${fmt(Math.max(...others), 1)}%` : "";
      out.push(`${label(e)} answers a tile its archive lacks with ${e.emptyStatus}, counted as that empty tile: ${fmt(e.emptyShare!.mean * 100, 1)}% of its answers at capacity${range}.`, "");
    }
  }
  if (catalog.length) {
    out.push("## Start with 1,000 more sources (Berlin, reported)", "", "| format | arch | server | first tile (ms) | last source's tile (ms) | never served | passes |", "| :-- | :-- | :-- | --: | --: | --: | --: |");
    for (const c of catalog) out.push(`| ${c.format} | ${c.arch} | ${c.server} ${c.version} | ${fmt(c.firstMs?.mean, 0)} | ${fmt(c.lastMs?.mean, 0)} | ${c.neverServed} | ${c.passes} |`);
    out.push("");
  }
  return out.join("\n");
}

/** Every unit's records under a run's directory: <dir>/p<pass>/<unit>/{unit,alone,cdn}.json and samples.log. */
export function readRun(dir: string, prices: Prices): Measurement[] {
  const ms: Measurement[] = [];
  for (const pass of readdirSync(dir).filter((d) => /^p\d+$/.test(d)).sort()) {
    for (const unit of readdirSync(join(dir, pass)).sort()) {
      const at = (f: string) => join(dir, pass, unit, f);
      if (!existsSync(at("unit.json"))) continue;
      const rec = JSON.parse(readFileSync(at("unit.json"), "utf8")) as UnitRecord;
      const samples = existsSync(at("samples.log")) ? parseSamples(readFileSync(at("samples.log"), "utf8")) : [];
      const scenario = (s: Scenario) => (existsSync(at(`${s}.json`)) ? (JSON.parse(readFileSync(at(`${s}.json`), "utf8")) as ScenarioRecord) : null);
      const alone = scenario("alone");
      const cdn = scenario("cdn");
      if (alone) ms.push(measurementOf(rec, alone, prices, samples, null));
      if (cdn) ms.push(measurementOf(rec, cdn, prices, samples, alone?.bytesPerTile ?? null));
    }
  }
  return ms;
}

if (import.meta.main) {
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const records = arg("records");
  const out = arg("out");
  const pricesFile = arg("prices") ?? "prices/aws-us-east-1-2026-10-29.json";
  if (!records || !out) {
    console.error("usage: report.ts --records=<dir> [--prices=<file>] --out=<dir>");
    process.exit(2);
  }
  const prices = parsePrices(JSON.parse(readFileSync(pricesFile, "utf8")));
  const ms = readRun(records, prices);
  const rs = rankings(ms);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "measurements.json"), `${JSON.stringify(ms, null, 2)}\n`);
  writeFileSync(join(out, "rankings.json"), `${JSON.stringify(rs, null, 2)}\n`);
  writeFileSync(join(out, "report.md"), markdown(rs, prices, catalogRows(ms)));
  console.log(`${ms.length} measurements, ${rs.length} rankings`);
}
