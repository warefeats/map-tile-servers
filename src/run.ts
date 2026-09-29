import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { clientExec, clientUp, dbUp, ensureNetwork, engineDown, imageDigest, imageExists, psql, run, stopAllEngines, WORK_DIR } from "./docker";
import { type Candidate, CANDIDATES, type Family, LADDER, protocol, REQUEST_HEADERS, TILES, tileUrl, VIEWPORT, WALK } from "./matrix";
import { alternateHeaders, burst, type BurstResult, type ColdStartResult, coldStart, concurrency, type LadderResult, ladder, type MemoryReading, memory, type ParityResult, parity, type SessionResult, session, type SingleTileResult, singleTile, type ThroughputResult, walk } from "./measure";
import { flight } from "./session-plan";

export interface CandidateResult {
  id: string;
  image: string;
  imageDigest: string;
  startedAt: string;
  durationS: number;
  hostLoad: { before: number[]; vmBefore: number[]; vmBusyCores?: number };
  coldStart?: ColdStartResult;
  parity?: ParityResult;
  single?: Record<string, SingleTileResult>;
  /** The marquee tile under the family's other encoding; on record, never ranked. */
  singleAlternate?: SingleTileResult;
  burst?: BurstResult;
  concurrency?: Record<string, ThroughputResult>;
  walk?: ThroughputResult;
  memoryAfterLoad?: MemoryReading;
  ladder?: LadderResult;
  sessions?: Record<string, SessionResult>;
  memoryAfterSessions?: MemoryReading;
}

export interface RawResults {
  schemaVersion: 1;
  family: Family;
  generatedAt: string;
  smoke: boolean;
  environment: Record<string, unknown>;
  corpus: Record<string, unknown>;
  results: CandidateResult[];
  failures: { id: string; error: string }[];
}

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const family = (flag("family") ?? "archive") as Family;
const smoke = args.includes("--smoke");
const resume = args.includes("--resume");
const only = flag("candidates")?.split(",");
const skip = new Set(flag("skip-sections")?.split(",") ?? []);
const outputPath = flag("output") ?? join(import.meta.dirname!, "..", `results-${family}${smoke ? "-smoke" : ""}.json`);
const plan = protocol(family, smoke);

const candidates = CANDIDATES.filter((c) => c.family === family && (!only || only.includes(c.id)));
if (candidates.length === 0) {
  console.error(`no candidate matches; known ${family} candidates: ${CANDIDATES.filter((c) => c.family === family).map((c) => c.id).join(", ")}`);
  process.exit(1);
}

function hostLoad(): number[] {
  const raw = process.platform === "linux" ? readFileSync("/proc/loadavg", "utf8") : run(["sysctl", "-n", "vm.loadavg"], { quiet: true }).stdout;
  return raw.replace(/[{}]/g, "").trim().split(/\s+/).slice(0, 3).map(Number);
}

function vmLoad(): number[] {
  return clientExec(["cat", "/proc/loadavg"], 10_000).trim().split(/\s+/).slice(0, 3).map(Number);
}

