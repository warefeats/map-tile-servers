/**
 * Poll one URL until it answers 200 and print the moment it first did, in the VM's clock, so the
 * runner can subtract Docker's StartedAt (also the VM's clock) without host/VM skew. Started before
 * the engine is, so it is already polling when the process comes up.
 */
import { argJson, get, nowUs } from "./http";

const { url, headers, timeoutMs, intervalMs, then } = argJson<{ url: string; headers: Record<string, string>; timeoutMs: number; intervalMs: number; then?: string[] }>();

const deadline = Date.now() + timeoutMs;
let attempts = 0;
let firstOkUs: number | null = null;
let lastError = "";
while (Date.now() < deadline) {
  attempts++;
  try {
    const r = await get(url, headers, { timeoutMs: Math.max(1_000, deadline - Date.now()) });
    if (r.status === 200) {
      firstOkUs = nowUs();
      break;
    }
    lastError = `status ${r.status}`;
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
  }
  await Bun.sleep(intervalMs);
}

/** Follow-up URLs fetched once each right after the first 200 (e.g. the last source of a large catalog). */
const followUps: { url: string; status: number; atUs: number; ms: number }[] = [];
if (firstOkUs !== null) {
  for (const next of then ?? []) {
    try {
      const r = await get(next, headers, { timeoutMs: Math.max(1_000, deadline - Date.now()) });
      followUps.push({ url: next, status: r.status, atUs: nowUs(), ms: r.ms });
    } catch (error) {
      followUps.push({ url: next, status: 0, atUs: nowUs(), ms: -1 });
    }
  }
}

console.log(JSON.stringify({ firstOkUs, attempts, lastError, followUps }));
