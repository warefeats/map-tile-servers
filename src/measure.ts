import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertEngineImage, clientExec, clientSpawn, DB_CONTAINER, engineContainer, engineDown, engineLogs, engineUp, inspect, parseDockerTimeUs, sample, WORK_DIR, type ContainerSample } from "./docker";
import { BROWSER_ACCEPT_ENCODING, type Candidate, engineOrigin, LADDER, ladderConnections, type Protocol, REQUEST_HEADERS, type TileSpec, tileUrl, VIEWPORT, walkPaths } from "./matrix";
import { type OhaPass, oha, OHA_DEADLINE_ABORT } from "./oha";
import { mean, percentile, round } from "./stats";

// ---- CPU accounting -----------------------------------------------------------------------

/** CPU spent by the engine (and, for PostGIS, the database) across one measured window. */
export interface CpuWindow {
  engineMs: number;
  dbMs: number | null;
}

interface Snapshot {
  engine: ContainerSample;
  db: ContainerSample | null;
}

async function snapshot(c: Candidate, variant = ""): Promise<Snapshot> {
  const [engine, db] = await Promise.all([sample(engineContainer(c, variant)), c.family === "postgis" ? sample(DB_CONTAINER) : Promise.resolve(null)]);
  return { engine, db };
}

function cpuBetween(a: Snapshot, b: Snapshot): CpuWindow {
  return {
    engineMs: round((b.engine.cpuNs - a.engine.cpuNs) / 1e6, 3),
    dbMs: a.db && b.db ? round((b.db.cpuNs - a.db.cpuNs) / 1e6, 3) : null,
  };
}

/** Run a synchronous oha pass between two cgroup CPU snapshots. */
async function measuredPass(c: Candidate, fn: () => OhaPass, variant = ""): Promise<{ pass: OhaPass; cpu: CpuWindow }> {
  const before = await snapshot(c, variant);
  const pass = fn();
  const after = await snapshot(c, variant);
  return { pass, cpu: cpuBetween(before, after) };
}

/** CPU microseconds per successful tile, engine and database separately. */
export interface CpuPerTile {
  engineUs: number;
  dbUs: number | null;
  totalUs: number;
}

function perTile(cpus: CpuWindow[], tiles: number): CpuPerTile | null {
  if (tiles <= 0) return null;
  const engineMs = cpus.reduce((s, w) => s + w.engineMs, 0);
  const dbValues = cpus.map((w) => w.dbMs);
  const dbMs = dbValues.every((v) => v !== null) ? (dbValues as number[]).reduce((s, v) => s + v, 0) : null;
  const engineUs = round((engineMs * 1000) / tiles, 2);
  const dbUs = dbMs === null ? null : round((dbMs * 1000) / tiles, 2);
  return { engineUs, dbUs, totalUs: round(engineUs + (dbUs ?? 0), 2) };
}

// ---- memory -------------------------------------------------------------------------------

export interface MemoryReading {
  /** What `docker stats` shows: cgroup memory minus inactive file pages. */
  memMb: number;
  anonMb: number;
  fileMb: number;
}

export async function memory(c: Candidate, variant = ""): Promise<MemoryReading> {
  const s = await sample(engineContainer(c, variant));
  return { memMb: round(s.memMb, 2), anonMb: round(s.anonMb, 2), fileMb: round(s.fileMb, 2) };
}

// ---- cold start -----------------------------------------------------------------------------

export interface ColdStartResult {
  /** Process start (Docker StartedAt) to the first 200 for the marquee tile, ms, per repetition. */
  samplesMs: number[];
  idle: MemoryReading;
  /** Follow-up fetches right after the first 200 (catalog runs: the last source), ms after process start. */
  followUpsMs?: { url: string; status: number; msAfterStart: number }[][];
}

/**
 * Start the engine from stopped until it serves `url`. The poller is already running on the engine
 * network when the container starts, and both timestamps are the VM's clock. The engine is left
 * running after the last repetition; idle memory is read five seconds later. The first `warmups`
 * starts run the same way and are not recorded (docs/adr/0005).
 */
