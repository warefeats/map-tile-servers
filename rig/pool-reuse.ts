/**
 * Does each Martin version reuse its warm connection for back-to-back requests? Serve 20 sequential
 * roads tiles with statement logging on and count the distinct PostgreSQL backends that executed
 * them; then time the single-tile test on roads and pois with the pool at 8 (as measured) and at 1.
 * Diagnostic only.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clientExec, clientUp, dbUp, engineDown, engineUp, ensureNetwork, psql, run, stopAllEngines } from "../src/docker";
import { candidate, protocol, REQUEST_HEADERS, TILES, tileUrl } from "../src/matrix";
import { singleTile } from "../src/measure";

const ROOT = join(import.meta.dirname!, "..");
const cfgDir = join(ROOT, "configs", "postgis", "martin-pool1");
mkdirSync(cfgDir, { recursive: true });
const base = await Bun.file(join(ROOT, "configs", "postgis", "martin", "config.yaml")).text();
writeFileSync(join(cfgDir, "config.yaml"), base.replace("pool_size: 8", "pool_size: 1"));
for (const id of ["martin-2", "martin-1"]) {
  writeFileSync(join(ROOT, "compose", "postgis", `${id}.pool1.yml`), `services:\n  engine:\n    volumes:\n      - ../../configs/postgis/martin-pool1:/config:ro\n`);
}

ensureNetwork();
dbUp();
clientUp(2);
const plan = protocol("postgis", false);
const roads = TILES.postgis.find((t) => t.id === "roads-z14")!;
const pois = TILES.postgis.find((t) => t.id === "pois-z14")!;
const out: Record<string, unknown> = {};

async function waitUp(url: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    try {
      if (clientExec(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-H", "Accept: application/vnd.mapbox-vector-tile", url], 10_000).trim() === "200") return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error(`no 200 from ${url}`);
}

for (const id of ["martin-2", "martin-1"]) {
  const c = candidate(id);
  const url = tileUrl(c, roads.layer, roads.tile);
  // 1. which backends serve 20 back-to-back requests (after 15 warmups)
  stopAllEngines();
  engineUp(c);
  await waitUp(url);
  for (let i = 0; i < 15; i++) clientExec(["curl", "-s", "-o", "/dev/null", "-H", "Accept: application/vnd.mapbox-vector-tile", url], 30_000);
  psql("ALTER SYSTEM SET log_min_duration_statement = 0; SELECT pg_reload_conf();");
  const mark = `m2-pool-${id}-${Date.now()}`;
  psql(`SELECT '${mark}'`);
  for (let i = 0; i < 20; i++) clientExec(["curl", "-s", "-o", "/dev/null", "-H", "Accept: application/vnd.mapbox-vector-tile", url], 30_000);
  psql("ALTER SYSTEM SET log_min_duration_statement = -1; SELECT pg_reload_conf();");
  const logs = run(["docker", "logs", "--since", "1m", "m2-db"], { quiet: true });
  const text = (logs.stdout + logs.stderr).slice((logs.stdout + logs.stderr).lastIndexOf(mark));
  const executes = [...text.matchAll(/\[(\d+)\] LOG:  duration: ([\d.]+) ms  execute/g)].map((m) => ({ pid: m[1], ms: Number(m[2]) }));
  const binds = [...text.matchAll(/\[(\d+)\] LOG:  duration: ([\d.]+) ms  bind/g)].map((m) => Number(m[2]));
  const parses = [...text.matchAll(/LOG:  duration: [\d.]+ ms  parse/g)].length;
  const pids = [...new Set(executes.map((e) => e.pid))];
  out[`${id}-backends`] = { requests: executes.length, distinctBackends: pids.length, parses, meanBindMs: binds.reduce((a, b) => a + b, 0) / Math.max(1, binds.length), meanExecuteMs: executes.reduce((a, e) => a + e.ms, 0) / Math.max(1, executes.length) };
  console.log(`${id}: 20 sequential roads tiles ran on ${pids.length} backend(s), ${parses} parse(s), mean bind ${(out[`${id}-backends`] as { meanBindMs: number }).meanBindMs.toFixed(3)} ms`);
  // 2. the single-tile test at the measured pool of 8
  const r8 = await singleTile(c, roads, plan, { ...REQUEST_HEADERS.postgis });
  const p8 = await singleTile(c, pois, plan, { ...REQUEST_HEADERS.postgis });
  engineDown(c);
  // 3. the same with a pool of 1
  stopAllEngines();
  engineUp(c, "pool1");
  await waitUp(url);
  const r1 = await singleTile(c, roads, plan, { ...REQUEST_HEADERS.postgis }, "pool1");
  const p1 = await singleTile(c, pois, plan, { ...REQUEST_HEADERS.postgis }, "pool1");
  engineDown(c, "pool1");
  out[`${id}-single`] = { pool8: { roadsMs: r8.meanMs, roadsDbUs: r8.cpu?.dbUs, poisMs: p8.meanMs, poisDbUs: p8.cpu?.dbUs }, pool1: { roadsMs: r1.meanMs, roadsDbUs: r1.cpu?.dbUs, poisMs: p1.meanMs, poisDbUs: p1.cpu?.dbUs } };
}
writeFileSync(join(ROOT, ".work", "pool-reuse.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
