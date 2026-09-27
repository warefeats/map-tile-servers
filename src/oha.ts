import { clientExec } from "./docker";
import { round } from "./stats";

/** What oha reports for one invocation, in milliseconds and counts. */
export interface OhaPass {
  completed: number;
  success: number;
  /** Connection errors and timeouts. Requests oha itself cut off when the pass ended are not errors. */
  transportErrors: number;
  /** In-flight requests oha abandoned at the end of a fixed-duration pass. */
  abortedAtDeadline: number;
  statusCodes: Record<string, number>;
  errorDistribution: Record<string, number>;
  meanMs: number | null;
  p50Ms: number | null;
  p90Ms: number | null;
  p99Ms: number | null;
  p999Ms: number | null;
  maxMs: number | null;
  requestsPerSec: number;
  durationS: number;
  bytesPerRequest: number | null;
}

interface OhaJson {
  summary: { total: number; slowest: number; fastest: number; average: number; requestsPerSec: number; sizePerRequest?: number | null };
  latencyPercentiles?: Record<string, number>;
  statusCodeDistribution?: Record<string, number>;
  errorDistribution?: Record<string, number>;
}

/** oha's label for requests still in flight when a `-z` pass ends. */
export const OHA_DEADLINE_ABORT = "aborted due to deadline";

function finite(value: number | undefined | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseOha(json: string): OhaPass {
  const data = JSON.parse(json) as OhaJson;
  const statusCodes = data.statusCodeDistribution ?? {};
  const errorDistribution = data.errorDistribution ?? {};
  const completed = Object.values(statusCodes).reduce((a, b) => a + b, 0);
  const success = Object.entries(statusCodes).reduce((sum, [code, count]) => (code.startsWith("2") ? sum + count : sum), 0);
  const abortedAtDeadline = errorDistribution[OHA_DEADLINE_ABORT] ?? 0;
  const transportErrors = Object.entries(errorDistribution).reduce((sum, [kind, count]) => (kind === OHA_DEADLINE_ABORT ? sum : sum + count), 0);
  const ms = (value: number | null) => (value === null || completed === 0 ? null : round(value * 1000, 3));
  const pct = (key: string) => ms(finite(data.latencyPercentiles?.[key]));
  return {
    completed,
    success,
    transportErrors,
    abortedAtDeadline,
    statusCodes,
    errorDistribution,
    meanMs: ms(finite(data.summary.average)),
    p50Ms: pct("p50"),
    p90Ms: pct("p90"),
    p99Ms: pct("p99"),
    p999Ms: pct("p99.9"),
    maxMs: ms(finite(data.summary.slowest)),
    requestsPerSec: finite(data.summary.requestsPerSec) ?? 0,
    durationS: finite(data.summary.total) ?? 0,
    bytesPerRequest: finite(data.summary.sizePerRequest ?? null),
  };
}

export interface OhaOptions {
  connections: number;
  /** Client-side path of a file with one URL per line; oha picks one at random per request. Replaces `url`. */
  urlsFromFile?: string;
  requests?: number;
  durationSeconds?: number;
  /** Open loop: offered requests per second, with oha's coordinated-omission correction. */
  rate?: number;
  timeoutSeconds: number;
  headers: Record<string, string>;
}

/** One oha invocation inside the client container. Compression handling is left to the headers given. */
export function oha(url: string, opts: OhaOptions): OhaPass {
  const args = ["oha", "--output-format", "json", "--no-tui", "--disable-compression", "-t", `${opts.timeoutSeconds}s`, "-c", String(opts.connections)];
  if (opts.requests !== undefined) args.push("-n", String(opts.requests));
  if (opts.durationSeconds !== undefined) args.push("-z", `${opts.durationSeconds}s`);
  if (opts.rate !== undefined) args.push("-q", String(opts.rate), "--latency-correction");
  for (const [name, value] of Object.entries(opts.headers)) args.push("-H", `${name}: ${value}`);
  if (opts.urlsFromFile) args.push("--urls-from-file", opts.urlsFromFile);
  else args.push(url);
  const budgetMs = ((opts.durationSeconds ?? 0) + opts.timeoutSeconds * (opts.requests !== undefined ? Math.ceil(opts.requests / opts.connections) + 1 : 2)) * 1000 + 30_000;
  return parseOha(clientExec(args, budgetMs));
}
