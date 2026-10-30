/**
 * The archive lane's orchestrator (docs/adr/0011). Each pass puts every unit on a fresh pair of instances in a
 * cluster placement group of its own, in the first zone with room for both, each unit starting from its own place
 * in the zone rotation so the pairs spread out; both set up at once, and each scenario starts the server cold
 * before the client measures it. A unit's record lands in the
 * bucket when it ends; one that fails is recorded and the others go on. A Berlin unit of an archive server ends
 * with the catalog start (1,000 more sources). A unit whose data is not in the bucket is skipped before the first
 * pass. Passes run one after another.
 *   bun run src/lane/orchestrate.ts --run=<id> [--units=all|<pattern>,...] [--passes=3] [--quick]
 */
import { readFileSync } from "node:fs";
import { BERLIN } from "../session-plan";
import { lonLatToTile } from "../tiles";
import { type ClientUnit, clientScenarioScript, clientSetupScript, type Scenario, SCENARIOS } from "./client-script";
import { aws, AwsCloud, CapacityError, type Cloud, type Host } from "./cloud";
import { catalogScript, collectScript, type ServerUnit, setupScript, startScript } from "./server-script";
import { type Arch, type Dataset, type Format, type LaneServer, units } from "./servers";

/** The OpenFreeMap planet build the bucket holds (.github/workflows/stage-data.yml). */
export const PLANET_BUILD = "20261025_080012_pt";
export const DATASETS: readonly Dataset[] = ["berlin", "planet"];
export const ARCHS: readonly Arch[] = ["arm64", "amd64"];
/** The stack's lane launch templates, which rig-walk checks. */
export const LANE_TYPES = ["c8g.xlarge", "c8i.xlarge", "c8gn.xlarge"];
/** Every start's first request: Berlin's centre at zoom 14, a tile both datasets hold. */
export const FIRST_TILE = lonLatToTile(BERLIN.lon, BERLIN.lat, 14);

const TIMEOUT_S = { setup: 3600, clientSetup: 900, start: 300, scenario: 1800, quickScenario: 600, collect: 300, catalog: 900 };
const ONLINE_MS = 15 * 60_000;

export interface LaneUnit {
  id: string;
  server: LaneServer;
  format: Format;
  dataset: Dataset;
  arch: Arch;
}

export const unitId = (u: Omit<LaneUnit, "id">) => `${u.server.id}-${u.format}-${u.dataset}-${u.arch}`;

/** Why a unit cannot run, or null. */
export function blocked(u: Omit<LaneUnit, "id">): string | null {
  if (!u.server.image[u.arch] && !u.server.release?.[u.arch]) return `no ${u.arch} image, and none built from a release binary`;
  return u.server.unsupported?.[u.dataset]?.[u.format] ?? null;
}

