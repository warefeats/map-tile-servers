/**
 * Engine CPU per request on one keep-alive connection, for Martin builds serving the smallest
 * archive tile (country-z5, 8 features), where per-request overhead is most of the work.
 * Interleaved rounds; each run is the protocol's concurrency pass at one connection. Diagnostic only.
 *
 *   bun run rig/ab-request-cost.ts --images=base=wf-martin:2.0.0-055d4ea,lane4=wf-martin:2.0.0-lane4 --rounds=3 --out=request-cost
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { clientExec, clientUp, engineDown, engineUp, ensureNetwork, stopAllEngines } from "../src/docker";
import { candidate, protocol, TILES, tileUrl } from "../src/matrix";
import { concurrency } from "../src/measure";
import { mean } from "../src/stats";

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const images = (flag("images") ?? "").split(",").filter(Boolean).map((pair) => {
  const [label, image] = pair.split("=");
  return { label: label!, image: image! };
});
const rounds = Number(flag("rounds") ?? 3);
const outName = flag("out") ?? "request-cost";
const spec = TILES.archive.find((t) => t.id === "country-z5")!;

ensureNetwork();
clientUp(6);
const plan = protocol("archive", false);
const out: Record<string, { us: number[]; rps: number[] }> = {};
for (let round = 0; round < rounds; round++) {
  for (const { label, image } of images) {
    process.env.WF_MARTIN_2_IMAGE = image;
    const c = candidate("martin-2-pmtiles");
    stopAllEngines();
    engineUp(c);
    const url = tileUrl(c, spec.layer, spec.tile);
    for (let i = 0; i < 300; i++) {
      try {
        if (clientExec(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", url], 10_000).trim() === "200") break;
      } catch {}
      await Bun.sleep(100);
    }
    const r = await concurrency(c, spec, 1, plan);
    const entry = (out[label] ??= { us: [], rps: [] });
    entry.us.push(...r.samplesCpuUs);
    entry.rps.push(r.rps);
    engineDown(c);
    console.log(`round ${round + 1}/${rounds} ${label}: ${r.rps} requests/s, ${r.cpu?.engineUs} us CPU per request`);
  }
}
const summary = Object.fromEntries(
  Object.entries(out).map(([label, e]) => {
    const sorted = [...e.us].sort((a, b) => a - b);
    return [label, { "requests/s": Math.round(mean(e.rps)), "µs CPU per request": Number(mean(e.us).toFixed(2)), "median µs": sorted[Math.floor(sorted.length / 2)], passes: e.us.length }];
  }),
);
writeFileSync(join(import.meta.dirname!, "..", ".work", `${outName}.json`), JSON.stringify({ rounds, images, out, summary }, null, 2));
console.table(summary);
