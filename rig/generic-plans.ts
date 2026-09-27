/**
 * Validate the plan-cache explanation inside Martin: the single-tile test for 2.0.0 and 1.16.1 with
 * the connection string as measured, and with `options=-c plan_cache_mode=force_generic_plan`
 * (PostgreSQL uses the cached generic plan from the first execution instead of planning each of
 * the first five executions per connection). Diagnostic only.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clientExec, clientUp, dbUp, engineDown, engineUp, ensureNetwork, stopAllEngines } from "../src/docker";
import { candidate, protocol, REQUEST_HEADERS, TILES, tileUrl } from "../src/matrix";
import { singleTile } from "../src/measure";

const ROOT = join(import.meta.dirname!, "..");
for (const id of ["martin-2", "martin-1"]) {
  writeFileSync(
    join(ROOT, "compose", "postgis", `${id}.generic.yml`),
    `services:\n  engine:\n    environment:\n      DATABASE_URL: "postgresql://tiles:tiles@db/bench?options=-c%20plan_cache_mode%3Dforce_generic_plan"\n`,
  );
}
mkdirSync(join(ROOT, ".work"), { recursive: true });
ensureNetwork();
dbUp();
clientUp(2);
const plan = protocol("postgis", false);
const out: Record<string, Record<string, { meanMs: number; dbUs: number | null }>> = {};

async function waitUp(url: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    try {
      if (clientExec(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-H", "Accept: application/vnd.mapbox-vector-tile", url], 10_000).trim() === "200") return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error(`no 200 from ${url}`);
}

for (const round of [1, 2]) {
  for (const id of ["martin-2", "martin-1"]) {
    for (const variant of ["", "generic"]) {
      const c = candidate(id);
      stopAllEngines();
      engineUp(c, variant);
      await waitUp(tileUrl(c, "buildings", TILES.postgis[0]!.tile));
      const key = `${id}${variant ? "+generic" : ""}`;
      for (const spec of TILES.postgis) {
        const r = await singleTile(c, spec, plan, { ...REQUEST_HEADERS.postgis }, variant);
        const k = `${spec.id}#${round}`;
        (out[key] ??= {})[k] = { meanMs: r.meanMs, dbUs: r.cpu?.dbUs ?? null };
      }
      engineDown(c, variant);
    }
  }
}
writeFileSync(join(ROOT, ".work", "generic-plans.json"), JSON.stringify(out, null, 2));
for (const [key, byTile] of Object.entries(out)) {
  const line = TILES.postgis.map((t) => {
    const vals = [1, 2].map((r) => byTile[`${t.id}#${r}`]!);
    const ms = vals.reduce((s, v) => s + v.meanMs, 0) / vals.length;
    const db = vals.reduce((s, v) => s + (v.dbUs ?? 0), 0) / vals.length;
    return `${t.id} ${ms.toFixed(3)} ms / ${Math.round(db)} µs db`;
  });
  console.log(`${key.padEnd(18)} ${line.join("  ")}`);
}
