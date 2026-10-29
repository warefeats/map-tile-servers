import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { behindCdn, HOURS_PER_MONTH, originPerMillion, parsePrices, type Prices, serverAlone, serverless } from "../src/cost";

// Round numbers, so every expectation can be checked by hand; the real table lives in prices/.
const p: Prices = {
  date: "test",
  region: "test",
  sources: {},
  ec2PerHour: { small: 0.36 },
  gp3PerGbMonth: 0.073,
  egressPerGb: 0.09,
  cloudfrontPerGb: 0.085,
  cloudfrontHttpsPerMillion: 1,
  lambdaPerGbSecond: { arm64: 0.00001, x86: 0.00002 },
  lambdaPerMillionRequests: 0.2,
  s3GetPerMillion: 0.4,
};

describe("originPerMillion", () => {
  test("charges the instance and its storage for the time a million tiles take", () => {
    // 1,000 tiles/s → a million tiles in 1,000 s = 1/3.6 h
    const o = originPerMillion(p, { instanceType: "small", capacity: 1000, storageGb: 100 });
    expect(o.instance).toBeCloseTo(0.1);
    expect(o.storage).toBeCloseTo(((100 * 0.073) / HOURS_PER_MONTH) * (1 / 3.6));
  });
  test("refuses an instance type the table has no price for", () => {
    expect(() => originPerMillion(p, { instanceType: "big", capacity: 1, storageGb: 0 })).toThrow();
  });
});

describe("serverAlone", () => {
  test("adds the bytes sent to the internet", () => {
    // a million 50 KB tiles = 50 GB = $4.50 at $0.09/GB
    const c = serverAlone(p, { instanceType: "small", capacity: 1000, storageGb: 0 }, 50_000);
    expect(c.egress).toBeCloseTo(4.5);
    expect(c.total).toBeCloseTo(4.6);
  });
});

describe("behindCdn", () => {
  test("every tile pays CloudFront; the origin pays only for its share of misses", () => {
    const c = behindCdn(p, { instanceType: "small", capacity: 1000, storageGb: 0 }, 0.071, 50_000);
    expect(c.cdnRequests).toBe(1);
    expect(c.cdnEgress).toBeCloseTo(4.25);
    expect(c.originInstance).toBeCloseTo(0.1 * 0.071);
    expect(c.total).toBeCloseTo(1 + 4.25 + 0.0071);
  });
});

describe("serverless", () => {
  test("pays Lambda and S3 for the misses only", () => {
    // 71,000 misses: 71,000 invocations ($0.0142) and 71,000 × 0.025 GB-s at $0.00001 ($0.01775); 2 GETs each ($0.0568)
    const c = serverless(p, { lambdaInvocations: 1, lambdaGbSeconds: 0.025, lambdaArch: "arm64", s3Gets: 2 }, 0.071, 50_000);
    expect(c.lambda).toBeCloseTo(0.0142 + 0.01775);
    expect(c.s3).toBeCloseTo(0.0568);
    expect(c.total).toBeCloseTo(1 + 4.25 + 0.0142 + 0.01775 + 0.0568);
  });
});

describe("parsePrices", () => {
  test("reads the committed table", () => {
    const t = parsePrices(JSON.parse(readFileSync(new URL("../prices/aws-us-east-1-2026-10-29.json", import.meta.url), "utf8")));
    expect(t.ec2PerHour["c8g.xlarge"]).toBe(0.15952);
    expect(t.egressPerGb).toBe(0.09);
    expect(Object.keys(t.sources).length).toBeGreaterThan(5);
  });
  test("refuses a table with a missing price", () => {
    expect(() => parsePrices({ date: "x", region: "x", sources: {}, ec2PerHour: {}, lambdaPerGbSecond: { arm64: 1, x86: 1 } })).toThrow(/gp3PerGbMonth/);
  });
});
