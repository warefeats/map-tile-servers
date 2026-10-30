import { describe, expect, test } from "bun:test";
import { addLine, aliasTable, BERLIN, buildModel, emptyListed, inBitmap, localize, MAX_TAIL_PER_TILE, mulberry32, PLANET, regionTileCount, ringOf, sampler, vectorTileOf } from "../src/replay";

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

describe("the tail's ring", () => {
  // a 3 x 3 block of listed tiles at vector z10
  const block = () => {
    const l = emptyListed();
    for (let x = 500; x <= 502; x++) for (let y = 300; y <= 302; y++) l.counts[10]!.set(x * 1024 + y, 100);
    return l;
  };

  test("is the fewest unlisted tiles nearest the listed ones that hold the tail at MAX_TAIL_PER_TILE a tile", () => {
    // one step out is 5 x 5 less the block (16 tiles), two steps out 7 x 7 less the block (40)
    expect(ringOf(block(), PLANET, 10, 16 * MAX_TAIL_PER_TILE)).toMatchObject({ radius: 1, tiles: 16 });
    expect(ringOf(block(), PLANET, 10, 17 * MAX_TAIL_PER_TILE)).toMatchObject({ radius: 2, tiles: 40 });
    const ring = ringOf(block(), PLANET, 10, 30 * MAX_TAIL_PER_TILE).bitmap;
    expect(inBitmap(ring, 498, 298)).toBe(true);
    expect(inBitmap(ring, 501, 301)).toBe(false); // listed
    expect(inBitmap(ring, 497, 301)).toBe(false); // three steps out
  });

  test("wraps across the antimeridian on the planet, but not past a pole or a city's box", () => {
    const l = emptyListed();
    l.counts[10]!.set(0 * 1024 + 512, 100); // x 0, mid-latitude
    l.counts[10]!.set(600 * 1024 + 0, 100); // y 0, the top row
    const ring = ringOf(l, PLANET, 10, 1);
    expect(ring.radius).toBe(1);
    expect(inBitmap(ring.bitmap, 1023, 512)).toBe(true);
    // 8 neighbours for the first tile, 5 for the one on the top row
    expect(ring.tiles).toBe(8 + 5);
    const city = emptyListed();
    city.counts[14]!.set(8802 * 2 ** 14 + 5371, 100);
    const all = ringOf(city, BERLIN, 14, 1e9);
    expect(all.tiles).toBe(regionTileCount(BERLIN, 14) - 1);
  });

  test("the model records each zoom's ring, and the tail is drawn only from it", () => {
    const l = emptyListed();
    addLine(l, "15/17605/10743 1000", BERLIN); // 14/8802/5371
    addLine(l, "15/17609/10747 1000", BERLIN); // 14/8804/5373
    const m = buildModel(l, BERLIN, 0.01, 0.05);
    const z14 = m.zooms[14]!;
    expect(z14.ringRadius).toBe(1);
    expect(z14.tailRequests / z14.ringTiles).toBeLessThanOrEqual(MAX_TAIL_PER_TILE);
    const draw = sampler(l, m, "cdn", 3);
    const near = (x: number, y: number) => [[8802, 5371], [8804, 5373]].some(([lx, ly]) => Math.max(Math.abs(x - lx!), Math.abs(y - ly!)) <= 1);
    // the tail alone is smaller than the miss share here, so the least popular listed tile misses too
    const tail = Array.from({ length: 2000 }, () => draw()).filter((t) => t.startsWith("14/") && t !== "14/8802/5371" && t !== "14/8804/5373");
    expect(tail.length).toBeGreaterThan(0);
    for (const t of tail) {
      const [, x, y] = t.split("/").map(Number);
      expect(near(x!, y!)).toBe(true);
    }
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
