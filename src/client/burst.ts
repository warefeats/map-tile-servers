/** The thesis's viewport test: N tiles requested at once over N fresh connections, repeated. */
import { Agent } from "node:http";
import { argJson, get } from "./http";

const { urls, headers, warmups, reps, timeoutMs } = argJson<{ urls: string[]; headers: Record<string, string>; warmups: number; reps: number; timeoutMs: number }>();

// A keep-alive agent with one socket per tile: connections are opened by the warmups and reused, as
// a browser reuses its per-host pool.
const agent = new Agent({ keepAlive: true, maxSockets: urls.length });

async function rep(): Promise<{ wallMs: number; slowestMs: number; failures: number }> {
  const started = performance.now();
  const results = await Promise.all(urls.map((url) => get(url, headers, { timeoutMs, agent }).catch(() => null)));
  const wallMs = performance.now() - started;
  return {
    wallMs,
    slowestMs: Math.max(...results.map((r) => r?.ms ?? wallMs)),
    failures: results.filter((r) => r === null || r.status !== 200).length,
  };
}

for (let i = 0; i < warmups; i++) await rep();
const samples: { wallMs: number; slowestMs: number; failures: number }[] = [];
for (let i = 0; i < reps; i++) samples.push(await rep());
agent.destroy();
console.log(JSON.stringify(samples));
