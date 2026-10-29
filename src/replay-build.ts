/**
 * Builds a replay (docs/adr/0011) from one day of OSM's tile log:
 *   bun run src/replay-build.ts --log=<tiles-YYYY-MM-DD.txt.xz> --region=planet|berlin --scenario=alone|cdn
 *     [--n=2000000] [--seed=20261029] --out=<file>
 * Writes one `z/x/y` per line, and `<out>.json` beside it with the model and what the sample holds.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { addLine, BERLIN, buildModel, emptyListed, LOCAL_MIN_ZOOM, localize, MAX_TAIL_PER_TILE, MISS_SHARE, PLANET, sampler, type Scenario, TAIL_SHARE } from "./replay";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const log = arg("log");
const out = arg("out");
const region = { planet: PLANET, berlin: BERLIN }[arg("region") ?? ""];
const scenario = arg("scenario") as Scenario | undefined;
const n = Number(arg("n") ?? 2_000_000);
const seed = Number(arg("seed") ?? 20261029);
if (!log || !out || !region || (scenario !== "alone" && scenario !== "cdn") || !(n > 0)) {
  console.error("usage: replay-build.ts --log=<tiles.txt.xz> --region=planet|berlin --scenario=alone|cdn [--n=] [--seed=] --out=<file>");
  process.exit(2);
}

const listed = emptyListed();
const xz = Bun.spawn(["xz", "-dc", log], { stdout: "pipe" });
const decoder = new TextDecoder();
let rest = "";
for await (const chunk of xz.stdout) {
  const text = rest + decoder.decode(chunk, { stream: true });
  let start = 0;
  for (let nl = text.indexOf("\n"); nl >= 0; nl = text.indexOf("\n", start)) {
    addLine(listed, text.slice(start, nl), region);
    start = nl + 1;
  }
  rest = text.slice(start);
}
if (rest) addLine(listed, rest, region);
if ((await xz.exited) !== 0) throw new Error(`xz -dc ${log} failed`);

const localShare = localize(listed, region);
const model = buildModel(listed, region);
const draw = sampler(listed, model, scenario, seed);
const lines: string[] = new Array(n);
const perZoom = new Array<number>(model.zooms.length).fill(0);
const distinct = new Set<string>();
for (let i = 0; i < n; i++) {
  const t = draw();
  lines[i] = t;
  distinct.add(t);
  perZoom[Number(t.slice(0, t.indexOf("/")))]! += 1;
}
writeFileSync(out, lines.join("\n") + "\n");

const summary = {
  log: basename(log),
  logSha256: createHash("sha256").update(readFileSync(log)).digest("hex"),
  region: region.name,
  bbox: region.bbox ?? null,
  scenario,
  seed,
  n,
  tailShare: TAIL_SHARE,
  missShare: MISS_SHARE,
  maxTailPerTile: MAX_TAIL_PER_TILE,
  localMinZoom: LOCAL_MIN_ZOOM,
  localShare,
  logLines: listed.lines,
  droppedRasterZ0: listed.dropped,
  listedRequests: model.listedRequests,
  tailWanted: model.tailWanted,
  tailRequests: model.tailRequests,
  totalRequests: model.totalRequests,
  missRequests: model.missRequests,
  missListedTiles: model.missListed.length,
  zooms: model.zooms.map((z) => ({ ...z, direct: listed.direct[z.z], folded: listed.folded[z.z], sampleShare: perZoom[z.z]! / n })),
  sampleDistinctTiles: distinct.size,
};
writeFileSync(`${out}.json`, JSON.stringify(summary, null, 2) + "\n");
console.log(`${out}: ${n} draws, ${distinct.size} distinct tiles; listed ${model.listedRequests} + tail ${Math.round(model.tailRequests)} (wanted ${Math.round(model.tailWanted)}); misses ${Math.round(model.missRequests)}`);
