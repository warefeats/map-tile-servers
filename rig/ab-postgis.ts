/**
 * Interleaved A/B for Martin 2.0.0 against 1.16.1 on PostGIS single tiles: A B A B A B, same
 * protocol as the main run's single-tile test, so position in the run (2.0.0 went first after the
 * database started) cannot explain a difference. Diagnostic: the main run stays the verdict.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { clientExec, clientUp, dbUp, engineDown, engineUp, ensureNetwork, psql, stopAllEngines } from "../src/docker";
import { candidate, protocol, REQUEST_HEADERS, TILES, tileUrl } from "../src/matrix";
import { singleTile } from "../src/measure";
import { mean } from "../src/stats";

ensureNetwork();
dbUp();
psql(
  "CREATE EXTENSION IF NOT EXISTS pg_prewarm; SELECT sum(pg_prewarm(r)) FROM (SELECT c.oid::regclass AS r FROM pg_class c WHERE c.relnamespace = 'bench'::regnamespace AND c.relkind IN ('r', 'i') UNION ALL SELECT c.reltoastrelid::regclass FROM pg_class c WHERE c.relnamespace = 'bench'::regnamespace AND c.reltoastrelid <> 0) AS rels;",
);
clientUp(2);
const plan = protocol("postgis", false);
const rounds = Number(process.argv.find((a) => a.startsWith("--rounds="))?.split("=")[1] ?? 3);
const out: Record<string, Record<string, number[]>> = {};
for (let round = 0; round < rounds; round++) {
  for (const id of ["martin-2", "martin-1"]) {
    const c = candidate(id);
    stopAllEngines();
    engineUp(c);
    const probe = tileUrl(c, "buildings", TILES.postgis[0]!.tile);
    for (let i = 0; i < 200; i++) {
      const code = (() => {
        try {
          return clientExec(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-H", "Accept: application/vnd.mapbox-vector-tile", probe], 10_000).trim();
        } catch {
          return "000";
        }
      })();
      if (code === "200") break;
      await Bun.sleep(100);
    }
    for (const spec of TILES.postgis) {
      const r = await singleTile(c, spec, plan, { ...REQUEST_HEADERS.postgis });
      ((out[id] ??= {})[spec.id] ??= []).push(r.meanMs);
      ((out[id] ??= {})[`${spec.id}-db`] ??= []).push(r.cpu?.dbUs ?? Number.NaN);
    }
    engineDown(c);
  }
}
const summary: Record<string, Record<string, { meanMs: number; dbUs: number }>> = {};
for (const [id, byTile] of Object.entries(out)) {
  for (const spec of TILES.postgis) {
    (summary[id] ??= {})[spec.id] = { meanMs: Number(mean(byTile[spec.id]!).toFixed(3)), dbUs: Math.round(mean(byTile[`${spec.id}-db`]!)) };
  }
}
writeFileSync(join(import.meta.dirname!, "..", ".work", "ab-postgis.json"), JSON.stringify({ rounds, out, summary }, null, 2));
console.log(JSON.stringify(summary, null, 2));
