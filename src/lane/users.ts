/**
 * Simulated map users for the archive lane (docs/adr/0011). Each starts where real users look, at a tile drawn
 * from the scenario's replay, which carries the day's popularity, and moves the way a map is used: a half-screen
 * pan most of the time, a zoom in or out now and then, with think time between views. A user keeps the tiles it
 * has loaded, as MapLibre does, so a view asks only for what it newly shows, over the user's own six connections.
 * Users arrive a think time apart. A view's load time runs from its first request to its last tile.
 */
import { Agent } from "node:http";
import { get } from "../client/http";
import { mulberry32 } from "../replay";
import { CONNECTIONS_PER_USER, pan, type View, viewTiles } from "../session-plan";
import { percentile } from "../stats";
import { type TileCoord, tileKey } from "../tiles";
import { type LaneServer, tileUrl } from "./servers";

/** The archives' deepest zoom: closer in, a map overzooms these tiles. */
export const MAX_VIEW_ZOOM = 14;
/** Think time between views: exponential with this mean, capped. */
export const THINK_MS = { mean: 2000, max: 10_000 };
const MAX_LAT = 85;

/** A view centred on a replay line's tile, at its zoom. */
export function viewAt(line: string): View {
  const [z, x, y] = line.split("/").map(Number) as [number, number, number];
  const n = 2 ** z;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  return { lon: ((x + 0.5) / n) * 360 - 180, lat, zoom: z };
}

/** What a view shows: world copies wrapped onto the one world, nothing past the poles, each tile once. */
export function visibleTiles(view: View): TileCoord[] {
  const n = 2 ** view.zoom;
  const seen = new Map<string, TileCoord>();
  for (const t of viewTiles(view)) {
    if (t.y < 0 || t.y >= n) continue;
    const w = { z: t.z, x: ((t.x % n) + n) % n, y: t.y };
    seen.set(tileKey(w), w);
  }
  return [...seen.values()];
}

/** The next view: a half-screen pan in one of four directions (60%), a zoom in (25%) or out (15%). */
export function nextView(v: View, rand: () => number): View {
  const r = rand();
  if (r < 0.6) {
    const [dx, dy] = ([[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]] as const)[Math.floor(rand() * 4)]!;
    const p = pan(v, dx, dy);
    return { lon: ((((p.lon + 180) % 360) + 360) % 360) - 180, lat: Math.max(-MAX_LAT, Math.min(MAX_LAT, p.lat)), zoom: v.zoom };
  }
  return { ...v, zoom: r < 0.85 ? Math.min(MAX_VIEW_ZOOM, v.zoom + 1) : Math.max(0, v.zoom - 1) };
}

export const thinkMs = (rand: () => number) => Math.min(THINK_MS.max, -Math.log(1 - rand()) * THINK_MS.mean);

export interface ViewRecord {
  zoom: number;
  tiles: number;
  wallMs: number;
  bytes: number;
  failures: number;
}

export interface UsersResult {
  users: number;
  durationS: number;
  views: number;
  tiles: number;
  failures: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runUser(target: (t: TileCoord) => string, headers: Record<string, string>, start: View, rand: () => number, untilMs: number, emptyStatus?: number): Promise<ViewRecord[]> {
  const agent = new Agent({ keepAlive: true, maxSockets: CONNECTIONS_PER_USER });
  const loaded = new Set<string>();
  const records: ViewRecord[] = [];
  let view = start;
  // users arrive a think time apart, not all in the same millisecond
  await sleep(Math.min(thinkMs(rand), Math.max(0, untilMs - performance.now())));
  while (performance.now() < untilMs) {
    const tiles = visibleTiles(view).filter((t) => !loaded.has(tileKey(t)));
    if (tiles.length) {
      for (const t of tiles) loaded.add(tileKey(t));
      const started = performance.now();
      const fetched = await Promise.allSettled(tiles.map((t) => get(target(t), headers, { agent, timeoutMs: 10_000 })));
      const ok = fetched.flatMap((f) => (f.status === "fulfilled" && (f.value.status < 300 || f.value.status === 404 || f.value.status === emptyStatus) ? [f.value] : []));
      records.push({ zoom: view.zoom, tiles: tiles.length, wallMs: performance.now() - started, bytes: ok.reduce((a, f) => a + f.bytes, 0), failures: tiles.length - ok.length });
    }
    // think, but not past the end
    await sleep(Math.min(thinkMs(rand), Math.max(0, untilMs - performance.now())));
    view = nextView(view, rand);
  }
  agent.destroy();
  return records;
}

/** `users` users at once for `durationS`, each from its own start drawn from the replay's lines. */
export async function runUsers(server: LaneServer, host: string, tileset: string, headers: Record<string, string>, lines: readonly string[], users: number, durationS: number, seed: number): Promise<UsersResult> {
  const untilMs = performance.now() + durationS * 1000;
  const runs = Array.from({ length: users }, (_, u) => {
    const rand = mulberry32(seed + u * 7919);
    return runUser((t) => tileUrl(server, host, tileset, t), headers, viewAt(lines[Math.floor(rand() * lines.length)]!), rand, untilMs, server.emptyStatus);
  });
  const views = (await Promise.all(runs)).flat();
  const ms = views.map((v) => v.wallMs);
  const at = (p: number) => (ms.length ? percentile(ms, p) : null);
  return { users, durationS, views: views.length, tiles: views.reduce((a, v) => a + v.tiles, 0), failures: views.reduce((a, v) => a + v.failures, 0), p50Ms: at(0.5), p95Ms: at(0.95), p99Ms: at(0.99), maxMs: ms.length ? Math.max(...ms) : null };
}
