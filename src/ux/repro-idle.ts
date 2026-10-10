#!/usr/bin/env bun
/**
 * Does MapLibre stop short of `idle` when tiles fail with something other than 404? A local tile
 * server answers the Berlin archive's tiles and every missing tile with one status; the map opens
 * over the region at z5 (most of its tiles are missing) on a throttled connection; if idle does not
 * come, the page reports every in-view tile that is neither loaded nor errored.
 *
 *   bun run src/ux/repro-idle.ts [--missing=500|404|204] [--gl=5|6] [--latency=60] [--tries=5]
 */
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { launchBrowser, newSession } from "./record";
import { archiveStyle, startPageServer } from "./serve";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k!, v ?? "true"];
  }),
);
const missing = Number(args.missing ?? 500);
const gl = args.gl ?? "5";
const latency = Number(args.latency ?? 60);
const tries = Number(args.tries ?? 5);
const ROOT = join(import.meta.dirname!, "..", "..");

const db = new Database(join(ROOT, "data", "cache", "berlin.mbtiles"), { readonly: true });
const tile = db.query<{ tile_data: Uint8Array }, [number, number, number]>("SELECT tile_data FROM tiles WHERE zoom_level = ?1 AND tile_column = ?2 AND tile_row = ?3");
const tiles = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(req) {
    const m = new URL(req.url).pathname.match(/^\/(\d+)\/(\d+)\/(\d+)$/);
    if (!m) return new Response("not found", { status: 404 });
    const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const row = tile.get(z, x, (1 << z) - 1 - y);
    const headers = { "Access-Control-Allow-Origin": "*" };
    if (!row) return new Response(missing === 204 ? null : "missing", { status: missing, headers });
    return new Response(new Uint8Array(row.tile_data), { headers: { ...headers, "Content-Type": "application/x-protobuf", "Content-Encoding": "gzip" } });
  },
});

const pages = startPageServer();
const style = pages.publishStyle("repro", archiveStyle(pages.origin, `http://127.0.0.1:${tiles.port}/{z}/{x}/{y}`));
const cfg = Buffer.from(JSON.stringify({ style, view: { lon: 13.405, lat: 52.52, zoom: 5 } })).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const url = `${pages.origin}/${gl === "6" ? "index6.html" : ""}?cfg=${cfg}`;
const browser = await launchBrowser();
let hung = 0;
for (let i = 1; i <= tries; i++) {
  const session = await newSession(browser, { id: "repro", title: "repro", throttle: { latencyMs: latency, downloadBps: 9_000_000 / 8, uploadBps: 1_500_000 / 8 } });
  await session.page.goto(url);
  const idle = await session.page
    .waitForFunction(() => (window as unknown as { ux?: { marks: { idle?: number } } }).ux?.marks.idle !== undefined, null, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (idle) {
    console.log(`try ${i}: idle`);
  } else {
    hung++;
    // What the map reports through its public API, then every tile it still waits on, from whichever internal tile cache this version keeps.
    const stuck = await session.page.evaluate(() => {
      type Tile = { state: string; tileID: { canonical: { z: number; x: number; y: number } } };
      const map = (window as unknown as { ux: { map: { loaded(): boolean; areTilesLoaded(): boolean; isStyleLoaded(): boolean; isSourceLoaded(id: string): boolean; style: Record<string, unknown> & { stylesheet?: { sources: Record<string, unknown> } } } } }).ux.map;
      const sources = Object.keys(map.style.stylesheet?.sources ?? {});
      const managers: { key: string; id: string; pending: string[] }[] = [];
      for (const [key, value] of Object.entries(map.style)) {
        if (!value || typeof value !== "object") continue;
        for (const [id, m] of Object.entries(value as Record<string, unknown>)) {
          const tiles = (m as { _tiles?: Record<string, Tile> } | null)?._tiles;
          if (!tiles || typeof tiles !== "object") continue;
          managers.push({ key, id, pending: Object.values(tiles).filter((t) => t.state !== "loaded" && t.state !== "errored").map((t) => `${t.tileID.canonical.z}/${t.tileID.canonical.x}/${t.tileID.canonical.y}:${t.state}`) });
        }
      }
      return { loaded: map.loaded(), tilesLoaded: map.areTilesLoaded(), styleLoaded: map.isStyleLoaded(), sources: Object.fromEntries(sources.map((id) => [id, map.isSourceLoaded(id)])), managers };
    });
    console.log(`try ${i}: NO IDLE in 20 s`, JSON.stringify(stuck));
  }
  await session.context.close();
}
console.log(`gl ${gl}, missing tiles answered ${missing}, ${latency} ms latency: ${hung} of ${tries} never went idle`);
await browser.close();
pages.stop();
tiles.stop(true);
