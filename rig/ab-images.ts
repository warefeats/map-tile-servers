/**
 * Interleaved A/B of several Martin 2.0 builds against 1.16.1 on PostGIS: the main run's single-tile
 * protocol per test tile, and the backends that serve 20 back-to-back roads tiles (first round only).
 * Builds come from `--images=label=tag,label=tag`; each runs as the `martin-2` candidate through
 * WF_MARTIN_2_IMAGE. Diagnostic only: the main run stays the verdict.
 *
 *   bun run rig/ab-images.ts --images=base=wf-martin:2.0.0-055d4ea,lane1=wf-martin:2.0.0-lane1 --rounds=3 --out=lane1
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { clientExec, clientUp, dbUp, engineDown, engineUp, ensureNetwork, psql, run, stopAllEngines } from "../src/docker";
import { candidate, type Family, protocol, REQUEST_HEADERS, TILES, tileUrl } from "../src/matrix";
import { singleTile, walk } from "../src/measure";
import { mean } from "../src/stats";

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const images = (flag("images") ?? "").split(",").filter(Boolean).map((pair) => {
  const [label, image] = pair.split("=");
  if (!label || !image) throw new Error(`--images wants label=tag pairs, got ${pair}`);
  return { label, image };
});
if (images.length === 0) throw new Error("--images=label=tag,... is required");
const rounds = Number(flag("rounds") ?? 3);
const outName = flag("out") ?? "ab-images";
const family = (flag("family") ?? "postgis") as Family;
const withWalk = args.includes("--walk");
// the archive family measures Martin on PMTiles, the archive it answers fastest from
const ids = family === "postgis" ? { two: "martin-2", one: "martin-1" } : { two: "martin-2-pmtiles", one: "martin-1-pmtiles" };

ensureNetwork();
dbUp();
psql(
  "CREATE EXTENSION IF NOT EXISTS pg_prewarm; SELECT sum(pg_prewarm(r)) FROM (SELECT c.oid::regclass AS r FROM pg_class c WHERE c.relnamespace = 'bench'::regnamespace AND c.relkind IN ('r', 'i') UNION ALL SELECT c.reltoastrelid::regclass FROM pg_class c WHERE c.relnamespace = 'bench'::regnamespace AND c.reltoastrelid <> 0) AS rels;",
);
clientUp(family === "postgis" ? 2 : 6);
const plan = protocol(family, false);
const tiles = TILES[family];
const roads = TILES.postgis.find((t) => t.id === "roads-z14")!;
const entries = [...images, { label: "1.16.1", image: "" }];

function get(url: string): string {
  try {
    return clientExec(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-H", "Accept: application/vnd.mapbox-vector-tile", url], 30_000).trim();
  } catch {
    return "000";
  }
}

async function waitUp(url: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (get(url) === "200") return;
    await Bun.sleep(100);
  }
  throw new Error(`no 200 from ${url}`);
}

/** Distinct PostgreSQL backends that executed 20 sequential roads tiles, after 15 warm-up requests. */
function backends(url: string, label: string): number {
  for (let i = 0; i < 15; i++) get(url);
  psql("ALTER SYSTEM SET log_min_duration_statement = 0; SELECT pg_reload_conf();");
  const mark = `m2-ab-${label}-${Date.now()}`;
  psql(`SELECT '${mark}'`);
  for (let i = 0; i < 20; i++) get(url);
  psql("ALTER SYSTEM SET log_min_duration_statement = -1; SELECT pg_reload_conf();");
  const logs = run(["docker", "logs", "--since", "2m", "m2-db"], { quiet: true });
  const all = logs.stdout + logs.stderr;
  const text = all.slice(all.lastIndexOf(mark));
  return new Set([...text.matchAll(/\[(\d+)\] LOG:  duration: [\d.]+ ms  execute/g)].map((m) => m[1])).size;
}

const out: Record<string, { tiles: Record<string, number[]>; db: Record<string, number[]>; engine: Record<string, number[]>; walkRps: number[]; walkUs: number[]; backends?: number }> = {};
for (let round = 0; round < rounds; round++) {
  for (const { label, image } of entries) {
    if (image) process.env.WF_MARTIN_2_IMAGE = image;
    const c = candidate(image ? ids.two : ids.one);
    stopAllEngines();
    engineUp(c);
    const probe = tileUrl(c, tiles[0]!.layer, tiles[0]!.tile);
    await waitUp(family === "postgis" ? tileUrl(c, roads.layer, roads.tile) : probe);
    const entry = (out[label] ??= { tiles: {}, db: {}, engine: {}, walkRps: [], walkUs: [] });
    if (round === 0 && family === "postgis") entry.backends = backends(tileUrl(c, roads.layer, roads.tile), label);
    for (const spec of tiles) {
      const r = await singleTile(c, spec, plan, { ...REQUEST_HEADERS[family] });
      (entry.tiles[spec.id] ??= []).push(r.meanMs);
      (entry.db[spec.id] ??= []).push(r.cpu?.dbUs ?? Number.NaN);
      (entry.engine[spec.id] ??= []).push(r.cpu?.engineUs ?? Number.NaN);
    }
    if (withWalk) {
      const w = await walk(c, plan);
      entry.walkRps.push(w.rps);
      entry.walkUs.push(w.cpu?.totalUs ?? Number.NaN);
    }
    engineDown(c);
    console.log(`round ${round + 1}/${rounds} ${label}: ${tiles.map((s) => `${s.id} ${entry.tiles[s.id]!.at(-1)!.toFixed(3)} ms`).join(", ")}${withWalk ? `, walk ${entry.walkRps.at(-1)} tiles/s at ${entry.walkUs.at(-1)} us/tile` : ""}`);
  }
}
delete process.env.WF_MARTIN_2_IMAGE;

const summary: Record<string, Record<string, number>> = {};
for (const [label, entry] of Object.entries(out)) {
  const row: Record<string, number> = { backends: entry.backends ?? Number.NaN };
  for (const spec of tiles) {
    row[`${spec.id} ms`] = Number(mean(entry.tiles[spec.id]!).toFixed(3));
    row[`${spec.id} ${family === "postgis" ? "db" : "engine"} µs`] = Math.round(mean((family === "postgis" ? entry.db : entry.engine)[spec.id]!));
  }
  if (withWalk) {
    row["walk tiles/s"] = Math.round(mean(entry.walkRps));
    row["walk µs/tile"] = Number(mean(entry.walkUs).toFixed(1));
  }
  summary[label] = row;
}
writeFileSync(join(import.meta.dirname!, "..", ".work", `${outName}.json`), JSON.stringify({ rounds, images, out, summary }, null, 2));
console.table(summary);