const matches = (pattern: string, id: string) => new RegExp(`^${pattern.split("*").map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(id);

/** The units a filter names (`all`, or comma-separated ids with `*` wildcards), and those that cannot run yet. */
export function planUnits(filter: string): { run: LaneUnit[]; skipped: { id: string; reason: string }[] } {
  const patterns = filter === "all" ? ["*"] : filter.split(",").map((p) => p.trim()).filter(Boolean);
  const run: LaneUnit[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const u of units(DATASETS, ARCHS)) {
    const id = unitId(u);
    if (!patterns.some((p) => matches(p, id))) continue;
    const reason = blocked(u);
    if (reason) skipped.push({ id, reason });
    else run.push({ id, ...u });
  }
  return { run, skipped };
}

/** scripts/rig-inputs.txt: one `name key` per line. */
export function parseInputs(text: string): Map<string, string> {
  const pairs = text.split("\n").map((l) => l.trim().split(/\s+/)).filter((f): f is [string, string] => f.length === 2);
  return new Map(pairs);
}

/**
 * The dataset's key in the bucket: the planet as staged, Berlin as scripts/rig-inputs.txt pins it. Tile files come
 * as a Btrfs image: the planet's is OpenFreeMap's own, Berlin's the one lane.yml builds into the run's bundle.
 */
export function dataKey(u: Pick<LaneUnit, "dataset" | "format">, inputs: ReadonlyMap<string, string>, run: string): string {
  const ext = u.format === "files" ? "btrfs" : u.format;
  if (u.dataset === "planet") return `inputs/openfreemap-planet-${PLANET_BUILD}.${ext}`;
  if (u.format === "files") return `bundles/lane-${run}/files/${u.dataset}.btrfs`;
  const key = inputs.get(`${u.dataset}.${u.format}`);
  if (!key) throw new Error(`scripts/rig-inputs.txt names no ${u.dataset}.${u.format}`);
  return key;
}

/** What a unit's server scripts need; an image lane.yml built from a release binary comes from the run's bundle. */
export function serverUnitOf(u: LaneUnit, bucket: string, run: string, inputs: ReadonlyMap<string, string>): ServerUnit {
  const tag = u.server.image[u.arch] ? undefined : u.server.release?.[u.arch];
  return { server: u.server, arch: u.arch, tileset: u.dataset, format: u.format, bucket, dataKey: dataKey(u, inputs, run), firstTile: FIRST_TILE, ...(tag ? { localImage: { tag, key: `bundles/lane-${run}/images/${u.server.id}-${u.arch}.tar.zst` } } : {}) };
}

export interface RunContext {
  run: string;
  bucket: string;
  templates: Record<Arch | "client", string>;
  /** The zones' subnets in the order this unit tries them. */
  subnets: readonly string[];
  quick: boolean;
  inputs: ReadonlyMap<string, string>;
  /** How long a server launch waits for capacity before it tries again in the same zone. */
  retryMs: number;
}

export interface UnitRecord {
  id: string;
  pass: number;
  server: string;
  version: string;
  stable: boolean;
  format: Format;
  dataset: Dataset;
  arch: Arch;
  placementGroup: string;
  serverHost: Host | null;
  clientHost: Host | null;
  /** Seconds the archive took from the bucket to the server's disk. */
  dataSeconds: number | null;
  /** Each scenario's cold start, to the first tile. */
  readyMs: Partial<Record<Scenario, number>>;
  /** Each scenario's result in the bucket. */
  results: Partial<Record<Scenario, string>>;
  /** Berlin only: milliseconds from the start with 1,000 more sources to the dataset's first tile and to the last source's; null where none came within the wait. */
  catalog: { firstMs: number | null; lastMs: number | null } | null;
  log: string[];
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A server and its client in one zone, in a cluster placement group of their own. The client's network-optimized
 * type is the scarce one (the first coverage smoke ran out of it in one zone after 15 clients), so it launches
 * first and picks the zone: each zone in turn until one takes it, then the server follows it. A zone that takes
 * the client but not the server, twice, gives the client back and the pair moves on.
 */
export async function launchPair(cloud: Cloud, ctx: RunContext, u: LaneUnit, pass: number, tags: (role: string) => Record<string, string>, note: (what: string) => void): Promise<{ server: Host; client: Host; placementGroup: string }> {
  for (const [i, subnet] of ctx.subnets.entries()) {
    const placementGroup = `lane-${ctx.run}-p${pass}-${u.id}-${i}`;
    await cloud.createPlacementGroup(placementGroup, tags("placement"));
    let client: Host;
    try {
      client = await cloud.launch({ template: ctx.templates.client, placementGroup, subnets: [subnet], tags: tags("client") });
    } catch (e) {
      if (!(e instanceof CapacityError)) throw e;
      note(`no client capacity in ${subnet}`);
      continue;
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const server = await cloud.launch({ template: ctx.templates[u.arch], placementGroup, subnets: [subnet], tags: tags("server") });
        return { server, client, placementGroup };
      } catch (e) {
        if (!(e instanceof CapacityError)) {
          await cloud.terminate([client.id]);
          throw e;
        }
        note(`no server capacity in ${client.az}, attempt ${attempt}`);
        if (attempt < 2) await sleep(ctx.retryMs);
      }
    }
    await cloud.terminate([client.id]);
  }
  throw new CapacityError(`no zone had room for both of ${u.id}'s instances`);
}