/** CPU cores busy in the VM over `ms`, from /proc/stat (the load average lags by a minute or more). */
async function vmBusyCores(ms: number): Promise<number> {
  const read = () => {
    const f = clientExec(["head", "-1", "/proc/stat"], 10_000).trim().split(/\s+/).slice(1).map(Number);
    const idle = (f[3] ?? 0) + (f[4] ?? 0);
    const total = f.reduce((a, b) => a + b, 0);
    return { idle, total };
  };
  const a = read();
  await Bun.sleep(ms);
  const b = read();
  const cpus = Number(clientExec(["nproc", "--all"], 10_000).trim()) || 12;
  const dt = b.total - a.total;
  return dt > 0 ? round2((1 - (b.idle - a.idle) / dt) * cpus) : 0;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Wait (up to five minutes) until the VM is quiet: under half a core busy over three seconds. */
async function waitForQuiet(): Promise<{ before: number[]; vmBefore: number[]; vmBusyCores: number }> {
  const deadline = Date.now() + 300_000;
  let busy = await vmBusyCores(3_000);
  while (busy > 0.5 && Date.now() < deadline) {
    console.log(`  waiting for a quiet VM (${busy} cores busy)`);
    busy = await vmBusyCores(3_000);
  }
  return { before: hostLoad(), vmBefore: vmLoad(), vmBusyCores: busy };
}

function environment(): Record<string, unknown> {
  const sys = (k: string) => run(["sysctl", "-n", k], { quiet: true }).stdout.trim();
  const docker = run(["docker", "version", "--format", "{{.Server.Version}}"], { quiet: true }).stdout.trim();
  const vmCpus = run(["docker", "info", "--format", "{{.NCPU}}"], { quiet: true }).stdout.trim();
  const vmMem = run(["docker", "info", "--format", "{{.MemTotal}}"], { quiet: true }).stdout.trim();
  const kernel = run(["docker", "info", "--format", "{{.KernelVersion}}"], { quiet: true }).stdout.trim();
  const ohaVersion = clientExec(["oha", "--version"], 10_000).trim();
  const measurement = {
    loadGenerator: `${ohaVersion} in a container on the engine's Docker network`,
    clientCpus: family === "archive" ? 6 : 2,
    engineLimits: "4 CPUs, 4 GB per engine container",
    database: family === "postgis" ? "PostgreSQL 18 + PostGIS 3.6 (imresamu/postgis:18-3.6), 6 CPUs, 12 GB, shared_buffers 2GB" : null,
  };
  // On Linux the containers run on the host itself, with no VM between them and the machine.
  if (process.platform === "linux") {
    const cpu = run(["lscpu"], { quiet: true }).stdout.match(/^Model name:\s*(.+)$/m)?.[1]?.trim() ?? "";
    const memKb = Number(readFileSync("/proc/meminfo", "utf8").match(/^MemTotal:\s+(\d+)/m)?.[1] ?? 0);
    const os = readFileSync("/etc/os-release", "utf8").match(/^PRETTY_NAME="?([^"\n]+)"?$/m)?.[1] ?? "Linux";
    return {
      machine: process.env.WF_MACHINE ?? "Linux host",
      chip: cpu,
      cores: Number(vmCpus),
      memoryGb: Math.round((memKb * 1024) / 1024 ** 3),
      os,
      kernel,
      docker: `Docker ${docker}`,
      vm: null,
      ...measurement,
    };
  }
  const orb = run(["orb", "version"], { quiet: true }).stdout.trim().split("\n")[0] ?? "";
  return {
    machine: sys("hw.model"),
    chip: sys("machdep.cpu.brand_string"),
    cores: Number(sys("hw.ncpu")),
    performanceCores: Number(sys("hw.perflevel0.physicalcpu")),
    efficiencyCores: Number(sys("hw.perflevel1.physicalcpu")),
    memoryGb: Math.round(Number(sys("hw.memsize")) / 1024 ** 3),
    os: `macOS ${run(["sw_vers", "-productVersion"], { quiet: true }).stdout.trim()}`,
    docker: `Docker ${docker} (${orb})`,
    vm: { cpus: Number(vmCpus), memoryGb: Math.round(Number(vmMem) / 1024 ** 3), kernel },
    ...measurement,
  };
}

function corpus(): Record<string, unknown> {
  if (family === "postgis") {
    const counts = psql("SELECT (SELECT count(*) FROM bench.buildings) || '|' || (SELECT count(*) FROM bench.roads) || '|' || (SELECT count(*) FROM bench.pois) || '|' || (SELECT count(*) FROM bench.boundaries) || '|' || (SELECT value FROM bench.meta WHERE key = 'corpus_md5')");
    const [buildings, roads, pois, boundaries, md5] = counts.split("|");
    return { source: "Geofabrik Berlin 2026-01-01", md5, tables: { buildings: Number(buildings), roads: Number(roads), pois: Number(pois), boundaries: Number(boundaries) } };
  }
  const size = (f: string) => Number(run(["stat", "-f", "%z", join(import.meta.dirname!, "..", "data", "cache", f)], { quiet: true }).stdout.trim());
  return { source: "Planetiler 0.10.2 OpenMapTiles build of Geofabrik Berlin 2026-01-01", archives: { "berlin.mbtiles": size("berlin.mbtiles"), "berlin.pmtiles": size("berlin.pmtiles") } };
}

