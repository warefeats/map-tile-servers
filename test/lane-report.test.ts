import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePrices } from "../src/cost";
import type { UnitRecord } from "../src/lane/orchestrate";
import { catalogRows, cpuPerTile, emptyShare, interval, markdown, measurementOf, networkCap, notMeasured, parseSamples, rankings, ranks, readRun, type ScenarioRecord, scenarioWindow, windowStats } from "../src/lane/report";
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

  test("prices the server container's CPU per tile from its own counter over the capacity step", () => {
    const samples = parseSamples(["1761818400.000000000 anon=100 usage_usec=1000000 cpu=1/2", "1761818402.000000000 anon=100 usage_usec=1400000 cpu=1/2", "1761818404.500000000 anon=100 usage_usec=1900000 cpu=1/2"].join("\n"));
    expect(samples.map((x) => x.usageUsec)).toEqual([1_000_000, 1_400_000, 1_900_000]);
    // 900,000 µs over 4.5 s at 1,000 tiles a second
    expect(cpuPerTile(samples, { achievedRps: 1000, fromS: 1761818399, toS: 1761818405 })).toBeCloseTo(200, 6);
    // one sample inside the step is not enough, and a step without a window has none
    expect(cpuPerTile(samples, { achievedRps: 1000, fromS: 1761818401, toS: 1761818403 })).toBeNull();
    expect(cpuPerTile(samples, { achievedRps: 1000 })).toBeNull();
    const steps = [{ offeredRps: 1000, achievedRps: 1000, held: true, fromS: 1761818399, toS: 1761818405 }, { offeredRps: 2000, achievedRps: 1500, held: false, fromS: 1761818405, toS: 1761818410 }];
    expect(measurementOf(record(), { ...scenario("alone", 1000, 30_000), capacity: { capacityRps: 1000, atCeiling: false, steps } }, prices, samples, null).cpuPerTileUs).toBeCloseTo(200, 6);
  });

  test("sets a server's declared empty status beside the others' empty answers", () => {
    expect(emptyShare({ "200": 98, "500": 2 }, 500)).toBeCloseTo(0.02, 9);
    expect(emptyShare({ "200": 97, "204": 3 }, null)).toBeCloseTo(0.03, 9);
    const steps = (codes: Record<string, number>) => [{ offeredRps: 1000, achievedRps: 1000, held: true, statusCodes: codes }];
    const bbox = measurementOf(record({ server: "bbox", version: "0.6.2", stable: true }), { ...scenario("alone", 1000, 80_000, { server: "bbox" }), emptyStatus: 500, capacity: { capacityRps: 1000, atCeiling: false, steps: steps({ "200": 986, "500": 14 }) } }, prices, [], null);
    const martin = measurementOf(record(), { ...scenario("alone", 1000, 80_000), capacity: { capacityRps: 1000, atCeiling: false, steps: steps({ "200": 985, "204": 15 }) } }, prices, [], null);
    expect(bbox.emptyShare).toBeCloseTo(0.014, 9);
    const md = markdown(rankings([bbox, martin]), prices);
    expect(md).toContain("bbox 0.6.2 answers a tile its archive lacks with 500, counted as that empty tile: 1.4% of its answers at capacity, where the others' empty answers are 1.5–1.5%.");
  });

  test("a server that held no rate within the target ranks after the priced ones, marked, with no price", () => {
    const held = measurementOf(record(), scenario("alone", 1000, 80_000), prices, [], null);
    const none = measurementOf(record({ server: "versatiles", version: "5.4.1", stable: true }), { ...scenario("alone", 0, 80_000, { server: "versatiles" }), capacity: { capacityRps: null, atCeiling: false } }, prices, [], null);
    const [r] = rankings([none, held]);
    expect(r!.entries.map((e) => [e.server, e.rank])).toEqual([["martin-2", 1], ["versatiles", null]]);
    expect(markdown([r!], prices)).toContain("| – | versatiles 5.4.1 (held no rate within the target) | – | – | 0 |");
  });

  test("lists what was not measured: units the plan skipped, and units that ended without a result", () => {
    const dir = mkdtempSync(join(tmpdir(), "lane-missing-"));
    writeFileSync(join(dir, "plan.json"), JSON.stringify({ skipped: [{ id: "bbox-mbtiles-planet-amd64", reason: "cannot open the archive" }] }));
    mkdirSync(join(dir, "p1", "versatiles-pmtiles-planet-arm64"), { recursive: true });
    writeFileSync(join(dir, "p1", "versatiles-pmtiles-planet-arm64", "unit.json"), JSON.stringify(record({ id: "versatiles-pmtiles-planet-arm64", error: "setup on i-1: Failed\nno 200 within a minute" })));
    mkdirSync(join(dir, "p1", "martin-2-pmtiles-berlin-arm64"), { recursive: true });
    writeFileSync(join(dir, "p1", "martin-2-pmtiles-berlin-arm64", "unit.json"), JSON.stringify(record()));
    writeFileSync(join(dir, "p1", "martin-2-pmtiles-berlin-arm64", "alone.json"), JSON.stringify(scenario("alone", 1000, 80_000)));
    const missing = notMeasured(dir);
    expect(missing).toEqual([
      { unit: "bbox-mbtiles-planet-amd64", reason: "cannot open the archive", passes: [] },
      { unit: "versatiles-pmtiles-planet-arm64", reason: "setup on i-1: Failed", passes: [1] },
    ]);
    const md = markdown([], prices, [], missing);
    expect(md).toContain("| bbox-mbtiles-planet-amd64 | cannot open the archive | skipped |");
    expect(md).toContain("| versatiles-pmtiles-planet-arm64 | setup on i-1: Failed | 1 |");
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
    expect(md).toContain("| 1 | martin-2 2.0.0-beta.4 (pre-release) | ");
    // the efficiency table beside the ranking: measured before the cap, then priced at the cap
    expect(md).toContain("| martin-2 2.0.0-beta.4 (pre-release) (network-bound) | 20,000 | ");
    expect(md).toContain("## berlin, pmtiles, behind a CDN, arm64");
  });
});
