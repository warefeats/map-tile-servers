#!/usr/bin/env bun
/**
 * Turns UX runs into what a user saw: a video per visit, and per phase (the map opening, then each
 * action after the camera stops) how long until the screen was mostly and then fully drawn. Then
 * Martin 2.0 against every rival, flagging only where Martin is noticeably slower.
 *
 *   bun run src/ux/analyze.ts --tag=ux1 [--family=archive] [--keep-frames]
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { WORK_DIR } from "../docker";
import { CANDIDATES, type Family, isMartin2 } from "../matrix";
import type { VisitRecord } from "./record";


/** Thumbnails for the visual measure: 160 x 90 grey, compared pixel by pixel against the phase's last frame. */
const THUMB = { w: 160, h: 90 } as const;

const WHITE = new Uint8Array(THUMB.w * THUMB.h).fill(255);

/** A difference users notice: at least 100 ms and at least 10% slower, in every round. */
export const NOTICEABLE = { ms: 100, ratio: 0.1 } as const;

interface Visit extends VisitRecord {
  candidate: string;
  /** The tile server's origin; older runs lack it. */
  tileBase?: string;
  scenario: string;
  profile: string;
  round: number;
  visit: string;
  load: number;
  readyMs: number;
  cpu: { engineMs: number | null; dbMs: number | null };
}

export interface PhaseMetrics {
  phase: string;
  /** Milliseconds from the phase's anchor (navigation start, or the camera stopping). */
  firstChange: number | null;
  vc50: number | null;
  vc85: number | null;
  vc95: number | null;
  vc99: number | null;
  speedIndex: number | null;
  /** The map's own idle: every tile in view loaded and drawn. */
  idle: number | null;
  /** For actions: from the user's input to the camera stopping. */
  move?: number;
  tileRequests: number;
  tileFailures: number;
  /** Requests the browser sent with a validator, to check a cached tile. */
  tileRevalidations: number;
  tileBytes: number;
  /** Time to first byte of the phase's tile responses, median and slowest, milliseconds. */
  ttfbMedian: number | null;
  ttfbMax: number | null;
  statuses: Record<string, number>;
}

export interface VisitMetrics {
  candidate: string;
  scenario: string;
  profile: string;
  visit: string;
  round: number;
  failure: string | null;
  phases: PhaseMetrics[];
  /** Total time the user waited on the map: the open's VC95 plus each action's VC95 after the camera stopped. */
  waitVc95: number | null;
  waitIdle: number | null;
  engineCpuMs: number | null;
  dbCpuMs: number | null;
  headers: Record<string, string>;
  video: string;
}

function decodeThumbs(framesDir: string, count: number): Uint8Array[] {
  if (count === 0) return [];
  const r = Bun.spawnSync(["ffmpeg", "-v", "error", "-start_number", "0", "-f", "image2", "-i", join(framesDir, "%05d.jpg"), "-vf", `scale=${THUMB.w}:${THUMB.h}:flags=area,format=gray`, "-f", "rawvideo", "pipe:1"], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`ffmpeg decode failed in ${framesDir}: ${r.stderr.toString().slice(-300)}`);
  const size = THUMB.w * THUMB.h;
  const out: Uint8Array[] = [];
  const buf = r.stdout;
  for (let i = 0; i + size <= buf.length; i += size) out.push(buf.subarray(i, i + size));
  return out;
}

function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i]! - b[i]!);
  return sum / a.length;
}

/**
 * Visual progress over [anchor, end): each frame's distance from the last frame of the window,
 * relative to the frame on screen at the anchor. A threshold time is the first moment after which
 * progress never drops below it again.
 */
function visual(frames: { t: number; thumb: Uint8Array }[], anchor: number, end: number, from?: Uint8Array) {
  const before = frames.filter((f) => f.t <= anchor);
  const inside = frames.filter((f) => f.t > anchor && f.t < end);
  const start = from ? { t: anchor, thumb: from } : (before.at(-1) ?? inside[0]);
  const final = inside.at(-1) ?? start;
  if (!start || !final) return { firstChange: null, vc50: null, vc85: null, vc95: null, vc99: null, speedIndex: null };
  const d0 = meanAbsDiff(start.thumb, final.thumb);
  const series = [{ t: anchor, p: d0 < 0.5 ? 1 : 0 }, ...inside.map((f) => ({ t: f.t, p: d0 < 0.5 ? 1 : Math.max(0, 1 - meanAbsDiff(f.thumb, final.thumb) / d0) }))];
  const settled = (threshold: number): number | null => {
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i]!.p < threshold) return i + 1 < series.length ? series[i + 1]!.t - anchor : null;
    }
    return 0;
  };
  const firstChange = series.find((s) => s.p > 0.02);
  let speedIndex = 0;
  for (let i = 0; i < series.length - 1; i++) speedIndex += (1 - series[i]!.p) * (series[i + 1]!.t - series[i]!.t);
  return { firstChange: firstChange ? firstChange.t - anchor : null, vc50: settled(0.5), vc85: settled(0.85), vc95: settled(0.95), vc99: settled(0.99), speedIndex };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** A video of the visit from navigation start, at real speed. */