export async function runUnit(cloud: Cloud, ctx: RunContext, u: LaneUnit, pass: number): Promise<UnitRecord> {
  const scripts = `bundles/lane-${ctx.run}/p${pass}/${u.id}/`;
  const results = `results/lane/${ctx.run}/p${pass}/${u.id}/`;
  const rec: UnitRecord = { id: u.id, pass, server: u.server.id, version: u.server.version, stable: u.server.stable, format: u.format, dataset: u.dataset, arch: u.arch, placementGroup: "", serverHost: null, clientHost: null, dataSeconds: null, readyMs: {}, results: {}, catalog: null, log: [], error: null, startedAt: new Date().toISOString(), finishedAt: null };
  const tags = (role: string) => ({ Name: `lane-${ctx.run}-p${pass}-${u.id}-${role}`, Project: "martin-2-bench", LaneRun: ctx.run, Pass: String(pass), Unit: u.id, Role: role });
  const note = (what: string) => {
    rec.log.push(`${new Date().toISOString()} ${what}`);
    console.log(`p${pass} ${u.id}: ${what}`);
  };
  const step = async (host: Host, name: string, script: string, timeoutS: number): Promise<string> => {
    await cloud.putText(`${scripts}${name}.sh`, script);
    const r = await cloud.run(host.id, `${scripts}${name}.sh`, { timeoutS, outputPrefix: `${results}ssm`, comment: `lane ${ctx.run} p${pass} ${u.id} ${name}` });
    note(`${name} ${r.status}`);
    if (r.status !== "Success") throw new Error(`${name} on ${host.id}: ${r.status}\n${`${r.stdout}\n${r.stderr}`.trim().slice(-1500)}`);
    return r.stdout;
  };
  const su = serverUnitOf(u, ctx.bucket, ctx.run, ctx.inputs);
  const cu: ClientUnit = { bucket: ctx.bucket, bundle: `bundles/lane-${ctx.run}/`, dataset: u.dataset };
  try {
    const { server, client, placementGroup } = await launchPair(cloud, ctx, u, pass, tags, note);
    rec.serverHost = server;
    rec.clientHost = client;
    rec.placementGroup = placementGroup;
    note(`server ${server.id} and client ${client.id} in ${server.az}`);
    await Promise.all([cloud.waitOnline(server.id, ONLINE_MS), cloud.waitOnline(client.id, ONLINE_MS)]);
    const [setup] = await Promise.all([step(server, "setup", setupScript(su), TIMEOUT_S.setup), step(client, "client-setup", clientSetupScript(cu), TIMEOUT_S.clientSetup)]);
    rec.dataSeconds = Number(/data in (\d+) s/.exec(setup)?.[1] ?? Number.NaN);
    for (const scenario of SCENARIOS) {
      const started = await step(server, `start-${scenario}`, startScript(su, scenario), TIMEOUT_S.start);
      rec.readyMs[scenario] = Number(/READY (\d+) ms/.exec(started)?.[1] ?? Number.NaN);
      const resultKey = `${results}${scenario}.json`;
      const out = await step(client, scenario, clientScenarioScript(cu, { server: u.server.id, host: server.ip, format: u.format, scenario, quick: ctx.quick, resultKey }), ctx.quick ? TIMEOUT_S.quickScenario : TIMEOUT_S.scenario);
      rec.results[scenario] = resultKey;
      note(/capacity .*/.exec(out)?.[0] ?? `${scenario} done`);
    }
    await step(server, "collect", collectScript(su, `s3://${ctx.bucket}/${results}`), TIMEOUT_S.collect);
    if (u.dataset === "berlin" && u.format !== "files") {
      // reported, not ranked: a start that never comes is recorded as never served, and the unit's scenarios stand
      try {
        const out = await step(server, "catalog", catalogScript(su, `bundles/lane-${ctx.run}/catalog/small.${u.format}`), TIMEOUT_S.catalog);
        const m = /CATALOG first (\d+|none) ms, last (\d+|none) ms/.exec(out);
        const ms = (v: string | undefined) => (v && v !== "none" ? Number(v) : null);
        rec.catalog = { firstMs: ms(m?.[1]), lastMs: ms(m?.[2]) };
      } catch (e) {
        rec.catalog = { firstMs: null, lastMs: null };
        note(`catalog did not finish: ${(e as Error).message.split("\n")[0]}`);
      }
      note(`catalog: first ${rec.catalog.firstMs ?? "none"} ms, last ${rec.catalog.lastMs ?? "none"} ms`);
    }
  } catch (e) {
    // AWS errors name the account; the records may go public with the runner
    rec.error = (e as Error).message.replace(/Account \d+ /g, "The account ");
    note(`failed: ${rec.error.split("\n")[0]}`);
    // the server's own log says most about a failure
    if (rec.serverHost && !rec.log.some((l) => l.endsWith("collect Success"))) {
      await step(rec.serverHost, "collect", collectScript(su, `s3://${ctx.bucket}/${results}`), TIMEOUT_S.collect).catch(() => undefined);
    }
  } finally {
    const ids = [rec.serverHost?.id, rec.clientHost?.id].filter((id): id is string => !!id);
    await cloud.terminate(ids).catch((e: Error) => note(`terminate failed: ${e.message}`));
    rec.finishedAt = new Date().toISOString();
    await cloud.putText(`${results}unit.json`, `${JSON.stringify(rec, null, 2)}\n`).catch((e: Error) => note(`record not written: ${e.message}`));
  }
  return rec;
}

