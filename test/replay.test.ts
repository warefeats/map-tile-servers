import { describe, expect, test } from "bun:test";
import { addLine, aliasTable, BERLIN, buildModel, emptyListed, localize, MAX_TAIL_PER_TILE, mulberry32, PLANET, regionTileCount, sampler, vectorTileOf } from "../src/replay";

describe("vectorTileOf", () => {
  test("moves a raster tile one zoom down", () => {
    expect(vectorTileOf(15, 17605, 10743)).toEqual({ z: 14, x: 8802, y: 5371 });
  });
  test("drops raster z0, which has no parent", () => {
    expect(vectorTileOf(0, 0, 0)).toBeNull();
  });
  test("folds deeper zooms into the zoom-14 tile a vector map overzooms", () => {
    // raster z18 → vector z17 → three zooms up to z14
    expect(vectorTileOf(18, 140838, 85944)).toEqual({ z: 14, x: 8802, y: 5371 });
  });
});

describe("addLine", () => {
  test("sums children into their vector tile and keeps direct and folded demand apart", () => {
    const l = emptyListed();
    for (const line of ["15/17605/10743 30", "15/17604/10742 20", "16/35210/21486 5", "0/0/0 99"]) addLine(l, line, PLANET);
    expect(l.counts[14]!.get(8802 * 2 ** 14 + 5371)).toBe(55);
    expect(l.direct[14]).toBe(50);
    expect(l.folded[14]).toBe(5);
    expect(l.dropped).toBe(99);
    expect(l.lines).toBe(4);
  });
  test("skips tiles outside the region", () => {
    const l = emptyListed();
    addLine(l, "15/17605/10743 30", BERLIN); // Berlin
    addLine(l, "15/16374/10896 30", BERLIN); // near Greenwich
    expect(l.counts[14]!.size).toBe(1);
  });
});

describe("localize", () => {
  const lines = ["1/0/0 1000", "10/550/334 100", "10/0/0 900"]; // the world tile; a Berlin z9 tile; a z9 tile far away

  test("scales a city's low zooms to the city's share of the world's local-zoom demand", () => {
    const l = emptyListed();
    for (const line of lines) addLine(l, line, BERLIN);
    expect(localize(l, BERLIN)).toBeCloseTo(0.1); // Berlin has 100 of the world's 1,000 z9 requests
    expect(l.counts[0]!.get(0)).toBeCloseTo(100); // the world tile keeps a tenth of its demand
    expect(l.direct[0]).toBeCloseTo(100);
    expect(l.counts[9]!.get(275 * 2 ** 9 + 167)).toBe(100); // local zooms are untouched
  });

  test("leaves the planet alone", () => {
    const l = emptyListed();
    for (const line of lines) addLine(l, line, PLANET);
    expect(localize(l, PLANET)).toBeNull();
    expect(l.counts[0]!.get(0)).toBe(1000);
  });
});

describe("buildModel", () => {
  const listed = () => {
    const l = emptyListed();
    addLine(l, "1/0/0 900", PLANET); // vector z0, 900 requests
    addLine(l, "3/1/1 100", PLANET); // vector z2, 100 requests
    return l;
  };

  test("makes the tail its share of all requests, spread by each zoom's unlisted tiles", () => {
    const m = buildModel(listed(), PLANET, 0.2, 0.05);
    expect(m.listedRequests).toBe(1000);
    expect(m.tailWanted).toBeCloseTo(250);
    // z1 has 4 unlisted tiles and z2 has 15, so z0 gets nothing and the rest splits 4:15 (deeper zooms dilute it further)
    const z1 = m.zooms[1]!;
    const z2 = m.zooms[2]!;
    expect(m.zooms[0]!.tailRequests).toBe(0);
    expect(z2.tailRequests / z1.tailRequests).toBeCloseTo(15 / 4);
    expect(m.tailRequests).toBeCloseTo(250);
  });

  test("caps the tail at MAX_TAIL_PER_TILE per unlisted tile", () => {
    const l = emptyListed();
    addLine(l, "15/17605/10743 1000000", BERLIN);
    const m = buildModel(l, BERLIN, 0.5, 0.05);
    for (const z of m.zooms) expect(z.tailRequests).toBeLessThanOrEqual(MAX_TAIL_PER_TILE * z.unlistedTiles + 1e-9);
    expect(m.tailRequests).toBeLessThan(m.tailWanted);
  });

  test("misses come from the tail first, then from the least popular listed tiles", () => {
    const fromTail = buildModel(listed(), PLANET, 0.2, 0.05);
    expect(fromTail.missRequests).toBeCloseTo(0.05 * fromTail.totalRequests);
    expect(fromTail.missListed).toEqual([]);
    // tail tiles are equally popular, so every tail zoom passes on the same fraction
    const fractions = fromTail.zooms.filter((z) => z.tailRequests > 0).map((z) => z.missTailRequests / z.tailRequests);
    for (const f of fractions) expect(f).toBeCloseTo(fractions[0]!);

    const l = emptyListed();
    addLine(l, "15/17605/10743 1000", BERLIN); // 14/8802/5371
    addLine(l, "15/17607/10743 10", BERLIN); // 14/8803/5371
    const m = buildModel(l, BERLIN, 0, 0.5);
    expect(m.tailRequests).toBe(0);
    expect(m.missListed[0]!.requests).toBe(10);
    expect(m.missRequests).toBeCloseTo(0.5 * m.totalRequests);
  });
});

describe("sampling", () => {
  test("the alias table draws in proportion to the weights", () => {
    const pick = aliasTable([1, 3, 6]);
    const rand = mulberry32(7);
    const hits = [0, 0, 0];
    for (let i = 0; i < 100_000; i++) hits[pick(rand)]! += 1;
    expect(hits[0]! / 100_000).toBeCloseTo(0.1, 2);
    expect(hits[2]! / 100_000).toBeCloseTo(0.6, 2);
  });

  test("a seed gives the same list every time, and tail draws avoid listed tiles", () => {
    const l = emptyListed();
    addLine(l, "15/17605/10743 50", BERLIN);
    const m = buildModel(l, BERLIN, 0.3, 0.05);
    const a = sampler(l, m, "alone", 42);
    const b = sampler(l, m, "alone", 42);
    const drawn = Array.from({ length: 1000 }, () => a());
    expect(drawn).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(drawn).toContain("14/8802/5371");
    const tail = drawn.filter((t) => t !== "14/8802/5371");
    expect(tail.length).toBeGreaterThan(0);
  });

  test("the CDN scenario draws only misses", () => {
    const l = emptyListed();
    addLine(l, "15/17605/10743 1000", BERLIN); // 14/8802/5371, popular: the CDN holds it
    addLine(l, "15/17607/10743 10", BERLIN); // 14/8803/5371, the least popular: it misses
    const m = buildModel(l, BERLIN, 0, 0.005);
    const draw = sampler(l, m, "cdn", 1);
    expect(new Set(Array.from({ length: 200 }, () => draw()))).toEqual(new Set(["14/8803/5371"]));
  });

  test("Berlin's box at z14 is a few hundred tiles; the planet's is the whole grid", () => {
    expect(regionTileCount(BERLIN, 14)).toBeGreaterThan(500);
    expect(regionTileCount(BERLIN, 14)).toBeLessThan(1000);
    expect(regionTileCount(PLANET, 14)).toBe(4 ** 14);
  });
});
