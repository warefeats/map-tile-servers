#!/usr/bin/env bun
/**
 * One HTML page per UX run: where Martin 2.0 is noticeably slower (with side-by-side videos), then
 * every scenario's medians per candidate. Reads what src/ux/analyze.ts wrote.
 *
 *   bun run src/ux/report.ts --tag=ux1
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WORK_DIR } from "../docker";
import { CANDIDATES, type Family, isMartin2 } from "../matrix";
import type { Finding, PhaseMetrics, VisitMetrics } from "./analyze";
import { NOTICEABLE } from "./analyze";
import { PROFILES, SCENARIOS, VISITS } from "./scenarios";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k!, v ?? "true"];
  }),
);
const tag = args.tag;
if (!tag) throw new Error("--tag is required");
const ROOT = join(WORK_DIR, "ux", tag);

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const name = (family: Family, id: string) => CANDIDATES.find((c) => c.id === id && c.family === family)?.name ?? id;
const fmt = (ms: number | null) => (ms === null ? "–" : `${Math.round(ms).toLocaleString("en-US")}`);

function sideBySide(family: Family, videos: { label: string; src: string }[], id: string): string {
  const cells = videos.map((v) => `<figure><figcaption>${esc(v.label)}</figcaption><video src="${esc(`${family}/${v.src}`)}" muted playsinline preload="auto"></video></figure>`).join("");
  return `<div class="sbs" id="${id}"><div class="row">${cells}</div><div class="controls"><button onclick="playAll('${id}')">Play together</button> <button onclick="stepAll('${id}', -0.1)">−100 ms</button> <button onclick="stepAll('${id}', 0.1)">+100 ms</button> <span class="clock">0 ms</span></div></div>`;
}

let body = "";
const meta: Record<string, unknown> = {};
for (const family of ["archive", "postgis"] as Family[]) {
  const dir = join(ROOT, family);
  if (!existsSync(join(dir, "metrics.json"))) continue;
  Object.assign(meta, { [family]: JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) });
  const metrics = JSON.parse(readFileSync(join(dir, "metrics.json"), "utf8")) as VisitMetrics[];
  const findings = JSON.parse(readFileSync(join(dir, "findings.json"), "utf8")) as Finding[];
  const video = (cand: string, scenario: string, profile: string, visit: string) =>
    metrics.find((m) => m.candidate === cand && m.scenario === scenario && m.profile === profile && m.visit === visit && m.round === 1)?.video ?? "";

  body += `<h2>${family === "archive" ? "Archive servers (OSM Bright over the Berlin OpenMapTiles archive)" : "PostGIS servers (four bench layers, cut per request)"}</h2>`;
  const noticeable = findings.filter((f) => f.noticeable);
  body += `<h3>Where Martin is noticeably slower</h3>`;
  if (!noticeable.length) body += `<p>Nowhere: in no scenario, connection or visit is Martin 2.0 at least ${NOTICEABLE.ms} ms and ${NOTICEABLE.ratio * 100}% behind a rival in every round.</p>`;
  noticeable.forEach((f, i) => {
    const scen = SCENARIOS.find((s) => s.id === f.scenario && s.family === family)!;
    const martin = CANDIDATES.find((c) => c.family === family && isMartin2(c) && metrics.some((m) => m.candidate === c.id && m.scenario === f.scenario))!;
    body += `<h4>${esc(scen.title)} · ${esc(f.profile)} · ${esc(f.visit)} visitor</h4><p>${esc(name(family, f.rival))} ${fmt(f.rivalValue)} ms, Martin ${fmt(f.martin)} ms: ${fmt(f.slowerMs)} ms (${Math.round(f.slowerRatio * 100)}%) longer until the map is 95% drawn, summed over the scenario's steps.</p>`;
    body += sideBySide(family, [
      { label: name(family, martin.id), src: video(martin.id, f.scenario, f.profile, f.visit) },
      { label: name(family, f.rival), src: video(f.rival, f.scenario, f.profile, f.visit) },
    ], `${family}-f${i}`);
  });

  body += `<h3>Every scenario: time until the map is 95% drawn (median of rounds, ms, summed over the scenario's steps)</h3>`;
  for (const scen of SCENARIOS.filter((s) => s.family === family)) {
    const rows = [...new Set(metrics.filter((m) => m.scenario === scen.id).map((m) => m.candidate))];
    if (!rows.length) continue;
    const cols = PROFILES.flatMap((p) => VISITS.map((v) => ({ p: p.id, v })));
    const value = (cand: string, p: string, v: string) =>
      median(metrics.filter((m) => m.candidate === cand && m.scenario === scen.id && m.profile === p && m.visit === v && !m.failure && m.waitVc95 !== null).map((m) => m.waitVc95!));
    const best = new Map(cols.map((c) => [`${c.p}|${c.v}`, Math.min(...rows.filter((r) => !CANDIDATES.find((x) => x.id === r && x.family === family)?.control).map((r) => value(r, c.p, c.v) ?? Infinity))]));
    body += `<h4>${esc(scen.title)}</h4><table><thead><tr><th></th>${cols.map((c) => `<th>${esc(c.p)}<br>${esc(c.v)}</th>`).join("")}</tr></thead><tbody>`;
    for (const r of rows) {
      const cand = CANDIDATES.find((x) => x.id === r && x.family === family)!;
      body += `<tr class="${isMartin2(cand) ? "martin" : cand.control ? "control" : ""}"><th>${esc(cand.name)}</th>${cols
        .map((c) => {
          const v = value(r, c.p, c.v);
          const isBest = v !== null && v === best.get(`${c.p}|${c.v}`);
          return `<td${isBest ? ' class="best"' : ""}>${fmt(v)}</td>`;
        })
        .join("")}</tr>`;
    }
    body += `</tbody></table>`;
    // Per-step detail for Martin and the fastest rival on 4G for the next visitor.
    const detail = (cand: string) => {
      const runs = metrics.filter((m) => m.candidate === cand && m.scenario === scen.id && m.profile === "4g" && m.visit === "next" && !m.failure);
      if (!runs.length) return null;
      return runs[0]!.phases.map((p, i) => {
        const pick = (k: keyof PhaseMetrics) => median(runs.map((r) => r.phases[i]?.[k]).filter((x): x is number => typeof x === "number"));
        return { phase: p.phase, vc95: pick("vc95"), idle: pick("idle"), requests: pick("tileRequests"), bytes: pick("tileBytes"), ttfb: pick("ttfbMedian") };
      });
    };
    const martinId = rows.find((r) => isMartin2(CANDIDATES.find((x) => x.id === r && x.family === family)!));
    if (martinId && scen.actions.length) {
      const d = detail(martinId);
      if (d) body += `<details><summary>Martin's steps on 4G, next visitor</summary><table><thead><tr><th>step</th><th>95% drawn</th><th>idle</th><th>tile requests</th><th>bytes</th><th>median TTFB</th></tr></thead><tbody>${d.map((s) => `<tr><td>${esc(s.phase)}</td><td>${fmt(s.vc95)}</td><td>${fmt(s.idle)}</td><td>${fmt(s.requests)}</td><td>${fmt(s.bytes)}</td><td>${fmt(s.ttfb)}</td></tr>`).join("")}</tbody></table></details>`;
    }
  }

  // Response headers each server sends for a tile, as the browser received them.
  body += `<h3>Tile response headers</h3><table><thead><tr><th></th><th>content-encoding</th><th>cache-control</th><th>etag</th><th>last-modified</th><th>CORS</th></tr></thead><tbody>`;
  for (const cand of [...new Set(metrics.map((m) => m.candidate))]) {
    const h = metrics.find((m) => m.candidate === cand && Object.keys(m.headers).length)?.headers ?? {};
    body += `<tr><th>${esc(name(family, cand))}</th><td>${esc(h["content-encoding"] ?? "none")}</td><td>${esc(h["cache-control"] ?? "none")}</td><td>${h["etag"] ? "yes" : "no"}</td><td>${h["last-modified"] ? "yes" : "no"}</td><td>${esc(h["access-control-allow-origin"] ?? "none")}</td></tr>`;
  }
  body += `</tbody></table>`;
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Martin UX runs</title>
<style>
:root { --bg: #ffffff; --fg: #1f2328; --muted: #59636e; --line: #d1d9e0; --martin: #e8f0fe; --best: #1a7f37; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #0d1117; --fg: #e6edf3; --muted: #9198a1; --line: #3d444d; --martin: #1d2a44; --best: #3fb950; } }
body { margin: 0 auto; max-width: 1200px; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
table { border-collapse: collapse; margin: 8px 0 16px; font-variant-numeric: tabular-nums; display: block; overflow-x: auto; }
th, td { border-bottom: 1px solid var(--line); padding: 4px 8px; text-align: right; white-space: nowrap; }
thead th { color: var(--muted); font-weight: 600; }
tbody th { text-align: left; }
tr.martin { background: var(--martin); }
tr.control { color: var(--muted); }
td.best { color: var(--best); font-weight: 700; }
.sbs .row { display: flex; gap: 8px; flex-wrap: wrap; }
.sbs figure { margin: 0; flex: 1 1 360px; }
.sbs video { width: 100%; border: 1px solid var(--line); }
.sbs figcaption { color: var(--muted); }
.controls { margin: 4px 0 24px; }
.muted { color: var(--muted); }
</style></head><body>
<h1>Martin UX runs: ${esc(tag)}</h1>
<p class="muted">A real browser (headless Chromium on the M2 Max GPU) opens a MapLibre map on each server and does what a user does. "95% drawn" is when the screen stops changing by more than 5% against its final frame. A noticeable difference is at least ${NOTICEABLE.ms} ms and ${NOTICEABLE.ratio * 100}% in every round.</p>
<pre class="muted">${esc(JSON.stringify(meta, null, 1))}</pre>
${body}
<script>
function vids(id) { return [...document.getElementById(id).querySelectorAll("video")]; }
function playAll(id) { const vs = vids(id); vs.forEach((v) => { v.pause(); v.currentTime = 0; }); Promise.all(vs.map((v) => v.play())).then(() => tick(id)); }
function stepAll(id, s) { vids(id).forEach((v) => { v.pause(); v.currentTime = Math.max(0, v.currentTime + s); }); show(id); }
function show(id) { const v = vids(id)[0]; document.getElementById(id).querySelector(".clock").textContent = Math.round(v.currentTime * 1000) + " ms"; }
function tick(id) { show(id); if (vids(id).some((v) => !v.paused)) requestAnimationFrame(() => tick(id)); }
</script>
</body></html>`;
writeFileSync(join(ROOT, "report.html"), html);
console.log(`report: ${join(ROOT, "report.html")}`);