export async function coldStart(c: Candidate, url: string, headers: Record<string, string>, reps: number, timeoutMs: number, opts: { variant?: string; then?: string[]; warmups?: number } = {}): Promise<ColdStartResult> {
  const variant = opts.variant ?? "";
  const warmups = opts.warmups ?? 0;
  const samplesMs: number[] = [];
  const followUpsMs: { url: string; status: number; msAfterStart: number }[][] = [];
  for (let rep = -warmups; rep < reps; rep++) {
    engineDown(c, variant);
    const poller = clientSpawn(["bun", "/app/src/client/coldpoll.ts", JSON.stringify({ url, headers, timeoutMs, intervalMs: 5, then: opts.then ?? [] })]);
    await Bun.sleep(400); // let bun start and begin polling before the engine exists
    engineUp(c, variant);
    const text = await new Response(poller.stdout as ReadableStream).text();
    await poller.exited;
    let parsed: { firstOkUs: number | null; attempts: number; lastError: string; followUps: { url: string; status: number; atUs: number }[] };
    try {
      parsed = JSON.parse(text.trim().split("\n").pop() ?? "{}");
    } catch {
      throw new Error(`cold-start poller printed no result: ${text.slice(-300)}`);
    }
    if (parsed.firstOkUs === null) {
      console.error(engineLogs(c, variant));
      throw new Error(`no 200 from ${url} within ${timeoutMs} ms (${parsed.attempts} attempts, last: ${parsed.lastError})`);
    }
    const engine = await inspect(engineContainer(c, variant));
    await assertEngineImage(c, engine);
    const startedUs = parseDockerTimeUs(engine.State.StartedAt);
    const ms = round((parsed.firstOkUs - startedUs) / 1000, 2);
    const follow = parsed.followUps.map((f) => ({ url: f.url, status: f.status, msAfterStart: round((f.atUs - startedUs) / 1000, 2) }));
    const followText = follow.length ? `; follow-ups ${follow.map((f) => `${f.status}@${f.msAfterStart}ms`).join(", ")}` : "";
    if (rep < 0) {
      console.log(`    warm-up start: ${ms} ms to first tile${followText} (not recorded)`);
      continue;
    }
    samplesMs.push(ms);
    followUpsMs.push(follow);
    console.log(`    cold start ${rep + 1}/${reps}: ${ms} ms to first tile${followText}`);
  }
  await Bun.sleep(5_000);
  const idle = await memory(c, variant);
  console.log(`    idle memory: ${idle.memMb.toFixed(1)} MiB (anon ${idle.anonMb.toFixed(1)}, file ${idle.fileMb.toFixed(1)})`);
  return { samplesMs, idle, ...(opts.then?.length ? { followUpsMs } : {}) };
}

// ---- parity -------------------------------------------------------------------------------

export interface ParityRecord {
  status: number;
  bytes: number;
  contentType: string | null;
  contentEncoding: string | null;
  features: number;
  layers: { name: string; features: number }[];
  decodeError?: string;
}

export interface ParityResult {
  tiles: Record<string, ParityRecord>;
  /** The marquee tile under the other encoding (archive: no Accept-Encoding; PostGIS: gzip). Recorded, never ranked. */
  alternate: { headers: Record<string, string>; record: ParityRecord };
  /** The marquee tile as a current Chrome asks for it. Recorded, never ranked. */
  browser: { acceptEncoding: string; record: ParityRecord };
}

export function alternateHeaders(c: Candidate): Record<string, string> {
  const base: Record<string, string> = { ...REQUEST_HEADERS[c.family] };
  delete base["Accept-Encoding"];
  return base;
}

