import { describe, expect, test } from "bun:test";
import { mulberry32 } from "../src/replay";
import { LANE_SERVERS } from "../src/lane/servers";
import { MAX_VIEW_ZOOM, nextView, runUsers, THINK_MS, thinkMs, viewAt, visibleTiles } from "../src/lane/users";

describe("simulated map users", () => {
  test("start centred on a replay line's tile, which the view shows", () => {
    const v = viewAt("14/8802/5373");
    expect(v.zoom).toBe(14);
    expect(visibleTiles(v)).toContainEqual({ z: 14, x: 8802, y: 5373 });
  });

  test("see one world: copies wrapped, nothing past the poles, each tile once", () => {
    expect(visibleTiles({ lon: 0, lat: 0, zoom: 0 })).toEqual([{ z: 0, x: 0, y: 0 }]);
    const z1 = visibleTiles({ lon: 179, lat: 0, zoom: 1 });
    expect(z1).toHaveLength(4);
    for (const t of z1) expect(t.x >= 0 && t.x < 2 && t.y >= 0 && t.y < 2).toBe(true);
  });

  test("move within the archive's zooms, the poles and one world", () => {
    const rand = mulberry32(1);
    let v = viewAt("2/1/1");
    for (let i = 0; i < 5000; i++) {
      v = nextView(v, rand);
      expect(v.zoom >= 0 && v.zoom <= MAX_VIEW_ZOOM).toBe(true);
      expect(Math.abs(v.lat) <= 85).toBe(true);
      expect(v.lon >= -180 && v.lon < 180).toBe(true);
      for (const t of visibleTiles(v)) expect(t.x >= 0 && t.x < 2 ** t.z && t.y >= 0 && t.y < 2 ** t.z).toBe(true);
    }
  });

  test("think for a while, never past the cap", () => {
    const rand = mulberry32(2);
    const ms = Array.from({ length: 10_000 }, () => thinkMs(rand));
    expect(Math.max(...ms)).toBeLessThanOrEqual(THINK_MS.max);
    expect(ms.reduce((a, b) => a + b, 0) / ms.length).toBeGreaterThan(THINK_MS.mean * 0.9);
  });

  test("load views from a server, each tile once per user", async () => {
    const asked = new Map<string, number>();
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const path = new URL(req.url).pathname;
        asked.set(path, (asked.get(path) ?? 0) + 1);
        return new Response(new Uint8Array(1000));
      },
    });
    try {
      const martin = LANE_SERVERS.find((s) => s.id === "martin-2")!;
      const r = await runUsers({ ...martin, port: server.port! }, "127.0.0.1", "berlin", {}, ["12/2200/1343", "13/4401/2686"], 3, 1.5, 7);
      expect(r.views).toBeGreaterThanOrEqual(3);
      expect(r.failures).toBe(0);
      expect(r.p50Ms).not.toBeNull();
      expect(r.tiles).toBe([...asked.values()].reduce((a, b) => a + b, 0));
      // three users may share a tile, but no user asks twice
      expect(Math.max(...asked.values())).toBeLessThanOrEqual(3);
    } finally {
      server.stop(true);
    }
  });
});
