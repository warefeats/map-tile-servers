import { describe, expect, test } from "bun:test";
import { bootstrapMean, bootstrapRatio, CATEGORIES, type Pass, pooledStrata, verdictFor } from "../src/analysis";
import type { CandidateResult } from "../src/run";

function result(id: string, extra: Partial<CandidateResult> = {}): CandidateResult {
  return { id, image: "x", imageDigest: "x", startedAt: "2026-10-08T00:00:00Z", durationS: 1, hostLoad: { before: [0, 0, 0], vmBefore: [0, 0, 0] }, ...extra };
}

function walk(rps: number[], cpu: number[] = [1], split?: { engineUs: number; dbUs: number }): Partial<CandidateResult> {
  const c = split ? { ...split, totalUs: split.engineUs + split.dbUs } : null;
  return { walk: { connections: 10, tiles: 256, samplesRps: rps, samplesP99Ms: [], rps: 0, p50Ms: null, p99Ms: null, errorRate: 0, completed: 0, transportErrors: 0, statusCodes: {}, errorDistribution: {}, bytesPerRequest: null, cpu: c, samplesCpuUs: cpu, engineCores: 0 } };
}

function burst(samplesMs: number[]): Partial<CandidateResult> {
  return { burst: { samplesMs, meanMs: 0, p50Ms: 0, maxMs: 0, slowestTileMeanMs: 0, errorRate: 0 } };
}

function c10(samplesRps: number[]): Partial<CandidateResult> {
  return { concurrency: { "10": { ...walk(samplesRps).walk!, connections: 10, tiles: 1 } } };
}

const pass = (...results: CandidateResult[]): Pass[] => [{ results, catalog: [] }];
const def = (id: string) => CATEGORIES.find((c) => c.id === id)!;
const around = (x: number, spread = 0.01) => [x * (1 - spread), x, x * (1 + spread), x, x * (1 - spread / 2), x * (1 + spread / 2)];

describe("bootstrap", () => {
  test("interval brackets the mean and is deterministic", () => {
    const a = bootstrapMean([[10, 11, 12, 13, 14, 15]]);
    const b = bootstrapMean([[10, 11, 12, 13, 14, 15]]);
    expect(a).toEqual(b);
    expect(a.mean).toBeCloseTo(12.5);
    expect(a.lo).toBeLessThan(a.mean);
    expect(a.hi).toBeGreaterThan(a.mean);
  });

  test("one sample has a zero-width interval", () => {
    expect(bootstrapMean([[7]])).toEqual({ mean: 7, lo: 7, hi: 7 });
  });

  test("ratio of clearly different samples excludes 1", () => {
    const r = bootstrapRatio([[20, 21, 22, 19]], [[10, 11, 9, 10]]);
    expect(r.ratio).toBeCloseTo(2.05, 1);
    expect(r.lo).toBeGreaterThan(1);
  });
});

describe("outcomes", () => {
  test("a clear, large lead over every rival is won", () => {
    const passes = pass(
      result("martin-2-pmtiles", walk([100, 101, 99, 100], [40, 41, 39, 40])),
      result("martin-1-pmtiles", walk([50, 51, 49, 50], [80, 81, 79, 80])),
      result("go-pmtiles", walk([20, 21, 19, 20], [500, 510, 490, 500])),
    );
    const v = verdictFor("archive", def("walk"), passes);
    expect(v.outcome).toBe("won");
    expect(v.handily).toBe(true);
    expect(v.blocks).toBe(false);
    expect(v.versus1[0]?.call).toBe("much faster");
    const c = verdictFor("archive", def("cpu"), passes);
    expect(c.outcome).toBe("won");
    expect(c.versus1[0]!.speedup).toBeCloseTo(2, 1);
  });

  test("a lead inside the noise is a tie, and a tie blocks outside database-bound categories", () => {
    const v = verdictFor("archive", def("walk"), pass(result("martin-2-pmtiles", walk([100, 140, 60, 120])), result("go-pmtiles", walk([95, 130, 70, 110]))));
    expect(v.outcome).toBe("tie");
    expect(v.blocks).toBe(true);
  });

  test("a rival ahead by the winning standard is a loss and names the rival", () => {
    const v = verdictFor("archive", def("walk"), pass(result("martin-2-pmtiles", walk([50, 51, 49, 50])), result("go-pmtiles", walk([100, 101, 99, 100]))));
    expect(v.outcome).toBe("lost");
    expect(v.why).toContain("go-pmtiles");
    expect(v.margin!).toBeLessThan(0);
  });

  test("1.16.1 is not a rival: a tie with it does not cost 2.0 the category", () => {
    const v = verdictFor(
      "archive",
      def("walk"),
      pass(result("martin-2-pmtiles", walk(around(100, 0.06))), result("martin-1-pmtiles", walk(around(101, 0.06))), result("go-pmtiles", walk(around(50)))),
    );
    expect(v.winnerId).toBe("martin-1-pmtiles");
    expect(v.outcome).toBe("won");
    expect(v.versus1[0]!.call).toBe("no change");
    expect(v.blocks).toBe(false);
  });

  test("being slower than 1.16.1 blocks even a won category", () => {
    const v = verdictFor("archive", def("walk"), pass(result("martin-2-pmtiles", walk(around(100))), result("martin-1-pmtiles", walk(around(130))), result("go-pmtiles", walk(around(50)))));
    expect(v.outcome).toBe("won");
    expect(v.versus1[0]!.call).toBe("slower");
    expect(v.blocks).toBe(true);
  });
});