export function parity(c: Candidate, tiles: readonly TileSpec[]): ParityResult {
  const headers = { ...REQUEST_HEADERS[c.family] };
  const marquee = tiles[0]!;
  const alt = alternateHeaders(c);
  const browser = { ...headers, "Accept-Encoding": BROWSER_ACCEPT_ENCODING };
  const probes = [
    ...tiles.map((t) => ({ id: t.id, url: tileUrl(c, t.layer, t.tile), headers })),
    { id: "__alternate", url: tileUrl(c, marquee.layer, marquee.tile), headers: alt },
    { id: "__browser", url: tileUrl(c, marquee.layer, marquee.tile), headers: browser },
  ];
  const raw = JSON.parse(clientExec(["bun", "/app/src/client/fetchtile.ts", JSON.stringify({ probes, timeoutMs: 120_000 })], 600_000)) as Record<string, ParityRecord & { layers: { name: string; features: number }[] }>;
  const slim = (r: ParityRecord): ParityRecord => ({
    status: r.status,
    bytes: r.bytes,
    contentType: r.contentType ?? null,
    contentEncoding: r.contentEncoding ?? null,
    features: r.features ?? 0,
    layers: (r.layers ?? []).map((l) => ({ name: l.name, features: l.features })),
    ...(r.decodeError ? { decodeError: r.decodeError } : {}),
  });
  const out: Record<string, ParityRecord> = {};
  for (const t of tiles) {
    out[t.id] = slim(raw[t.id]!);
    const r = out[t.id]!;
    console.log(`    parity ${t.id}: ${r.status} ${r.bytes} B${r.contentEncoding ? ` (${r.contentEncoding})` : ""}, ${r.features} features in ${r.layers.length} layer(s)${r.decodeError ? ` [${r.decodeError}]` : ""}`);
  }
  const a = slim(raw["__alternate"]!);
  const b = slim(raw["__browser"]!);
  console.log(`    alternate encoding: ${a.bytes} B${a.contentEncoding ? ` (${a.contentEncoding})` : ""}; browser Accept-Encoding: ${b.bytes} B${b.contentEncoding ? ` (${b.contentEncoding})` : ""}`);
  return { tiles: out, alternate: { headers: alt, record: a }, browser: { acceptEncoding: BROWSER_ACCEPT_ENCODING, record: b } };
}

// ---- single tile ----------------------------------------------------------------------------

export interface SingleTileResult {
  /** Mean latency of each measured pass, ms. */
  samplesMs: number[];
  meanMs: number;
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
  requests: number;
  errorRate: number;
  bytesPerRequest: number | null;
  cpu: CpuPerTile | null;
}

/** Sequential requests on one tile over one connection: the thesis's single-user test. */
export async function singleTile(c: Candidate, spec: TileSpec, p: Protocol, headers: Record<string, string>, variant = ""): Promise<SingleTileResult> {
  const url = tileUrl(c, spec.layer, spec.tile);
  const { warmupPasses, passes, requestsPerPass } = p.single;
  const opts = { connections: 1, requests: requestsPerPass, timeoutSeconds: p.requestTimeoutSeconds, headers };
  for (let i = 0; i < warmupPasses; i++) oha(url, opts);
  const samplesMs: number[] = [];
  const p50s: number[] = [];
  const p99s: number[] = [];
  const maxes: number[] = [];
  const cpus: CpuWindow[] = [];
  let requests = 0;
  let failures = 0;
  let success = 0;
  let bytes: number | null = null;
  for (let i = 0; i < passes; i++) {
    const { pass, cpu } = await measuredPass(c, () => oha(url, opts), variant);
    cpus.push(cpu);
    requests += pass.completed + pass.transportErrors;
    failures += pass.completed - pass.success + pass.transportErrors;
    success += pass.success;
    if (pass.meanMs !== null) samplesMs.push(pass.meanMs);
    if (pass.p50Ms !== null) p50s.push(pass.p50Ms);
    if (pass.p99Ms !== null) p99s.push(pass.p99Ms);
    if (pass.maxMs !== null) maxes.push(pass.maxMs);
    if (pass.bytesPerRequest !== null) bytes = pass.bytesPerRequest;
  }
  const result: SingleTileResult = {
    samplesMs,
    meanMs: round(mean(samplesMs), 3),
    p50Ms: round(percentile(p50s, 0.5), 3),
    p99Ms: round(Math.max(...p99s), 3),
    maxMs: round(Math.max(...maxes), 3),
    requests,
    errorRate: requests > 0 ? round(failures / requests, 4) : 1,
    bytesPerRequest: bytes,
    cpu: perTile(cpus, success),
  };
  console.log(`    ${spec.id} c=1: mean ${result.meanMs} ms, p99 ${result.p99Ms} ms, ${result.cpu ? `cpu ${result.cpu.engineUs} us/tile engine${result.cpu.dbUs !== null ? ` + ${result.cpu.dbUs} db` : ""}` : ""}, errors ${(result.errorRate * 100).toFixed(1)}%`);
  return result;
}

// ---- viewport burst -------------------------------------------------------------------------