async function measureCandidate(c: Candidate): Promise<CandidateResult> {
  const started = Date.now();
  const tiles = TILES[family];
  const marquee = tiles[0]!;
  const headers = { ...REQUEST_HEADERS[family] };
  const load = await waitForQuiet();
  const r: CandidateResult = { id: c.id, image: c.image, imageDigest: await imageDigest(c.image), startedAt: new Date(started).toISOString(), durationS: 0, hostLoad: load };

  console.log("  cold start");
  r.coldStart = await coldStart(c, tileUrl(c, marquee.layer, marquee.tile), headers, plan.coldStart.reps, plan.coldStart.timeoutMs);
  console.log("  parity");
  r.parity = parity(c, tiles);
  if (!skip.has("single")) {
    console.log("  single tile (1 connection)");
    r.single = {};
    for (const spec of tiles) r.single[spec.id] = await singleTile(c, spec, plan, headers);
    r.singleAlternate = await singleTile(c, marquee, plan, alternateHeaders(c));
  }
  if (!skip.has("burst")) {
    console.log("  viewport burst");
    r.burst = burst(c, plan);
  }
  if (!skip.has("concurrency")) {
    console.log("  concurrency (marquee tile)");
    r.concurrency = {};
    for (const level of plan.concurrency.levels) r.concurrency[String(level)] = await concurrency(c, marquee, level, plan);
  }
  if (!skip.has("walk")) {
    console.log("  random walk");
    r.walk = await walk(c, plan);
  }
  r.memoryAfterLoad = await memory(c);
  console.log(`    memory after load: ${r.memoryAfterLoad.memMb.toFixed(1)} MiB (anon ${r.memoryAfterLoad.anonMb.toFixed(1)}, file ${r.memoryAfterLoad.fileMb.toFixed(1)})`);
  if (!skip.has("ladder")) {
    console.log("  latency under offered load");
    r.ladder = await ladder(c, plan);
  }
  if (!skip.has("session")) {
    console.log("  map sessions");
    r.sessions = {};
    for (const users of plan.session.users) r.sessions[String(users)] = await session(c, users, plan);
    r.memoryAfterSessions = await memory(c);
  }
  r.durationS = Math.round((Date.now() - started) / 1000);
  return r;
}

async function loadExisting(): Promise<RawResults | undefined> {
  try {
    return (await Bun.file(outputPath).json()) as RawResults;
  } catch {
    return undefined;
  }
}

mkdirSync(WORK_DIR, { recursive: true });
ensureNetwork();
if (family === "postgis") {
  console.log("database: up");
  dbUp();
  // Every candidate should meet the same warm buffer cache, not only the ones after the first.
  const warmed = psql(
    "CREATE EXTENSION IF NOT EXISTS pg_prewarm; SELECT sum(pg_prewarm(c.oid::regclass)) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'bench' AND c.relkind IN ('r', 'i');",
  );
  console.log(`database: prewarmed ${warmed} blocks of schema bench`);
}
clientUp(family === "archive" ? 6 : 2);

const existing = resume ? await loadExisting() : undefined;
const results: CandidateResult[] = existing?.results ?? [];
const failures: { id: string; error: string }[] = (existing?.failures ?? []).filter((f) => !candidates.some((c) => c.id === f.id));
const env = environment();
const corp = corpus();

async function save(): Promise<void> {
  const out: RawResults & { protocol: unknown } = {
    schemaVersion: 1,
    family,
    generatedAt: new Date().toISOString(),
    smoke,
    environment: env,
    corpus: corp,
    protocol: { ...plan, ladder: { ...plan.ladder, ...LADDER[family] }, tiles: TILES[family], viewport: VIEWPORT[family], walk: WALK, flight: flight(family) },
    results,
    failures,
  };
  await Bun.write(outputPath, JSON.stringify(out, null, 2) + "\n");
}

console.log(`martin-2 runner: ${family}, ${smoke ? "SMOKE" : "FULL"} protocol, ${candidates.length} candidate(s): ${candidates.map((c) => c.id).join(", ")}`);
for (const c of candidates) {
  if (resume && results.some((r) => r.id === c.id)) {
    console.log(`\n> ${c.id}: already measured, skipping`);
    continue;
  }
  console.log(`\n> ${c.id} (${c.image})`);
  if (!imageExists(c.image)) {
    failures.push({ id: c.id, error: `image ${c.image} is not present locally (the runner never pulls during a run)` });
    await save();
    continue;
  }
  stopAllEngines();
  try {
    const result = await measureCandidate(c);
    const i = results.findIndex((x) => x.id === c.id);
    if (i >= 0) results.splice(i, 1);
    results.push(result);
    const f = failures.findIndex((x) => x.id === c.id);
    if (f >= 0) failures.splice(f, 1);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`  FAILED ${c.id}: ${message}`);
    failures.push({ id: c.id, error: message });
  } finally {
    engineDown(c);
    await save();
    console.log(`  [saved ${results.length} result(s), ${failures.length} failure(s) to ${outputPath}]`);
  }
}
console.log(`\nDone: ${results.length} measured, ${failures.length} failed.`);
if (failures.length) process.exit(1);
