import { describe, expect, test } from "bun:test";
import { bootstrapMean, bootstrapRatio, CATEGORIES, verdictFor } from "../src/analysis";
import type { CandidateResult } from "../src/run";

function result(id: string, walkRps: number[], cpu: number[]): CandidateResult {
  return {
    id,
    image: "x",
    imageDigest: "x",
    startedAt: "2026-09-26T00:00:00Z",
    durationS: 1,
    hostLoad: { before: [0, 0, 0], vmBefore: [0, 0, 0] },
    walk: { connections: 10, tiles: 256, samplesRps: walkRps, samplesP99Ms: [], rps: 0, p50Ms: null, p99Ms: null, errorRate: 0, completed: 0, transportErrors: 0, statusCodes: {}, errorDistribution: {}, bytesPerRequest: null, cpu: null, samplesCpuUs: cpu, engineCores: 0 },
  };
}

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

describe("verdict", () => {
  const walk = CATEGORIES.find((c) => c.id === "walk")!;
  const cpu = CATEGORIES.find((c) => c.id === "cpu")!;

  test("a clear, large lead is a handy win", () => {
    const rs = [
      result("martin-2-pmtiles", [100, 101, 99, 100], [40, 41, 39, 40]),
      result("martin-1-pmtiles", [50, 51, 49, 50], [80, 81, 79, 80]),
      result("go-pmtiles", [20, 21, 19, 20], [500, 510, 490, 500]),
    ];
    const v = verdictFor("archive", walk, rs, []);
    expect(v.winnerId).toBe("martin-2-pmtiles");
    expect(v.handily).toBe(true);
    expect(v.versus1[0]?.call).toBe("much faster");
    const c = verdictFor("archive", cpu, rs, []);
    expect(c.handily).toBe(true);
    expect(c.versus1[0]!.speedup).toBeCloseTo(2, 1);
  });

  test("a lead inside the noise is not a handy win", () => {
    const rs = [result("martin-2-pmtiles", [100, 140, 60, 120], [1]), result("go-pmtiles", [95, 130, 70, 110], [1])];
    const v = verdictFor("archive", walk, rs, []);
    expect(v.winnerId).toBe("martin-2-pmtiles");
    expect(v.handily).toBe(false);
  });

  test("losing to a competitor names it", () => {
    const rs = [result("martin-2-pmtiles", [50, 51, 49, 50], [1]), result("go-pmtiles", [100, 101, 99, 100], [1])];
    const v = verdictFor("archive", walk, rs, []);
    expect(v.handily).toBe(false);
    expect(v.why).toContain("go-pmtiles");
  });
});
