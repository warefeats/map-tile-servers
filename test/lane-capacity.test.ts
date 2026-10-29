import { describe, expect, test } from "bun:test";
import { findCapacity, held, type StepOutcome } from "../src/lane/capacity";

/** A server that holds every rate up to `limit` and nothing above it. */
const server = (limit: number) => async (rps: number): Promise<StepOutcome> => ({ offeredRps: rps, achievedRps: rps, p99Ms: rps <= limit ? 10 : 80, errorRate: 0, held: rps <= limit });

const opts = { startRps: 1000, maxRps: 128_000, minRps: 125, bisections: 3 };

describe("held", () => {
  test("needs p99 within the target, under 0.1% errors and 95% of the rate", () => {
    expect(held(1000, 990, 49, 0.0005, 50)).toBe(true);
    expect(held(1000, 990, 51, 0, 50)).toBe(false);
    expect(held(1000, 990, 10, 0.002, 50)).toBe(false);
    expect(held(1000, 940, 10, 0, 50)).toBe(false);
    expect(held(1000, 990, null, 0, 50)).toBe(false);
  });
});

describe("findCapacity", () => {
  test("doubles, then bisects to within an eighth of the last doubling", async () => {
    const c = await findCapacity(server(21_000), opts);
    // doubles 1k..16k held, 32k fails; bisects 24k (fail), 20k (held), 22k (fail)
    expect(c.capacityRps).toBe(20_000);
    expect(c.steps.map((s) => s.offeredRps)).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 24000, 20000, 22000]);
    expect(21_000 - c.capacityRps).toBeLessThanOrEqual((32_000 - 16_000) / 8);
    expect(c.atCeiling).toBe(false);
  });

  test("searches down when the first rate fails", async () => {
    const c = await findCapacity(server(300), opts);
    expect(c.capacityRps).toBeGreaterThanOrEqual(250);
    expect(c.capacityRps).toBeLessThanOrEqual(300);
  });

  test("reports 0 when nothing is held down to the minimum", async () => {
    const c = await findCapacity(server(50), opts);
    expect(c.capacityRps).toBe(0);
  });

  test("says when it stopped at the ceiling", async () => {
    const c = await findCapacity(server(1e9), opts);
    expect(c.capacityRps).toBe(128_000);
    expect(c.atCeiling).toBe(true);
  });
});