export interface BurstResult {
  /** Wall time for all four tiles to arrive, per repetition, ms. */
  samplesMs: number[];
  meanMs: number;
  p50Ms: number;
  maxMs: number;
  slowestTileMeanMs: number;
  errorRate: number;
}

export function burst(c: Candidate, p: Protocol): BurstResult {
  const vp = VIEWPORT[c.family];
  const urls = vp.tiles.map((t) => tileUrl(c, vp.layer, t));
  const samples = JSON.parse(
    clientExec(["bun", "/app/src/client/burst.ts", JSON.stringify({ urls, headers: REQUEST_HEADERS[c.family], warmups: p.burst.warmups, reps: p.burst.reps, timeoutMs: p.requestTimeoutSeconds * 1000 })], 1_800_000),
  ) as { wallMs: number; slowestMs: number; failures: number }[];
  const wall = samples.map((s) => round(s.wallMs, 3));
  const result: BurstResult = {
    samplesMs: wall,
    meanMs: round(mean(wall), 3),
    p50Ms: round(percentile(wall, 0.5), 3),
    maxMs: round(Math.max(...wall), 3),
    slowestTileMeanMs: round(mean(samples.map((s) => s.slowestMs)), 3),
    errorRate: round(samples.reduce((s, r) => s + r.failures, 0) / (samples.length * urls.length), 4),
  };
  console.log(`    viewport burst: mean ${result.meanMs} ms, max ${result.maxMs} ms`);
  return result;
}

// ---- closed-loop throughput (concurrency and the random walk) -------------------------------

export interface ThroughputResult {
  connections: number;
  /** Distinct tiles requested (1 for the marquee passes). */
  tiles: number;
  samplesRps: number[];
  samplesP99Ms: (number | null)[];
  rps: number;
  p50Ms: number | null;
  p99Ms: number | null;
  errorRate: number;
  completed: number;
  transportErrors: number;
  statusCodes: Record<string, number>;
  errorDistribution: Record<string, number>;
  bytesPerRequest: number | null;
  cpu: CpuPerTile | null;
  /** Engine plus database CPU per successful tile in each measured pass, us. */
  samplesCpuUs: number[];
  /** Engine CPU cores in use on average during the measured passes (container limit is 4). */
  engineCores: number;
}

function writeUrlList(c: Candidate, name: string, paths: string[]): string {
  const file = `${c.id}-${name}.txt`;
  writeFileSync(join(WORK_DIR, file), paths.map((p) => engineOrigin(c) + p).join("\n") + "\n");
  return `/work/${file}`;
}

async function closedLoop(c: Candidate, target: { url: string } | { list: string; tiles: number }, connections: number, s: { warmupSeconds: number; passes: number; passSeconds: number }, timeoutSeconds: number): Promise<ThroughputResult> {
  const headers = REQUEST_HEADERS[c.family];
  const base = { connections, timeoutSeconds, headers, ...("list" in target ? { urlsFromFile: target.list } : {}) };
  const url = "url" in target ? target.url : "";
  oha(url, { ...base, durationSeconds: s.warmupSeconds });
  const samplesRps: number[] = [];
  const samplesP99Ms: (number | null)[] = [];
  const p50s: number[] = [];
  const p99s: number[] = [];
  const statusCodes: Record<string, number> = {};
  const errorDistribution: Record<string, number> = {};
  const cpus: CpuWindow[] = [];
  const samplesCpuUs: number[] = [];
  let completed = 0;
  let success = 0;
  let transportErrors = 0;
  let bytes: number | null = null;
  let wallS = 0;
  for (let i = 0; i < s.passes; i++) {
    const { pass, cpu } = await measuredPass(c, () => oha(url, { ...base, durationSeconds: s.passSeconds }));
    cpus.push(cpu);
    const passCpu = perTile([cpu], pass.success);
    if (passCpu) samplesCpuUs.push(passCpu.totalUs);
    samplesRps.push(round(pass.success / s.passSeconds, 2));
    samplesP99Ms.push(pass.p99Ms);
    if (pass.p50Ms !== null) p50s.push(pass.p50Ms);
    if (pass.p99Ms !== null) p99s.push(pass.p99Ms);
    completed += pass.completed;
    success += pass.success;
    transportErrors += pass.transportErrors;
    wallS += s.passSeconds;
    if (pass.bytesPerRequest !== null) bytes = pass.bytesPerRequest;
    for (const [code, count] of Object.entries(pass.statusCodes)) statusCodes[code] = (statusCodes[code] ?? 0) + count;
    for (const [e, count] of Object.entries(pass.errorDistribution)) if (e !== OHA_DEADLINE_ABORT) errorDistribution[e] = (errorDistribution[e] ?? 0) + count;
  }
  const total = completed + transportErrors;
  const engineMs = cpus.reduce((sum, w) => sum + w.engineMs, 0);
  return {
    connections,
    tiles: "list" in target ? target.tiles : 1,
    samplesRps,
    samplesP99Ms,
    rps: round(mean(samplesRps), 2),
    p50Ms: p50s.length ? round(percentile(p50s, 0.5), 3) : null,
    p99Ms: p99s.length ? round(percentile(p99s, 0.5), 3) : null,
    errorRate: total > 0 ? round((total - success) / total, 4) : 1,
    completed,
    transportErrors,
    statusCodes,
    errorDistribution,
    bytesPerRequest: bytes,
    cpu: perTile(cpus, success),
    samplesCpuUs,
    engineCores: round(engineMs / 1000 / wallS, 2),
  };
}

