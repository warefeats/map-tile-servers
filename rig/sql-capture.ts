/**
 * Capture the SQL each PostGIS server sends for the marquee buildings tile, then EXPLAIN ANALYZE it
 * in the database with the same role. Statement logging is switched on only for the capture and
 * switched off again before anything is timed. Diagnostic only: nothing here feeds the verdict.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { clientExec, clientUp, dbUp, engineDown, engineUp, ensureNetwork, psql, run, stopAllEngines } from "../src/docker";
import { CANDIDATES, MARQUEE, REQUEST_HEADERS, tileUrl } from "../src/matrix";

const out = join(import.meta.dirname!, "..", ".work", "sql-capture");
require("node:fs").mkdirSync(out, { recursive: true });
ensureNetwork();
dbUp();
clientUp(2);

const only = process.argv.find((a) => a.startsWith("--candidates="))?.split("=")[1]?.split(",");
psql("ALTER SYSTEM SET log_min_duration_statement = 0; ALTER SYSTEM SET log_statement = 'none'; SELECT pg_reload_conf();");
try {
  for (const c of CANDIDATES.filter((x) => x.family === "postgis" && (!only || only.includes(x.id)))) {
    stopAllEngines();
    const startMark = `m2-startup-${c.id}-${Date.now()}`;
    psql(`SELECT '${startMark}'`);
    engineUp(c);
    const url = tileUrl(c, "buildings", MARQUEE);
    for (let i = 0; i < 100; i++) {
      try {
        const code = clientExec(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-H", `Accept: ${REQUEST_HEADERS.postgis.Accept}`, url], 10_000).trim();
        if (code === "200") break;
      } catch {}
      await Bun.sleep(200);
    }
    const mark = `m2-capture-${c.id}-${Date.now()}`;
    psql(`SELECT '${mark}'`);
    for (let i = 0; i < 3; i++) clientExec(["curl", "-s", "-o", "/dev/null", "-H", `Accept: ${REQUEST_HEADERS.postgis.Accept}`, url], 30_000);
    await Bun.sleep(500);
    const logs = run(["docker", "logs", "--since", "2m", "m2-db"], { quiet: true });
    const text = logs.stdout + logs.stderr;
    const after = text.slice(text.lastIndexOf(mark));
    writeFileSync(join(out, `${c.id}.log`), after);
    const startup = text.slice(text.lastIndexOf(startMark), text.lastIndexOf(mark));
    writeFileSync(join(out, `${c.id}.startup.log`), startup);
    const statements = (startup.match(/(statement|execute [^:]*|parse [^:]*):/g) ?? []).length;
    console.log(`${c.id}: ${statements} statements logged between engine start and the first tile`);
    console.log(`${c.id}: captured ${after.split("\n").length} log lines`);
    engineDown(c);
  }
} finally {
  psql("ALTER SYSTEM SET log_min_duration_statement = -1; ALTER SYSTEM RESET log_statement; SELECT pg_reload_conf();");
  console.log("statement logging off");
}
