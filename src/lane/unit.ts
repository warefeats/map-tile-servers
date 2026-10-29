/**
 * One unit of the archive lane on its client instance (docs/adr/0011): the popularity replay against one server
 * over the network, a warm-up of fixed length, then the capacity search, with each request carrying what a
 * browser sends. An empty tile (204 or 404) is an answer, not an error, as in the diagnostic lane.
 *   bun run src/lane/unit.ts --server=<id> --host=<ip> --tileset=planet --format=pmtiles --scenario=alone|cdn
 *     --replay=<z/x/y list> --out=<file.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { type OhaOptions, type OhaPass, ohaArgs, ohaBudgetMs, parseOha } from "../oha";
import { findCapacity, held, type StepOutcome } from "./capacity";
import { LANE_SERVERS, tileUrl } from "./servers";

/** What a current browser sends for a tile. */
export const BROWSER_HEADERS = { Accept: "*/*", "Accept-Encoding": "gzip, deflate, br, zstd" };
export const TARGET_MS = 50;
const TIMEOUT_S = 10;
/** Warm-up, and each capacity step's unrecorded and recorded seconds; --quick is for smokes. */
export const TIMING = { full: { warmupS: 120, stepWarmupS: 10, stepS: 20 }, quick: { warmupS: 10, stepWarmupS: 3, stepS: 5 } };

/** Enough connections to carry a rate at 5 ms a request, so the client never queues what the server could take. */
export const connections = (rps: number) => Math.min(1024, Math.max(32, Math.ceil(rps * 0.005)));

/** Answers that are not errors: every 2xx, and 404, which some servers send for a tile the archive lacks. */
export function answered(statusCodes: Record<string, number>): number {
  return Object.entries(statusCodes).reduce((s, [code, n]) => (code.startsWith("2") || code === "404" ? s + n : s), 0);
}

export interface Step extends StepOutcome {
  p50Ms: number | null;
  bytesPerRequest: number | null;
  statusCodes: Record<string, number>;
}

export function stepOf(rps: number, pass: OhaPass, seconds: number, targetMs: number): Step {
  const total = pass.completed + pass.transportErrors;
  const ok = answered(pass.statusCodes);
  const errorRate = total > 0 ? (total - ok) / total : 1;
  const achievedRps = ok / seconds;
  return { offeredRps: rps, achievedRps, p50Ms: pass.p50Ms, p99Ms: pass.p99Ms, errorRate, held: held(rps, achievedRps, pass.p99Ms, errorRate, targetMs), bytesPerRequest: pass.bytesPerRequest, statusCodes: pass.statusCodes };
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
  console.log(`warm-up: ${t.warmupS} s, 64 connections, ${lines.length} replay lines`);
  const warmup = oha({ ...base, connections: 64, durationSeconds: t.warmupS });
  const capacity = await findCapacity(
    async (rps) => {
      oha({ ...base, connections: connections(rps), rate: rps, durationSeconds: t.stepWarmupS });
      const s = stepOf(rps, oha({ ...base, connections: connections(rps), rate: rps, durationSeconds: t.stepS }), t.stepS, TARGET_MS);
      console.log(`  offered ${rps}/s: delivered ${s.achievedRps.toFixed(1)}/s, p99 ${s.p99Ms ?? "n/a"} ms, errors ${(s.errorRate * 100).toFixed(2)}% ${s.held ? "held" : "NOT held"}`);
      return s;
    },
    { startRps: 1000, maxRps: 256_000, minRps: 125, bisections: 3 },
  );
  const atCapacity = (capacity.steps as Step[]).filter((s) => s.held && s.offeredRps === capacity.capacityRps).at(-1) ?? null;
  writeFileSync(out, JSON.stringify({ server: server.id, version: server.version, tileset, format: arg("format"), scenario, timing: t, targetMs: TARGET_MS, replayLines: lines.length, warmup: { rps: warmup.requestsPerSec, p99Ms: warmup.p99Ms, statusCodes: warmup.statusCodes }, capacity, bytesPerTile: atCapacity?.bytesPerRequest ?? null, p99AtCapacityMs: atCapacity?.p99Ms ?? null }, null, 2) + "\n");
  console.log(`capacity ${capacity.capacityRps}/s${capacity.atCeiling ? " (at the ceiling)" : ""}, ${atCapacity?.bytesPerRequest ?? "?"} bytes a tile`);
}
