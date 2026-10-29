/**
 * One unit of the archive lane on its client instance (docs/adr/0011): the popularity replay against one server
 * over the network, a warm-up of fixed length, then the capacity search, with each request carrying what a
 * browser sends. An empty tile (204 or 404) is an answer, not an error, as in the diagnostic lane. It starts with
 * the first view a user loads from the just-started server, and records its own CPU in every step, so a capacity
 * the client could not offer is never credited to the server. With the server alone, simulated map users load
 * views from the warm server, 10 and then 100 of them, before the capacity search; behind a CDN they would load
 * from the CDN, so that scenario has none.
 *   bun run src/lane/unit.ts --server=<id> --host=<ip> --tileset=planet --format=pmtiles --scenario=alone|cdn
 *     --replay=<z/x/y list> --out=<file.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Agent } from "node:http";
import { get } from "../client/http";
import { type OhaOptions, type OhaPass, ohaArgs, ohaBudgetMs, parseOha } from "../oha";
import { BERLIN, CONNECTIONS_PER_USER, viewTiles } from "../session-plan";
import { findCapacity, held, type StepOutcome } from "./capacity";
import { type LaneServer, LANE_SERVERS, tileUrl } from "./servers";
import { runUsers, type UsersResult } from "./users";

/** What a current browser sends for a tile. */
export const BROWSER_HEADERS = { Accept: "*/*", "Accept-Encoding": "gzip, deflate, br, zstd" };
export const TARGET_MS = 50;
const TIMEOUT_S = 10;
/** Warm-up, and each capacity step's unrecorded and recorded seconds; --quick is for smokes. */
export const TIMING = { full: { warmupS: 120, stepWarmupS: 10, stepS: 20, usersS: 60 }, quick: { warmupS: 10, stepWarmupS: 3, stepS: 5, usersS: 10 } };
export const USER_COUNTS = [10, 100];

/** Enough connections to carry a rate at 5 ms a request, so the client never queues what the server could take. */
export const connections = (rps: number) => Math.min(1024, Math.max(32, Math.ceil(rps * 0.005)));

/** A step whose client was this busy may have measured the client; the report says so. */
export const CLIENT_BUSY = 0.9;

/** Answers that are not errors: every 2xx, and 404, which some servers send for a tile the archive lacks. */
export function answered(statusCodes: Record<string, number>): number {
  return Object.entries(statusCodes).reduce((s, [code, n]) => (code.startsWith("2") || code === "404" ? s + n : s), 0);
}

export interface Step extends StepOutcome {
  p50Ms: number | null;
  bytesPerRequest: number | null;
  statusCodes: Record<string, number>;
  /** The client's busy share of its CPU over the recorded pass; null off Linux. */
  clientCpu: number | null;
}

export function stepOf(rps: number, pass: OhaPass, seconds: number, targetMs: number, clientCpu: number | null = null): Step {
  const total = pass.completed + pass.transportErrors;
  const ok = answered(pass.statusCodes);
  const errorRate = total > 0 ? (total - ok) / total : 1;
  const achievedRps = ok / seconds;
  return { offeredRps: rps, achievedRps, p50Ms: pass.p50Ms, p99Ms: pass.p99Ms, errorRate, held: held(rps, achievedRps, pass.p99Ms, errorRate, targetMs), bytesPerRequest: pass.bytesPerRequest, statusCodes: pass.statusCodes, clientCpu };
}

/** The lowest offered rate the client failed to carry while it was busy, if any: above it, the capacity is the client's. */
export function clientBoundAt(steps: readonly Step[]): number | null {
  const bound = steps.filter((s) => !s.held && s.clientCpu !== null && s.clientCpu >= CLIENT_BUSY).map((s) => s.offeredRps);
  return bound.length ? Math.min(...bound) : null;
}

export interface CpuTimes {
  busy: number;
  total: number;
}

/** The first line of /proc/stat (user nice system idle iowait irq softirq steal), as the server's sampler reads it. */
export function parseCpu(procStat: string): CpuTimes {
  const n = procStat.split("\n")[0]!.trim().split(/\s+/).slice(1).map(Number);
  const busy = n[0]! + n[1]! + n[2]! + n[5]! + n[6]! + n[7]!;
  return { busy, total: busy + n[3]! + n[4]! };
}

function cpuTimes(): CpuTimes | null {
  try {
    return parseCpu(readFileSync("/proc/stat", "utf8"));
  } catch {
    return null;
  }
}

export function busyShare(before: CpuTimes | null, after: CpuTimes | null): number | null {
  if (!before || !after || after.total <= before.total) return null;
  return (after.busy - before.busy) / (after.total - before.total);
}

export interface FirstView {
  tiles: number;
  wallMs: number;
  slowestMs: number;
  bytes: number;
  statuses: Record<string, number>;
}

/**
 * The first view a user loads: Berlin's centre at zoom 14 in a 1920 x 1080 window, in both datasets, every tile
 * over a browser's six connections. Done when the last tile lands.
 */