/** Default subnets in the zones that offer every lane instance type, in zone order. */
async function laneSubnets(): Promise<string[]> {
  const offers = await aws<[string, string][]>(["ec2", "describe-instance-type-offerings", "--location-type", "availability-zone", "--filters", `Name=instance-type,Values=${LANE_TYPES.join(",")}`, "--query", "InstanceTypeOfferings[].[InstanceType,Location]"]);
  const types = new Map<string, Set<string>>();
  for (const [type, zone] of offers) types.set(zone, (types.get(zone) ?? new Set()).add(type));
  const subnets = await aws<[string, string][]>(["ec2", "describe-subnets", "--filters", "Name=default-for-az,Values=true", "--query", "Subnets[].[AvailabilityZone,SubnetId]"]);
  return subnets
    .filter(([zone]) => types.get(zone)?.size === LANE_TYPES.length)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, id]) => id);
}

const rotate = <T>(xs: readonly T[], n: number) => [...xs.slice(n % xs.length), ...xs.slice(0, n % xs.length)];

if (import.meta.main) {
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const run = arg("run");
  const passes = Number(arg("passes") ?? 3);
  if (!run || !/^[\w-]+$/.test(run) || !(passes >= 1)) {
    console.error("usage: orchestrate.ts --run=<id> [--units=all|<pattern>,...] [--passes=3] [--quick]");
    process.exit(2);
  }
  const quick = process.argv.includes("--quick");
  const plan = planUnits(arg("units") ?? "all");
  const outputs = new Map(await aws<[string, string][]>(["cloudformation", "describe-stacks", "--stack-name", "WarefeatsMartin2Bench", "--query", "Stacks[0].Outputs[].[OutputKey,OutputValue]"]));
  const need = (k: string) => outputs.get(k) ?? (console.error(`the stack has no ${k} output`), process.exit(1));
  const bucket = need("RigBucketName");
  const templates = { arm64: need("LaneServerArmId"), amd64: need("LaneServerX86Id"), client: need("LaneClientId") };
  const subnets = await laneSubnets();
  const inputs = parseInputs(readFileSync("scripts/rig-inputs.txt", "utf8"));
  // every dataset a unit fetches must be in the bucket, and a staged planet file must carry its checked sum
  const present = async (key: string) => aws(["s3api", "head-object", "--bucket", bucket, "--key", key]).then(() => true, () => false);
  for (const u of [...plan.run]) {
    const key = dataKey(u, inputs, run);
    if ((await present(key)) && (!key.startsWith("inputs/openfreemap-") || (await present(`${key}.sha256`)))) continue;
    plan.run.splice(plan.run.indexOf(u), 1);
    plan.skipped.push({ id: u.id, reason: `${key} is not in the bucket` });
  }
  // a minute's margin for clock skew against SSM's own timestamps
  const cloud = new AwsCloud(bucket, new Date(Date.now() - 60_000));
  console.log(`run ${run}: ${plan.run.length} units, ${passes} pass(es)${quick ? ", quick" : ""}; zones' subnets ${subnets.join(" ")}`);
  for (const s of plan.skipped) console.log(`  skipped ${s.id}: ${s.reason}`);
  await cloud.putText(`results/lane/${run}/plan.json`, `${JSON.stringify({ run, passes, quick, planetBuild: PLANET_BUILD, units: plan.run.map((u) => u.id), skipped: plan.skipped, startedAt: new Date().toISOString() }, null, 2)}\n`);
  let failed = 0;
  for (let pass = 1; pass <= passes; pass++) {
    // launches spread over a minute or so, under EC2's request rate, and over the zones: each unit starts from its own
    const records = await Promise.all(plan.run.map((u, i) => sleep(i * 1500).then(() => runUnit(cloud, { run, bucket, templates, subnets: rotate(subnets, i + pass - 1), quick, inputs, retryMs: 60_000 }, u, pass))));
    const bad = records.filter((r) => r.error);
    failed += bad.length;
    console.log(`pass ${pass}: ${records.length - bad.length} of ${records.length} units done${bad.length ? `; failed: ${bad.map((r) => r.id).join(", ")}` : ""}`);
  }
  process.exit(failed ? 1 : 0);
}