describe("the harness floor (docs/adr/0007)", () => {
  const passes = pass(result("floor", burst(around(1.43, 0.004))), result("martin-2-pmtiles", burst(around(1.48, 0.004))), result("versatiles-pmtiles", burst(around(1.55, 0.004))));

  test("archive burst is ranked on time above the floor", () => {
    const v = verdictFor("archive", def("burst"), passes);
    expect(v.floor?.mean).toBeCloseTo(1.43, 2);
    expect(v.margin!).toBeCloseTo(0.12 / 0.05 - 1, 1);
    expect(v.outcome).toBe("won");
    expect(v.cells.map((c) => c.candidateId)).not.toContain("floor");
  });

  test("without the control the same numbers are a tie on full times", () => {
    const v = verdictFor("archive", def("burst"), [{ results: passes[0]!.results.filter((r) => r.id !== "floor"), catalog: [] }]);
    expect(v.floor).toBeNull();
    expect(v.outcome).toBe("tie");
  });

  test("throughput is never floored", () => {
    expect(def("walk").floored).toBeFalsy();
    expect(def("c100").floored).toBeFalsy();
  });
});

describe("database-bound ties (docs/adr/0008)", () => {
  const pg = (share: number) =>
    pass(
      result("martin-2", { ...c10(around(470, 0.03)), ...walk([400], [1], { engineUs: 1000 * (1 - share), dbUs: 1000 * share }) }),
      result("pg-tileserv", c10(around(480, 0.03))),
    );

  test("a PostGIS serving category within 10% is a tie that does not block when the database does 90% of the work", () => {
    const v = verdictFor("postgis", def("c10"), pg(0.975));
    expect(v.databaseBound).toBe(true);
    expect(v.outcome).toBe("tie");
    expect(v.blocks).toBe(false);
  });

  test("below 90% the same tie blocks", () => {
    const v = verdictFor("postgis", def("c10"), pg(0.8));
    expect(v.databaseBound).toBe(false);
    expect(v.blocks).toBe(true);
  });

  test("startup is never database-bound", () => {
    expect(def("coldStart").serving).toBeFalsy();
    expect(def("catalog").serving).toBeFalsy();
    expect(def("memory").serving).toBeFalsy();
  });
});

describe("archive memory and pooling", () => {
  test("archive memory is reported whatever its outcome", () => {
    const mem = (anonMb: number) => ({ memMb: anonMb, anonMb, fileMb: 0 });
    const v = verdictFor("archive", def("memory"), pass(result("martin-2-pmtiles", { memoryAfterLoad: mem(5.4), memoryAfterSessions: mem(5.6) }), result("versatiles-pmtiles", { memoryAfterLoad: mem(1.3), memoryAfterSessions: mem(1.4) })));
    expect(v.outcome).toBe("lost");
    expect(v.reportedOnly).toBe(true);
    expect(v.blocks).toBe(false);
  });

  test("two passes pool samples stratum by stratum, and capacity keeps the step held in both", () => {
    const ladder = (capacityRps: number) => ({ ladder: { sloMs: 50, steps: [], capacityRps } });
    const passes: Pass[] = [
      { results: [result("martin-2-pmtiles", { ...walk([1, 2]), ...ladder(64000) })], catalog: [] },
      { results: [result("martin-2-pmtiles", { ...walk([3]), ...ladder(48000) })], catalog: [] },
    ];
    expect(pooledStrata(def("walk"), "martin-2-pmtiles", passes)).toEqual([[1, 2, 3]]);
    expect(pooledStrata(def("capacity"), "martin-2-pmtiles", passes)).toEqual([[48000]]);
  });
});