export async function firstView(server: LaneServer, host: string, tileset: string, headers: Record<string, string>): Promise<FirstView> {
  const tiles = viewTiles({ ...BERLIN, zoom: 14 });
  const agent = new Agent({ keepAlive: true, maxSockets: CONNECTIONS_PER_USER });
  const started = performance.now();
  const fetched = await Promise.all(tiles.map((t) => get(tileUrl(server, host, tileset, t), headers, { agent, timeoutMs: 60_000 })));
  const wallMs = performance.now() - started;
  agent.destroy();
  const statuses: Record<string, number> = {};
  for (const f of fetched) statuses[f.status] = (statuses[f.status] ?? 0) + 1;
  return { tiles: tiles.length, wallMs, slowestMs: Math.max(...fetched.map((f) => f.ms)), bytes: fetched.reduce((a, f) => a + f.bytes, 0), statuses };
}

function oha(opts: OhaOptions): OhaPass {
  const p = Bun.spawnSync(ohaArgs("", opts), { timeout: ohaBudgetMs(opts) });
  if (p.exitCode !== 0) throw new Error(`oha exited ${p.exitCode}: ${p.stderr.toString().slice(-400)}`);
  return parseOha(p.stdout.toString());
}

if (import.meta.main) {
  const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
  const server = LANE_SERVERS.find((s) => s.id === arg("server"));
  const host = arg("host");
  const tileset = arg("tileset");
  const replay = arg("replay");
  const out = arg("out");
  const scenario = arg("scenario");
  if (!server || !host || !tileset || !replay || !out || (scenario !== "alone" && scenario !== "cdn")) {
    console.error("usage: unit.ts --server=<id> --host=<ip> --tileset=<name> --format=<f> --scenario=alone|cdn --replay=<file> --out=<file>");
    process.exit(2);
  }
  const t = process.argv.includes("--quick") ? TIMING.quick : TIMING.full;
  const urls = `${out}.urls`;
  const lines = readFileSync(replay, "utf8").split("\n").filter(Boolean);
  writeFileSync(
    urls,
    lines
      .map((l) => {
        const [z, x, y] = l.split("/").map(Number);
        return tileUrl(server, host, tileset, { z: z!, x: x!, y: y! });
      })
      .join("\n") + "\n",
  );
  const base = { timeoutSeconds: TIMEOUT_S, headers: BROWSER_HEADERS, urlsFromFile: urls };
  const first = await firstView(server, host, tileset, BROWSER_HEADERS);
  console.log(`first view: ${first.tiles} tiles in ${first.wallMs.toFixed(1)} ms`);
  console.log(`warm-up: ${t.warmupS} s, 64 connections, ${lines.length} replay lines`);
  const warmup = oha({ ...base, connections: 64, durationSeconds: t.warmupS });
  const users: UsersResult[] = [];
  if (scenario === "alone") {
    for (const n of USER_COUNTS) {
      const u = await runUsers(server, host, tileset, BROWSER_HEADERS, lines, n, t.usersS, 20261029 + n);
      users.push(u);
      console.log(`${n} users: ${u.views} views, load p50 ${u.p50Ms?.toFixed(1) ?? "n/a"} ms, p95 ${u.p95Ms?.toFixed(1) ?? "n/a"} ms, ${u.failures} failed tiles`);
    }
  }
  const capacity = await findCapacity(
    async (rps) => {
      oha({ ...base, connections: connections(rps), rate: rps, durationSeconds: t.stepWarmupS });
      const before = cpuTimes();
      const pass = oha({ ...base, connections: connections(rps), rate: rps, durationSeconds: t.stepS });
      const s = stepOf(rps, pass, t.stepS, TARGET_MS, busyShare(before, cpuTimes()));
      console.log(`  offered ${rps}/s: delivered ${s.achievedRps.toFixed(1)}/s, p99 ${s.p99Ms ?? "n/a"} ms, errors ${(s.errorRate * 100).toFixed(2)}%, client CPU ${s.clientCpu === null ? "n/a" : `${(s.clientCpu * 100).toFixed(0)}%`} ${s.held ? "held" : "NOT held"}`);
      return s;
    },
    { startRps: 1000, maxRps: 256_000, minRps: 125, bisections: 3 },
  );
  const atCapacity = (capacity.steps as Step[]).filter((s) => s.held && s.offeredRps === capacity.capacityRps).at(-1) ?? null;
  writeFileSync(out, JSON.stringify({ server: server.id, version: server.version, tileset, format: arg("format"), scenario, timing: t, targetMs: TARGET_MS, replayLines: lines.length, firstView: first, warmup: { rps: warmup.requestsPerSec, p99Ms: warmup.p99Ms, statusCodes: warmup.statusCodes }, users, capacity, clientBoundAtRps: clientBoundAt(capacity.steps as Step[]), bytesPerTile: atCapacity?.bytesPerRequest ?? null, p99AtCapacityMs: atCapacity?.p99Ms ?? null }, null, 2) + "\n");
  console.log(`capacity ${capacity.capacityRps}/s${capacity.atCeiling ? " (at the ceiling)" : ""}, ${atCapacity?.bytesPerRequest ?? "?"} bytes a tile`);
}
