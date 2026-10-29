import { describe, expect, test } from "bun:test";
import type { OhaPass } from "../src/oha";
import { answered, busyShare, clientBoundAt, connections, parseCpu, stepOf } from "../src/lane/unit";

const pass = (codes: Record<string, number>, p99Ms: number, transportErrors = 0): OhaPass => ({ completed: Object.values(codes).reduce((a, b) => a + b, 0), success: 0, transportErrors, abortedAtDeadline: 0, statusCodes: codes, errorDistribution: {}, meanMs: 1, p50Ms: 1, p90Ms: 2, p99Ms, p999Ms: p99Ms, maxMs: p99Ms, requestsPerSec: 0, durationS: 20, bytesPerRequest: 50_000 });

describe("the lane's client", () => {
  test("counts empty tiles as answers and 5xx as errors", () => {
    expect(answered({ "200": 90, "204": 5, "404": 4, "500": 1 })).toBe(99);
  });

  test("a step is held when p99, errors and the delivered rate all pass", () => {
    const s = stepOf(1000, pass({ "200": 19_990, "404": 10 }, 12), 20, 50);
    expect(s.achievedRps).toBe(1000);
    expect(s.errorRate).toBe(0);
    expect(s.held).toBe(true);
    expect(stepOf(1000, pass({ "200": 19_900, "500": 100 }, 12), 20, 50).held).toBe(false); // 0.5% errors
    expect(stepOf(1000, pass({ "200": 20_000 }, 60), 20, 50).held).toBe(false); // p99 over the target
  });

  test("sizes connections to the rate, within bounds", () => {
    expect(connections(1000)).toBe(32);
    expect(connections(40_000)).toBe(200);
    expect(connections(1_000_000)).toBe(1024);
  });

  test("reads the client's CPU the way the server's sampler does", () => {
    const before = parseCpu("cpu  100 0 50 800 10 0 5 0 0 0\ncpu0 1 2 3");
    const after = parseCpu("cpu  400 0 150 900 10 0 25 0 0 0\n");
    expect(before).toEqual({ busy: 155, total: 965 });
    expect(busyShare(before, after)).toBeCloseTo(420 / 520, 6);
    expect(busyShare(null, after)).toBeNull();
  });

  test("names the lowest rate the client failed while it was busy", () => {
    const step = (rps: number, held: boolean, clientCpu: number | null) => ({ ...stepOf(rps, pass({ "200": rps * 20 }, held ? 10 : 90), 20, 50), clientCpu });
    expect(clientBoundAt([step(1000, true, 0.2), step(2000, false, 0.5)])).toBeNull();
    expect(clientBoundAt([step(1000, true, 0.95), step(4000, false, 0.97), step(2000, false, 0.92)])).toBe(2000);
  });
});
