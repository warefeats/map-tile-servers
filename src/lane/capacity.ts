/**
 * Capacity of the archive lane (docs/adr/0011): the highest offered load a server holds with p99 within the
 * target, fewer than 0.1% errors and at least 95% of the rate delivered. The offered rate doubles until a step
 * is not held, then bisects between the last held rate and the first failed one, so capacity lands within
 * (failed - held) / 2^bisections of the truth instead of on a coarse ladder where servers tie by step.
 */

export interface StepOutcome {
  offeredRps: number;
  achievedRps: number;
  p99Ms: number | null;
  errorRate: number;
  held: boolean;
}

/** The ADR's test for one step. */
export function held(offeredRps: number, achievedRps: number, p99Ms: number | null, errorRate: number, targetMs: number): boolean {
  return p99Ms !== null && p99Ms <= targetMs && errorRate <= 0.001 && achievedRps >= 0.95 * offeredRps;
}

export interface SearchOptions {
  startRps: number;
  /** Stop doubling here; a server that holds it is reported as at least this. */
  maxRps: number;
  /** Below this, a server that holds nothing is reported as 0. */
  minRps: number;
  bisections: number;
}

export interface Capacity {
  capacityRps: number;
  /** True when the search stopped at maxRps without a failed step. */
  atCeiling: boolean;
  steps: StepOutcome[];
}

export async function findCapacity(probe: (rps: number) => Promise<StepOutcome>, o: SearchOptions): Promise<Capacity> {
  const steps: StepOutcome[] = [];
  const at = async (rps: number) => {
    const s = await probe(rps);
    steps.push(s);
    return s.held;
  };
  let lo = 0;
  let hi = 0;
  if (await at(o.startRps)) {
    lo = o.startRps;
    for (let rps = o.startRps * 2; ; rps *= 2) {
      if (rps > o.maxRps) return { capacityRps: lo, atCeiling: true, steps };
      if (!(await at(rps))) {
        hi = rps;
        break;
      }
      lo = rps;
    }
  } else {
    hi = o.startRps;
    for (let rps = o.startRps / 2; ; rps /= 2) {
      if (rps < o.minRps) return { capacityRps: 0, atCeiling: false, steps };
      if (await at(rps)) {
        lo = rps;
        break;
      }
      hi = rps;
    }
  }
  for (let i = 0; i < o.bisections; i++) {
    const mid = Math.round((lo + hi) / 2);
    if (mid <= lo || mid >= hi) break;
    if (await at(mid)) lo = mid;
    else hi = mid;
  }
  return { capacityRps: lo, atCeiling: false, steps };
}
