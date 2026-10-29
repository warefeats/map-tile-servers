import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Candidate, MARTIN_2 } from "./matrix";

const ROOT = join(import.meta.dirname!, "..");
const COMPOSE_DIR = join(ROOT, "compose");

/** The Docker Engine socket: DOCKER_HOST if it names one, else OrbStack's, else the default. */
function socketPath(): string {
  const fromEnv = process.env.DOCKER_HOST?.replace(/^unix:\/\//, "");
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const orb = join(homedir(), ".orbstack", "run", "docker.sock");
  if (existsSync(orb)) return orb;
  return "/var/run/docker.sock";
}

const SOCKET = socketPath();

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`http://docker${path}`, { unix: SOCKET } as RequestInit);
  if (!response.ok) throw new Error(`docker API ${path} -> ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

interface StatsJson {
  cpu_stats: { cpu_usage: { total_usage: number } };
  memory_stats: { usage?: number; stats?: Record<string, number> };
}

export interface ContainerSample {
  /** Cumulative CPU time of the container's cgroup, nanoseconds. */
  cpuNs: number;
  /** cgroup memory minus inactive file pages: what `docker stats` shows. */
  memMb: number;
  /** Anonymous memory (heap, stacks): what the process itself holds. */
  anonMb: number;
  /** File-backed pages charged to the container (page cache, mmapped archives). */
  fileMb: number;
}

const MB = 1024 * 1024;

/** One-shot cgroup counters for a container, straight from the Engine API (no `docker stats` rounding). */
export async function sample(container: string): Promise<ContainerSample> {
  const s = await api<StatsJson>(`/containers/${container}/stats?stream=false&one-shot=true`);
  const stats = s.memory_stats.stats ?? {};
  const usage = s.memory_stats.usage ?? 0;
  const inactiveFile = stats["inactive_file"] ?? 0;
  return {
    cpuNs: s.cpu_stats.cpu_usage.total_usage,
    memMb: (usage - inactiveFile) / MB,
    anonMb: (stats["anon"] ?? 0) / MB,
    fileMb: (stats["file"] ?? 0) / MB,
  };
}

interface InspectJson {
  State: { StartedAt: string; Running: boolean; Pid: number };
  Image: string;
  Config: { Image: string };
}

export async function inspect(container: string): Promise<InspectJson> {
  return api<InspectJson>(`/containers/${container}/json`);
}

/** Throws unless the engine container runs `image`: a compose default once swapped in another build unnoticed. */
export async function assertEngineImage(c: Candidate, container: { Image: string; Config: { Image: string } }): Promise<void> {
  const want = await api<{ Id: string }>(`/images/${encodeURIComponent(c.image)}/json`);
  if (container.Image !== want.Id) throw new Error(`${c.id} ran ${container.Config.Image} (${container.Image}), not ${c.image} (${want.Id})`);
}

export async function imageDigest(image: string): Promise<string> {
  const img = await api<{ Id: string; RepoDigests?: string[] }>(`/images/${encodeURIComponent(image)}/json`);
  return img.RepoDigests?.[0] ?? img.Id;
}

/** Docker timestamps carry nanoseconds; keep them as epoch microseconds so sub-millisecond cold starts survive. */
export function parseDockerTimeUs(raw: string): number {
  const m = raw.match(/^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/);
  if (!m) throw new Error(`unparseable Docker time ${raw}`);
  const whole = Date.parse(`${m[1]}Z`);
  const frac = (m[2] ?? "0").padEnd(6, "0").slice(0, 6);
  return whole * 1000 + Number(frac);
}

export function run(args: string[], opts: { timeoutMs?: number; quiet?: boolean; input?: string } = {}): { exitCode: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(args, {
    // runtime changes to process.env (WF_MARTIN_2_IMAGE) reach a child only when passed explicitly; without
    // the variable, compose would have no Martin 2.0 image, so it always carries the one the matrix measures
    env: { ...process.env, WF_MARTIN_2_IMAGE: process.env.WF_MARTIN_2_IMAGE ?? MARTIN_2.image },
    stdout: "pipe",
    stderr: "pipe",
    stdin: opts.input !== undefined ? new TextEncoder().encode(opts.input) : "ignore",
    timeout: opts.timeoutMs ?? 300_000,
  });
  const stderr = result.stderr?.toString() ?? "";
  if (!opts.quiet && result.exitCode !== 0 && stderr) process.stderr.write(stderr);
  return { exitCode: result.exitCode ?? -1, stdout: result.stdout.toString(), stderr };
}

// ---- engines -------------------------------------------------------------------------------

export function composeProject(c: Candidate, variant = ""): string {
  return `m2-${c.id}${variant ? `-${variant}` : ""}`;
}

export function engineContainer(c: Candidate, variant = ""): string {
  return `${composeProject(c, variant)}-engine-1`;
}

function composeFiles(c: Candidate, variant: string): string[] {
  const base = join(COMPOSE_DIR, c.family, `${c.id}.yml`);
  const files = ["-f", base];
  if (variant) files.push("-f", join(COMPOSE_DIR, c.family, `${c.id}.${variant}.yml`));
  return files;
}

function compose(c: Candidate, variant: string, ...args: string[]): string[] {
  return ["docker", "compose", "--project-directory", join(COMPOSE_DIR, c.family), ...composeFiles(c, variant), "-p", composeProject(c, variant), ...args];
}

export function engineUp(c: Candidate, variant = ""): void {
  const r = run(compose(c, variant, "up", "-d", "--no-build", "--pull", "never"), { timeoutMs: 180_000 });
  if (r.exitCode !== 0) throw new Error(`compose up failed for ${c.id}${variant ? ` (${variant})` : ""}: ${r.stderr.slice(-400)}`);
}

export function engineDown(c: Candidate, variant = ""): void {
  run(compose(c, variant, "down", "--remove-orphans", "--timeout", "10"), { quiet: true, timeoutMs: 120_000 });
}

export function engineLogs(c: Candidate, variant = "", tail = 40): string {
  const r = run(compose(c, variant, "logs", "--no-color", "--tail", String(tail)), { quiet: true, timeoutMs: 30_000 });
  return r.stdout + r.stderr;
}

export function imageExists(image: string): boolean {
  return run(["docker", "image", "inspect", image], { quiet: true }).exitCode === 0;
}

/** Stop every engine this runner may have left running, so exactly one answers to `engine`. */
export function stopAllEngines(): void {
  const r = run(["docker", "ps", "-a", "--filter", "label=com.docker.compose.service=engine", "--format", "{{.Names}}"], { quiet: true });
  const names = r.stdout.split("\n").filter((n) => n.startsWith("m2-"));
  if (names.length) run(["docker", "rm", "-f", ...names], { quiet: true });
}

// ---- the shared database and the measurement client ---------------------------------------

export const NETWORK = "m2";
/** compose/db.yml's image: the tag every run so far pulled (last pushed 2026-02-09), pinned to that push. */
export const DB_IMAGE = "imresamu/postgis:18-3.6@sha256:b5766ee720aca09c61b9a868abefbf273348a4b90ad4cf146b4f8c9ac85d48e4";
export const DB_CONTAINER = "m2-db";
export const CLIENT_CONTAINER = "m2-client";
export const CLIENT_IMAGE = "wf-client:1";

export function ensureNetwork(): void {
  if (run(["docker", "network", "inspect", NETWORK], { quiet: true }).exitCode !== 0) run(["docker", "network", "create", NETWORK]);
}

export function dbUp(): void {
  const r = run(["docker", "compose", "--project-directory", COMPOSE_DIR, "-f", join(COMPOSE_DIR, "db.yml"), "-p", "m2-db", "up", "-d", "--wait", "--wait-timeout", "180", "db"], { timeoutMs: 240_000 });
  if (r.exitCode !== 0) throw new Error(`database did not come up: ${r.stderr.slice(-400)}`);
}

export function dbDown(): void {
  run(["docker", "compose", "--project-directory", COMPOSE_DIR, "-f", join(COMPOSE_DIR, "db.yml"), "-p", "m2-db", "stop"], { quiet: true, timeoutMs: 120_000 });
}

export function psql(sql: string, opts: { db?: string; user?: string } = {}): string {
  const r = run(["docker", "exec", "-i", DB_CONTAINER, "psql", "-U", opts.user ?? "postgres", "-d", opts.db ?? "bench", "-v", "ON_ERROR_STOP=1", "-At", "-q"], { input: sql, timeoutMs: 1_800_000 });
  if (r.exitCode !== 0) throw new Error(`psql failed: ${r.stderr.slice(-600)}`);
  return r.stdout.trim();
}

/**
 * The client container sits on the engine network with a CPU budget of its own. Archive runs give
 * it 6 CPUs (a 242 KB tile at 55k/s through nginx needed about that); PostGIS runs give it 2,
 * so the database keeps its 6 and the engine its 4.
 */
export function clientUp(cpus: number): void {
  const exists = run(["docker", "inspect", CLIENT_CONTAINER], { quiet: true }).exitCode === 0;
  if (!exists) {
    const r = run(["docker", "run", "-d", "--name", CLIENT_CONTAINER, "--network", NETWORK, "--cpus", String(cpus), "-v", `${ROOT}:/app:ro`, "-v", `${join(ROOT, ".work")}:/work`, CLIENT_IMAGE]);
    if (r.exitCode !== 0) throw new Error("client container failed to start");
  } else {
    run(["docker", "start", CLIENT_CONTAINER], { quiet: true });
    run(["docker", "update", "--cpus", String(cpus), CLIENT_CONTAINER], { quiet: true });
  }
}

/** Run a command inside the client container and return its stdout. */
export function clientExec(args: string[], timeoutMs: number): string {
  const r = run(["docker", "exec", CLIENT_CONTAINER, ...args], { timeoutMs, quiet: true });
  if (r.exitCode !== 0) throw new Error(`client command failed (exit ${r.exitCode}): ${args.slice(0, 3).join(" ")} … ${r.stderr.slice(-400)}`);
  return r.stdout;
}

/** Start a long-running command in the client container without waiting for it. */
export function clientSpawn(args: string[]): ReturnType<typeof Bun.spawn> {
  return Bun.spawn(["docker", "exec", CLIENT_CONTAINER, ...args], { stdout: "pipe", stderr: "pipe" });
}

export const WORK_DIR = join(ROOT, ".work");
