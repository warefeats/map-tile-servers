/**
 * Map sessions: `users` simulated MapLibre clients fly the family's flight `rounds` times each, with
 * no think time. A user's requests go through its own six-socket keep-alive pool; a view is done
 * when its last tile lands. The first round of every user warms connections and is discarded.
 */
import { Agent } from "node:http";
import { candidate } from "../matrix";
import { CONNECTIONS_PER_USER, sessionLayers, userFlight, viewTiles } from "../session-plan";
import { tileKey } from "../tiles";
import { argJson, get } from "./http";

const { candidateId, origin, users, rounds, headers, timeoutMs } = argJson<{
  candidateId: string;
  origin: string;
  users: number;
  rounds: number;
  headers: Record<string, string>;
  timeoutMs: number;
}>();

const c = candidate(candidateId);
const layers = sessionLayers(c.family);

interface ViewRecord {
  user: number;
  round: number;
  view: number;
  zoom: number;
  requests: number;
  wallMs: number;
  slowestMs: number;
  bytes: number;
  failures: number;
  statuses: Record<string, number>;
}

async function runUser(u: number): Promise<ViewRecord[]> {
  const agent = new Agent({ keepAlive: true, maxSockets: CONNECTIONS_PER_USER });
  const records: ViewRecord[] = [];
  // Round 0 warms the pool and the server; it is flown but not recorded.
  for (let round = 0; round <= rounds; round++) {
    const loaded = new Set<string>();
    const views = userFlight(c.family, u, users);
    for (let v = 0; v < views.length; v++) {
      const view = views[v]!;
      const urls: string[] = [];
      for (const tile of viewTiles(view)) {
        const key = tileKey(tile);
        if (loaded.has(key)) continue;
        loaded.add(key);
        for (const layer of layers) urls.push(origin + c.tilePath(layer, tile));
      }
      if (urls.length === 0) continue;
      const started = performance.now();
      const results = await Promise.all(urls.map((url) => get(url, headers, { timeoutMs, agent }).catch(() => null)));
      const wallMs = performance.now() - started;
      if (round === 0) continue;
      const statuses: Record<string, number> = {};
      let bytes = 0;
      let failures = 0;
      let slowestMs = 0;
      for (const r of results) {
        const code = r ? String(r.status) : "error";
        statuses[code] = (statuses[code] ?? 0) + 1;
        // A missing tile answered 204 or 404 is an empty tile either way (the extract ends before a
        // zoomed-out viewport does); both are defensible, so neither counts as a failure.
        if (!r || (r.status >= 300 && r.status !== 404)) failures++;
        if (r) {
          bytes += r.bytes;
          slowestMs = Math.max(slowestMs, r.ms);
        }
      }
      records.push({ user: u, round, view: v, zoom: view.zoom, requests: urls.length, wallMs, slowestMs, bytes, failures, statuses });
    }
  }
  agent.destroy();
  return records;
}

const started = performance.now();
const all = (await Promise.all(Array.from({ length: users }, (_, u) => runUser(u)))).flat();
console.log(JSON.stringify({ elapsedMs: performance.now() - started, views: all }));