function logThroughput(label: string, r: ThroughputResult): void {
  console.log(`    ${label}: ${r.rps} tiles/s, p50 ${r.p50Ms ?? "n/a"} ms, p99 ${r.p99Ms ?? "n/a"} ms, ${r.cpu ? `cpu ${r.cpu.engineUs} us/tile${r.cpu.dbUs !== null ? ` + db ${r.cpu.dbUs}` : ""}, ` : ""}${r.engineCores} cores, errors ${(r.errorRate * 100).toFixed(2)}%`);
}

export async function concurrency(c: Candidate, spec: TileSpec, connections: number, p: Protocol): Promise<ThroughputResult> {
  const r = await closedLoop(c, { url: tileUrl(c, spec.layer, spec.tile) }, connections, p.concurrency, p.requestTimeoutSeconds);
  logThroughput(`c=${connections}`, r);
  return r;
}

export async function walk(c: Candidate, p: Protocol): Promise<ThroughputResult> {
  const paths = walkPaths(c);
  const r = await closedLoop(c, { list: writeUrlList(c, "walk", paths), tiles: paths.length }, p.walk.connections, p.walk, p.requestTimeoutSeconds);
  logThroughput(`walk c=${p.walk.connections} over ${paths.length} tiles`, r);
  return r;
}

// ---- open-loop ladder -------------------------------------------------------------------------

export interface LadderStep {
  offeredRps: number;
  connections: number;
  statusCodes: Record<string, number>;
  errorDistribution: Record<string, number>;
  achievedRps: number;
  p50Ms: number | null;
  p99Ms: number | null;
  p999Ms: number | null;
  maxMs: number | null;
  errorRate: number;
  cpu: CpuPerTile | null;
  held: boolean;
}

export interface LadderResult {
  sloMs: number;
  steps: LadderStep[];
  /** Highest offered rate held with p99 within the SLO, no errors beyond 0.1%, and 95% of the rate delivered. */
  capacityRps: number;
}

