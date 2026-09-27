import { describe, expect, test } from "bun:test";
import { CANDIDATES, candidate, walkPaths } from "../src/matrix";
import { parseOha } from "../src/oha";
import { flight, userFlight, viewTiles } from "../src/session-plan";

describe("matrix", () => {
  test("every candidate id is unique and families have the Martin pair", () => {
    const ids = CANDIDATES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["martin-2", "martin-1", "martin-2-pmtiles", "martin-1-pmtiles", "martin-2-mbtiles", "martin-1-mbtiles"]) expect(candidate(id).server).toBe("martin");
  });

  test("the walk is 256 distinct tiles in a fixed order", () => {
    const a = walkPaths(candidate("go-pmtiles"));
    expect(a.length).toBe(256);
    expect(new Set(a).size).toBe(256);
    expect(walkPaths(candidate("go-pmtiles"))).toEqual(a);
  });

  test("ldproxy is addressed z/row/col", () => {
    expect(candidate("ldproxy").tilePath("buildings", { z: 14, x: 8802, y: 5371 })).toBe("/bench/collections/buildings/tiles/WebMercatorQuad/14/5371/8802");
  });
});

describe("session plan", () => {
  test("a 1920x1080 view over 512 px tiles covers 4 to 6 columns and 3 to 4 rows", () => {
    for (const view of flight("archive")) {
      const tiles = viewTiles(view);
      const xs = new Set(tiles.map((t) => t.x));
      const ys = new Set(tiles.map((t) => t.y));
      expect(xs.size).toBeGreaterThanOrEqual(4);
      expect(xs.size).toBeLessThanOrEqual(6);
      expect(ys.size).toBeGreaterThanOrEqual(3);
      expect(ys.size).toBeLessThanOrEqual(4);
    }
  });

  test("archive street-level views stay inside the walk block, where every tile exists", () => {
    for (const view of flight("archive").filter((v) => v.zoom === 14)) {
      for (const t of viewTiles(view)) {
        expect(t.x).toBeGreaterThanOrEqual(8794);
        expect(t.x).toBeLessThanOrEqual(8809);
        expect(t.y).toBeGreaterThanOrEqual(5366);
        expect(t.y).toBeLessThanOrEqual(5381);
      }
    }
  });

  test("users start at different views", () => {
    expect(userFlight("archive", 0, 10)[0]).not.toEqual(userFlight("archive", 5, 10)[0]);
    expect(userFlight("archive", 0, 1)).toEqual(flight("archive"));
  });
});

describe("oha", () => {
  test("deadline aborts are not errors", () => {
    const pass = parseOha(
      JSON.stringify({
        summary: { total: 12, slowest: 0.01, fastest: 0.001, average: 0.002, requestsPerSec: 1000, sizePerRequest: 100 },
        latencyPercentiles: { p50: 0.002, p90: 0.003, p99: 0.005, "p99.9": 0.008 },
        statusCodeDistribution: { "200": 1000, "500": 2 },
        errorDistribution: { "aborted due to deadline": 7, "connection reset": 1 },
      }),
    );
    expect(pass.success).toBe(1000);
    expect(pass.completed).toBe(1002);
    expect(pass.transportErrors).toBe(1);
    expect(pass.abortedAtDeadline).toBe(7);
    expect(pass.p999Ms).toBe(8);
  });
});
