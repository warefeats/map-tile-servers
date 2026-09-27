/**
 * When does each Martin version open its PostgreSQL connections? Counts the engine's backends in
 * pg_stat_activity after startup, after the first tile, and after batches of sequential tiles.
 * Diagnostic only.
 *
 *   bun run rig/pool-growth.ts --images=lane1=wf-martin:2.0.0-lane1
 */
import { clientExec, clientUp, dbUp, engineDown, engineUp, ensureNetwork, psql, stopAllEngines } from "../src/docker";
import { candidate, TILES, tileUrl } from "../src/matrix";

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const images = (flag("images") ?? "").split(",").filter(Boolean).map((pair) => {
  const [label, image] = pair.split("=");
  return { label: label!, image: image! };
});

ensureNetwork();
dbUp();
clientUp(2);
const tiles = TILES.postgis;

function get(url: string): string {
  try {
    return clientExec(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", "-H", "Accept: application/vnd.mapbox-vector-tile", url], 30_000).trim();
  } catch {
    return "000";
  }
}

function backends(): string {
  return psql("SELECT count(*) || ' (' || coalesce(string_agg(state, ',' ORDER BY pid), '') || ')' FROM pg_stat_activity WHERE usename = 'tiles' AND backend_type = 'client backend'").trim();
}

for (const { label, image } of [...images, { label: "1.16.1", image: "" }]) {
  if (image) process.env.WF_MARTIN_2_IMAGE = image;
  const c = candidate(image ? "martin-2" : "martin-1");
  stopAllEngines();
  engineUp(c);
  const first = tileUrl(c, tiles[1]!.layer, tiles[1]!.tile);
  for (let i = 0; i < 300 && get(tileUrl(c, "does-not-exist", tiles[1]!.tile)) === "000"; i++) await Bun.sleep(100);
  await Bun.sleep(1000);
  const steps: string[] = [`started ${backends()}`];
  get(first);
  steps.push(`1 tile ${backends()}`);
  for (let batch = 0; batch < 3; batch++) {
    for (let i = 0; i < 5; i++) get(first);
    steps.push(`+5 tiles ${backends()}`);
  }
  for (const spec of tiles) get(tileUrl(c, spec.layer, spec.tile));
  steps.push(`each layer once ${backends()}`);
  for (let i = 0; i < 20; i++) for (const spec of tiles) get(tileUrl(c, spec.layer, spec.tile));
  steps.push(`20 more rounds of layers ${backends()}`);
  await Bun.sleep(5000);
  steps.push(`5 s idle ${backends()}`);
  engineDown(c);
  console.log(`${label}: ${steps.join(" | ")}`);
}