function encodeVideo(v: Visit, dir: string): string {
  const out = join(dir, "video.mp4");
  const frames = v.frames.filter((f) => f.t >= v.navStart - 50);
  if (!frames.length) return "";
  const lines = ["ffconcat version 1.0"];
  frames.forEach((f, i) => {
    const next = frames[i + 1]?.t ?? v.end;
    const from = i === 0 ? v.navStart : f.t;
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.001, (next - from) / 1000).toFixed(4)}`);
  });
  lines.push(`file '${frames.at(-1)!.file}'`);
  const list = join(dir, "frames.ffconcat");
  writeFileSync(list, lines.join("\n") + "\n");
  const r = Bun.spawnSync(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-movflags", "+faststart", out], { stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`ffmpeg encode failed in ${dir}: ${r.stderr.toString().slice(-300)}`);
  rmSync(list);
  return out;
}

function analyzeVisit(file: string, keepFrames: boolean): VisitMetrics {
  const dir = dirname(file);
  const v = JSON.parse(readFileSync(file, "utf8")) as Visit;
  const base =
    v.tileBase ??
    (() => {
      const tile = v.requests.find((r) => /^https?:/.test(r.url) && !r.url.startsWith(new URL(v.url).origin));
      return tile ? new URL(tile.url).origin : "";
    })();
  const tiles = v.requests.filter((r) => base && r.url.startsWith(base));
  const thumbs = decodeThumbs(join(dir, "frames"), v.frames.length);
  const frames = v.frames.map((f, i) => ({ t: f.t, thumb: thumbs[i]! })).filter((f) => f.thumb);

  const phaseTiles = (from: number, to: number) => tiles.filter((r) => r.start >= from && r.start < to);
  const tileStats = (rs: typeof tiles) => {
    const ttfb = rs.filter((r) => r.ttfb !== null && r.status !== null && r.status < 400).map((r) => r.ttfb! - r.start);
    const statuses: Record<string, number> = {};
    for (const r of rs) {
      const k = r.failure ? "failed" : String(r.status);
      statuses[k] = (statuses[k] ?? 0) + 1;
    }
    return { tileRequests: rs.length, tileFailures: rs.filter((r) => r.failure).length, tileRevalidations: rs.filter((r) => r.conditional).length, tileBytes: rs.reduce((s, r) => s + Math.max(0, r.bodyBytes ?? 0), 0), ttfbMedian: median(ttfb), ttfbMax: ttfb.length ? Math.max(...ttfb) : null, statuses };
  };

  const phases: PhaseMetrics[] = [];
  const openEnd = v.actions[0]?.start ?? v.end;
  // The open is measured against a blank page: a returning visitor's screen keeps the previous
  // page's map until the new page paints, and that map is not this visit's progress.
  const created = v.marks.create ?? v.navStart;
  phases.push({ phase: "open", ...visual(frames.filter((f) => f.t >= created), v.navStart, openEnd, WHITE), idle: v.marks.idle !== undefined ? v.marks.idle - v.navStart : null, ...tileStats(phaseTiles(v.navStart - 1000, openEnd)) });
  v.actions.forEach((a, i) => {
    const end = v.actions[i + 1]?.start ?? v.end;
    phases.push({ phase: a.name, ...visual(frames, a.moveEnd, end), idle: a.idle - a.moveEnd, move: a.moveEnd - a.start, ...tileStats(phaseTiles(a.start, end)) });
  });
  const sum = (k: "vc95" | "idle") => (phases.every((p) => p[k] !== null) ? phases.reduce((s, p) => s + p[k]!, 0) : null);
  const headers = tiles.find((r) => r.status === 200)?.headers ?? {};
  const video = encodeVideo(v, dir);
  if (!keepFrames) rmSync(join(dir, "frames"), { recursive: true, force: true });
  return {
    candidate: v.candidate,
    scenario: v.scenario,
    profile: v.profile,
    visit: v.visit,
    round: v.round,
    failure: v.failure,
    phases,
    waitVc95: sum("vc95"),
    waitIdle: sum("idle"),
    engineCpuMs: v.cpu.engineMs,
    dbCpuMs: v.cpu.dbMs,
    headers,
    video,
  };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(join(dir, e.name), out);
    else if (e.name === "visit.json") out.push(join(dir, e.name));
  }
  return out;
}

interface Cell {
  candidate: string;
  rounds: VisitMetrics[];
  waitVc95: number | null;
  waitIdle: number | null;
}

export interface Finding {
  family: Family;
  scenario: string;
  profile: string;
  visit: string;
  martin: number;
  rival: string;
  rivalValue: number;
  slowerMs: number;
  slowerRatio: number;
  everyRound: boolean;
  noticeable: boolean;
}

function main(): void {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k!, v ?? "true"];
    }),
  );
  const tag = args.tag;
  if (!tag) throw new Error("--tag is required");
  const families: Family[] = args.family ? [args.family as Family] : (["archive", "postgis"] as Family[]).filter((f) => existsSync(join(WORK_DIR, "ux", tag, f)));
  const keepFrames = args["keep-frames"] === "true";
  for (const family of families) analyzeFamily(join(WORK_DIR, "ux", tag, family), family, keepFrames);
}

function analyzeFamily(root: string, family: Family, keepFrames: boolean): void {
  const files = walk(root);
  console.log(`${family}: ${files.length} visits`);
  const metrics: VisitMetrics[] = [];
  const cached = join(root, "metrics.json");
  const done = new Map<string, VisitMetrics>();
  if (existsSync(cached)) for (const m of JSON.parse(readFileSync(cached, "utf8")) as VisitMetrics[]) done.set(`${m.candidate}/${m.scenario}/${m.profile}/r${m.round}/${m.visit}`, m);
  for (const f of files) {
    const key = relative(root, dirname(f));
    let m = done.get(key);
    if (!m) {
      m = analyzeVisit(f, keepFrames);
      if (m.video) m.video = relative(root, m.video);
    }
    metrics.push(m);
  }
  writeFileSync(cached, JSON.stringify(metrics));

  // Per scenario, profile and visit: each candidate's median total wait across rounds.
  const findings: Finding[] = [];
  const groups = new Map<string, VisitMetrics[]>();
  for (const m of metrics) {
    const k = `${m.scenario}|${m.profile}|${m.visit}`;
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  for (const [k, ms] of groups) {
    const [scenario, profile, visit] = k.split("|") as [string, string, string];
    const cells: Cell[] = [...new Set(ms.map((m) => m.candidate))].map((cand) => {
      const rounds = ms.filter((m) => m.candidate === cand && !m.failure);
      return { candidate: cand, rounds, waitVc95: median(rounds.map((r) => r.waitVc95).filter((x): x is number => x !== null)), waitIdle: median(rounds.map((r) => r.waitIdle).filter((x): x is number => x !== null)) };
    });
    const martins = cells.filter((c) => isMartin2(CANDIDATES.find((x) => x.id === c.candidate && x.family === family)!));
    const rivals = cells.filter((c) => {
      const cand = CANDIDATES.find((x) => x.id === c.candidate && x.family === family)!;
      return cand.server !== "martin" && !cand.control;
    });
    for (const m of martins) {
      if (m.waitVc95 === null) continue;
      for (const r of rivals) {
        if (r.waitVc95 === null || r.waitVc95 >= m.waitVc95) continue;
        const slowerMs = m.waitVc95 - r.waitVc95;
        const slowerRatio = slowerMs / Math.max(r.waitVc95, 1);
        const everyRound = m.rounds.every((mr) => {
          const rr = r.rounds.find((x) => x.round === mr.round);
          return rr && mr.waitVc95 !== null && rr.waitVc95 !== null && mr.waitVc95 > rr.waitVc95;
        });
        findings.push({ family, scenario, profile, visit, martin: m.waitVc95, rival: r.candidate, rivalValue: r.waitVc95, slowerMs, slowerRatio, everyRound, noticeable: everyRound && slowerMs >= NOTICEABLE.ms && slowerRatio >= NOTICEABLE.ratio });
      }
    }
  }
  findings.sort((a, b) => b.slowerMs - a.slowerMs);
  writeFileSync(join(root, "findings.json"), JSON.stringify(findings, null, 1));
  const noticeable = findings.filter((f) => f.noticeable);
  console.log(`${family}: Martin noticeably slower in ${noticeable.length} of ${groups.size} scenario/profile/visit cells`);
  for (const f of noticeable) console.log(`  ${f.scenario} ${f.profile} ${f.visit}: Martin ${Math.round(f.martin)} ms vs ${f.rival} ${Math.round(f.rivalValue)} ms (+${Math.round(f.slowerMs)} ms, +${Math.round(f.slowerRatio * 100)}%)`);
}

if (import.meta.main) main();