/** Open-loop offered load over the walk, stepping up until a step is not held. */
export async function ladder(c: Candidate, p: Protocol): Promise<LadderResult> {
  const { rates, sloMs } = LADDER[c.family];
  const paths = walkPaths(c);
  const list = writeUrlList(c, "walk", paths);
  const headers = REQUEST_HEADERS[c.family];
  const steps: LadderStep[] = [];
  let capacityRps = 0;
  for (const rate of rates) {
    const connections = ladderConnections(c.family, rate);
    oha("", { connections, timeoutSeconds: p.requestTimeoutSeconds, headers, urlsFromFile: list, rate, durationSeconds: p.ladder.warmupSeconds });
    const { pass, cpu } = await measuredPass(c, () => oha("", { connections, timeoutSeconds: p.requestTimeoutSeconds, headers, urlsFromFile: list, rate, durationSeconds: p.ladder.stepSeconds }));
    const total = pass.completed + pass.transportErrors;
    const errorRate = total > 0 ? round((total - pass.success) / total, 4) : 1;
    const achievedRps = round(pass.success / p.ladder.stepSeconds, 1);
    const held = pass.p99Ms !== null && pass.p99Ms <= sloMs && errorRate <= 0.001 && achievedRps >= 0.95 * rate;
    const errorDistribution = Object.fromEntries(Object.entries(pass.errorDistribution).filter(([k]) => k !== OHA_DEADLINE_ABORT));
    steps.push({ offeredRps: rate, connections, statusCodes: pass.statusCodes, errorDistribution, achievedRps, p50Ms: pass.p50Ms, p99Ms: pass.p99Ms, p999Ms: pass.p999Ms, maxMs: pass.maxMs, errorRate, cpu: perTile([cpu], pass.success), held });
    console.log(`    offered ${rate}/s: delivered ${achievedRps}/s, p50 ${pass.p50Ms ?? "n/a"} ms, p99 ${pass.p99Ms ?? "n/a"} ms, errors ${(errorRate * 100).toFixed(2)}% ${held ? "held" : "NOT held"}`);
    if (!held) break;
    capacityRps = rate;
  }
  return { sloMs, steps, capacityRps };
}

// ---- map sessions ---------------------------------------------------------------------------------

export interface SessionResult {
  users: number;
  views: number;
  requests: number;
  /** Every recorded view's wall time, ms. */
  samplesMs: number[];
  /** Per-view wall time from first request to last tile, ms. */
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  tilesPerSecond: number;
  failures: number;
  statuses: Record<string, number>;
  /** Mean view time per zoom level, ms. */
  byZoom: Record<string, number>;
  cpu: CpuPerTile | null;
}

export async function session(c: Candidate, users: number, p: Protocol): Promise<SessionResult> {
  const before = await snapshot(c);
  const out = JSON.parse(
    clientExec(["bun", "/app/src/client/session.ts", JSON.stringify({ candidateId: c.id, origin: engineOrigin(c), users, rounds: p.session.rounds, headers: REQUEST_HEADERS[c.family], timeoutMs: p.requestTimeoutSeconds * 1000 })], 3_600_000),
  ) as { elapsedMs: number; views: { zoom: number; requests: number; wallMs: number; failures: number; statuses: Record<string, number> }[] };
  const after = await snapshot(c);
  const views = out.views;
  const wall = views.map((v) => v.wallMs);
  const requests = views.reduce((s, v) => s + v.requests, 0);
  // Recounted from the status codes so every run file uses the same rule: 204 and 404 are empty tiles.
  const failures = views.reduce((s, v) => s + Object.entries(v.statuses).reduce((n, [code, count]) => (code === "error" || (Number(code) >= 300 && code !== "404") ? n + count : n), 0), 0);
  const statuses: Record<string, number> = {};
  for (const v of views) for (const [k, n] of Object.entries(v.statuses)) statuses[k] = (statuses[k] ?? 0) + n;
  const zooms = [...new Set(views.map((v) => v.zoom))].sort((a, b) => a - b);
  const byZoom: Record<string, number> = {};
  for (const z of zooms) byZoom[String(z)] = round(mean(views.filter((v) => v.zoom === z).map((v) => v.wallMs)), 2);
  // Recorded rounds only: the per-user wall time spent in recorded views, for a tiles-per-second figure.
  const recordedMs = users > 0 ? wall.reduce((s, w) => s + w, 0) / users : 0;
  const result: SessionResult = {
    users,
    views: views.length,
    requests,
    samplesMs: wall.map((w) => round(w, 2)),
    meanMs: round(mean(wall), 2),
    p50Ms: round(percentile(wall, 0.5), 2),
    p95Ms: round(percentile(wall, 0.95), 2),
    maxMs: round(Math.max(...wall), 2),
    tilesPerSecond: recordedMs > 0 ? round(requests / (recordedMs / 1000), 1) : 0,
    failures,
    statuses,
    byZoom,
    // CPU spans the warmup round too; per-tile uses every request made in the window.
    cpu: perTile([cpuBetween(before, after)], Math.round(requests * ((p.session.rounds + 1) / p.session.rounds))),
  };
  console.log(`    session x${users}: view mean ${result.meanMs} ms, p95 ${result.p95Ms} ms over ${result.views} views / ${requests} tiles, failures ${failures}`);
  return result;
}
