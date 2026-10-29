import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePrices } from "../src/cost";
import type { UnitRecord } from "../src/lane/orchestrate";
import { catalogRows, interval, markdown, measurementOf, networkCap, parseSamples, rankings, ranks, readRun, type ScenarioRecord, scenarioWindow, windowStats } from "../src/lane/report";
import { MISS_SHARE } from "../src/replay";

const prices = parsePrices(JSON.parse(readFileSync("prices/aws-us-east-1-2026-10-29.json", "utf8")));

const record = (over: Partial<UnitRecord> = {}): UnitRecord => ({
  id: "martin-2-pmtiles-berlin-arm64", pass: 1, server: "martin-2", version: "2.0.0-beta.4", stable: false, format: "pmtiles", dataset: "berlin", arch: "arm64",
  placementGroup: "pg", serverHost: null, clientHost: null, dataSeconds: 1, readyMs: { alone: 900, cdn: 850 }, results: {}, catalog: null,
  log: ["2026-10-30T10:00:00.000Z start-alone Success", "2026-10-30T10:10:00.000Z alone Success", "2026-10-30T10:11:00.000Z start-cdn Success", "2026-10-30T10:20:00.000Z cdn Success"],
  error: null, startedAt: "", finishedAt: "", ...over,
});

const scenario = (s: "alone" | "cdn", capacityRps: number, bytesPerTile: number, over: Partial<ScenarioRecord> = {}): ScenarioRecord => ({
  server: "martin-2", version: "2.0.0-beta.4", scenario: s, firstView: { wallMs: 40, statuses: { "200": 12 } }, users: [], capacity: { capacityRps, atCeiling: false }, clientBoundAtRps: null, bytesPerTile, p99AtCapacityMs: 20, ...over,
});

describe("the lane's report", () => {
  test("caps capacity at what the sustained network rate carries", () => {
    expect(networkCap(1.875, 82_000)).toBeCloseTo(2858.2, 1);
    const m = measurementOf(record(), scenario("alone", 32_000, 82_000), prices, [], null);
    expect(m.networkBound).toBe(true);
    expect(m.capacityRps).toBeCloseTo(2858.2, 1);
    // a million tiles of 82 kB sent to the internet, and the instance's time at the capped rate
    expect(m.cost!.egress).toBeCloseTo(82 * 0.09, 6);
    expect(m.cost!.instance).toBeCloseTo((0.15952 * 1e6) / (2858.23 * 3600), 5);
  });

  test("prices CloudFront's bytes from the whole replay and the origin's time from the misses", () => {
    const m = measurementOf(record(), scenario("cdn", 500, 30_000), prices, [], 82_000);
    expect(m.capacityRps).toBe(500);
    expect(m.cost!.cdnEgress).toBeCloseTo(82 * 0.085, 6);
    expect(m.cost!.cdnRequests).toBe(1);
    expect(m.cost!.originInstance).toBeCloseTo(((0.15952 * 1e6) / (500 * 3600)) * MISS_SHARE, 6);
    expect(measurementOf(record(), scenario("cdn", 500, 30_000), prices, [], null).cost).toBeNull();
  });

  test("reads the sampler and counts the allowance counters' growth within a scenario", () => {
    const samples = parseSamples(["1761818390 anon=100 file=5 cpu=10/100 bw_out_allowance_exceeded:3 pps_allowance_exceeded:0", "1761818410 anon=900 file=7 cpu=50/200 bw_out_allowance_exceeded:10 pps_allowance_exceeded:2", "1761818420 anon=400 cpu=60/300 bw_out_allowance_exceeded:12 pps_allowance_exceeded:2", "garbage"].join("\n"));
    expect(samples).toHaveLength(3);
    expect(windowStats(samples, 1761818400, 1761818420)).toEqual({ allowanceExceeded: { bw_out_allowance_exceeded: 9, pps_allowance_exceeded: 2 }, peakAnonBytes: 900 });
    expect(scenarioWindow(record(), "cdn")).toEqual([Date.parse("2026-10-30T10:11:00Z") / 1000, Date.parse("2026-10-30T10:20:00Z") / 1000]);
    expect(scenarioWindow(record({ log: [] }), "alone")).toBeNull();
  });

  test("intervals over passes, and ranks that tie where they overlap", () => {
    const i = interval([1, 2, 3])!;
    expect(i.mean).toBe(2);
    expect(i.lo).toBeCloseTo(2 - 4.303 / Math.sqrt(3), 6);
    expect(interval([5])).toEqual({ n: 1, mean: 5, lo: null, hi: null });
    const r = ranks(new Map([["a", { n: 3, mean: 1, lo: 0.9, hi: 1.1 }], ["b", { n: 3, mean: 1.2, lo: 1.0, hi: 1.4 }], ["c", { n: 3, mean: 2, lo: 1.8, hi: 2.2 }]]));
    expect([...r.entries()]).toEqual([["a", 1], ["b", 1], ["c", 3]]);
  });

  test("reads a run's records into rankings and a table", () => {
    const dir = mkdtempSync(join(tmpdir(), "lane-report-"));
    for (const [pass, server, bytes] of [[1, "martin-2", 80_000], [2, "martin-2", 80_100], [1, "go-pmtiles", 90_000], [2, "go-pmtiles", 90_100]] as const) {
      const unit = join(dir, `p${pass}`, `${server}-pmtiles-berlin-arm64`);
      mkdirSync(unit, { recursive: true });
      writeFileSync(join(unit, "unit.json"), JSON.stringify(record({ id: `${server}-pmtiles-berlin-arm64`, pass, server, stable: server !== "martin-2", version: server === "martin-2" ? "2.0.0-beta.4" : "1.31.2", catalog: { firstMs: 100 + pass, lastMs: server === "go-pmtiles" && pass === 2 ? null : 200 } })));
      writeFileSync(join(unit, "alone.json"), JSON.stringify(scenario("alone", 20_000, bytes, { server })));
      writeFileSync(join(unit, "cdn.json"), JSON.stringify(scenario("cdn", 600, 20_000, { server })));
    }
    const ms = readRun(dir, prices);
    const rs = rankings(ms);
    const catalog = catalogRows(ms);
    expect(catalog.map((c) => [c.server, c.firstMs?.mean, c.lastMs?.mean, c.neverServed])).toEqual([["go-pmtiles", 101.5, 200, 1], ["martin-2", 101.5, 200, 0]]);
    expect(rs.map((r) => `${r.dataset}/${r.format}/${r.scenario}/${r.arch}`)).toEqual(["berlin/pmtiles/alone/arm64", "berlin/pmtiles/cdn/arm64"]);
    expect(rs[0]!.entries.map((e) => [e.server, e.rank])).toEqual([["martin-2", 1], ["go-pmtiles", 2]]);
    const md = markdown(rs, prices, catalog);
    expect(md).toContain("| pmtiles | arm64 | go-pmtiles 1.31.2 | 102 | 200 | 1 | 2 |");
    expect(md).toContain("| 1 | martin-2 2.0.0-beta.4 (pre-release) (network-bound) |");
    expect(md).toContain("## berlin, pmtiles, behind a CDN, arm64");
  });
});
