import { Agent, request as httpRequest } from "node:http";

export interface Fetched {
  status: number;
  bytes: number;
  ms: number;
  contentType: string | null;
  contentEncoding: string | null;
  etag: string | null;
  body: Uint8Array;
}

/**
 * One GET with exactly the headers given and nothing else. `fetch` would add an Accept-Encoding of
 * its own and decompress the body, so the raw http client is used and the body is kept as sent.
 */
export function get(url: string, headers: Record<string, string>, opts: { timeoutMs?: number; agent?: Agent } = {}): Promise<Fetched> {
  const started = performance.now();
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: "GET", headers, timeout: timeoutMs, ...(opts.agent ? { agent: opts.agent } : {}) }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const body = new Uint8Array(Buffer.concat(chunks));
        resolve({
          status: res.statusCode ?? 0,
          bytes: body.byteLength,
          ms: performance.now() - started,
          contentType: (res.headers["content-type"] as string | undefined) ?? null,
          contentEncoding: (res.headers["content-encoding"] as string | undefined) ?? null,
          etag: (res.headers["etag"] as string | undefined) ?? null,
          body,
        });
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error(`request timed out after ${timeoutMs} ms`)));
    req.on("error", reject);
    req.end();
  });
}

/** Wall-clock now in epoch microseconds, sub-millisecond, in this container's (the VM's) clock. */
export function nowUs(): number {
  return Math.round((performance.timeOrigin + performance.now()) * 1000);
}

export function argJson<T>(): T {
  const raw = process.argv[2];
  if (!raw) throw new Error("expected one JSON argument");
  return JSON.parse(raw) as T;
}
