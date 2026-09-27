/** Fetch tiles once each and describe what came back, decoded: the parity record. */
import { gunzipSync } from "node:zlib";
import { summarizeTile, totalFeatures, type LayerSummary } from "../mvt";
import { argJson, get } from "./http";

interface Probe {
  id: string;
  url: string;
  headers: Record<string, string>;
}

const { probes, timeoutMs } = argJson<{ probes: Probe[]; timeoutMs: number }>();

const out: Record<string, unknown> = {};
for (const probe of probes) {
  try {
    const r = await get(probe.url, probe.headers, { timeoutMs });
    let layers: LayerSummary[] = [];
    let decodeError: string | undefined;
    if (r.status === 200) {
      try {
        const raw = r.contentEncoding === "gzip" ? new Uint8Array(gunzipSync(r.body)) : r.contentEncoding ? null : r.body;
        if (raw) layers = summarizeTile(raw);
        else decodeError = `not decoded (${r.contentEncoding})`;
      } catch (error) {
        decodeError = error instanceof Error ? error.message : String(error);
      }
    }
    out[probe.id] = {
      status: r.status,
      bytes: r.bytes,
      ms: r.ms,
      contentType: r.contentType,
      contentEncoding: r.contentEncoding,
      etag: r.etag,
      layers,
      features: totalFeatures(layers),
      ...(decodeError ? { decodeError } : {}),
    };
  } catch (error) {
    out[probe.id] = { status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}
console.log(JSON.stringify(out));
