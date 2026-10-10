#!/usr/bin/env bun
/**
 * UX runs: a real browser opens a real map on each tile server and does what a user does (opens the
 * map, zooms, flies, pans, scrolls fast), on an unthrottled and a 4G connection, as the first
 * visitor after a restart, the next visitor, and a returning one. Every frame, request and map
 * mark is kept; src/ux/analyze.ts turns them into videos and timings.
 *
 *   bun run src/ux/run.ts --family=archive --tag=ux1 [--rounds=3 | --round=2] [--candidates=a,b] [--scenarios=a,b] [--profiles=local,4g] [--martin-variant=ux-maxage]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { dbUp, DB_CONTAINER, engineContainer, engineDown, engineLogs, engineUp, ensureNetwork, psql, run, sample, stopAllEngines, WORK_DIR } from "../docker";
import { prepareFloor } from "../floor";
import { type Candidate, CANDIDATES, type Family, isMartin2, MARQUEE } from "../matrix";
import { summarizeTile } from "../mvt";
import type { TileCoord } from "../tiles";
import { launchBrowser, newSession, recordVisit, type VisitRecord, webglRenderer } from "./record";
import { archiveStyle, POSTGIS_LAYERS, type PostgisLayer, postgisStyle, startPageServer } from "./serve";
import { PROFILES, type Scenario, scenariosFor, type Visit } from "./scenarios";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k!, v ?? "true"];
  }),
);
const family = (args.family ?? "archive") as Family;
const tag = args.tag ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, "");
const rounds = Number(args.rounds ?? 3);
/** `--round=n` runs only round n, so several invocations can alternate configurations round by round. */
const onlyRound = args.round ? Number(args.round) : null;
const list = (v: string | undefined) => (v ? v.split(",").filter(Boolean) : null);

/** Martin 2.0 and every rival of the family, plus the archive floor; Martin 1.16.1 is not part of these runs. */
const candidates: Candidate[] = (list(args.candidates) ?? CANDIDATES.filter((c) => c.family === family && (c.server !== "martin" || isMartin2(c))).map((c) => c.id)).map((id) => {
  const c = CANDIDATES.find((x) => x.id === id && x.family === family);
  if (!c) throw new Error(`unknown ${family} candidate ${id}`);
  return c;
});
const scenarios: Scenario[] = scenariosFor(family).filter((s) => !list(args.scenarios) || list(args.scenarios)!.includes(s.id));
const profiles = PROFILES.filter((p) => !list(args.profiles) || list(args.profiles)!.includes(p.id));
const OUT = join(WORK_DIR, "ux", tag, family);

/** Martin 2.0 runs its defaults here (compose/*.ux.yml, or `--martin-variant`); everyone else runs the benchmark's config. */
const variantOf = (c: Candidate) => (isMartin2(c) ? (args["martin-variant"] ?? "ux") : "");

/** A placeholder tile so a candidate's tile path becomes a URL template. */
const TEMPLATE = { z: "{z}", x: "{x}", y: "{y}" } as unknown as TileCoord;

/** Tiles the readiness check asks for: outside every scenario's view, so no visitor finds them cached. */
const READY_TILE: Record<Family, { layer: string; tile: TileCoord }> = {
  archive: { layer: "berlin", tile: { z: 0, x: 0, y: 0 } },
  postgis: { layer: "boundaries", tile: { z: 8, x: 137, y: 83 } },
};

function engineAddress(c: Candidate): string {
  const r = run(["docker", "inspect", "-f", '{{(index .NetworkSettings.Networks "m2").IPAddress}}', engineContainer(c, variantOf(c))], { quiet: true });
  const ip = r.stdout.trim();
  if (r.exitCode !== 0 || !ip) throw new Error(`no address for ${c.id}`);
  return `http://${ip}:${c.port}`;
}

/** Start the engine and wait until it answers a tile; returns its base URL and how long that took. */
async function restartEngine(c: Candidate): Promise<{ base: string; readyMs: number }> {
  engineDown(c, variantOf(c));
  engineUp(c, variantOf(c));
  const base = engineAddress(c);
  const ready = READY_TILE[family];
  const url = base + c.tilePath(ready.layer, ready.tile);
  const t0 = performance.now();
  const deadline = Date.now() + 180_000;
  for (;;) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      await r.arrayBuffer();
      // A starting server can answer before its tiles are ready (ldproxy sends other bodies first), so only a tile counts.
      if (r.status === 200 || r.status === 204) return { base, readyMs: performance.now() - t0 };
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`${c.id} did not answer ${url} within 180 s:\n${engineLogs(c, variantOf(c))}`);
    await Bun.sleep(100);
  }
}

/** The layer name a PostGIS candidate writes into its tiles, read from one tile of each layer. */
async function sourceLayers(c: Candidate, base: string): Promise<Record<PostgisLayer, string>> {
  const at: Record<PostgisLayer, TileCoord> = { boundaries: { z: 9, x: 275, y: 167 }, roads: MARQUEE, buildings: MARQUEE, pois: MARQUEE };
  const names = {} as Record<PostgisLayer, string>;
  for (const layer of POSTGIS_LAYERS) {
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fetch(base + c.tilePath(layer, at[layer]), { headers: { Accept: "application/vnd.mapbox-vector-tile" } });
        let bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = Bun.gunzipSync(bytes);
        const layers = summarizeTile(bytes).filter((l) => l.features > 0);
        if (layers.length !== 1) throw new Error(`expected one layer with features, got ${layers.map((l) => l.name).join(", ") || "none"}`);
        names[layer] = layers[0]!.name;
        break;
      } catch (err) {
        if (attempt >= 20) throw new Error(`${c.id} ${layer}: ${err instanceof Error ? err.message : err}`);
        await Bun.sleep(500);
      }
    }
  }
  return names;
}

/** Wait (up to two minutes) until the Mac's one-minute load is under 6, as the benchmark's gate does. */
async function quietHost(): Promise<number> {
  const deadline = Date.now() + 120_000;
  while (loadavg()[0]! >= 6 && Date.now() < deadline) await Bun.sleep(2_000);
  return loadavg()[0]!;
}

async function cpuMs(container: string): Promise<number | null> {
  try {
    return (await sample(container)).cpuNs / 1e6;
  } catch {
    return null;
  }
}

function toBase64Url(s: string): string {
  return Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  ensureNetwork();
  stopAllEngines();
  if (family === "postgis") {
    dbUp();
    const warmed = psql(
      "CREATE EXTENSION IF NOT EXISTS pg_prewarm; SELECT sum(pg_prewarm(c.oid::regclass)) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'bench' AND c.relkind IN ('r', 'i');",
    );
    console.log(`database: prewarmed ${warmed} blocks of schema bench`);
  } else if (candidates.some((c) => c.control)) {
    const floor = prepareFloor();
    console.log(`floor control: ${floor.files} tiles as files`);
  }

  const pages = startPageServer();
  const browser = await launchBrowser();
  const probe = await newSession(browser, PROFILES[0]!);
  await probe.page.goto(`${pages.origin}/vendor/maplibre-gl.css`);
  const renderer = await webglRenderer(probe.page);
  await probe.context.close();
  if (/swiftshader|llvmpipe|software/i.test(renderer)) throw new Error(`WebGL is not on the GPU: ${renderer}`);
  // One unmeasured map load first, so the browser's own first start (GPU process, shader compiles) lands on no candidate.
  const warm = await newSession(browser, PROFILES[0]!);
  const blank = pages.publishStyle("warm-up", { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#ffffff" } }] });
  await warm.page.goto(`${pages.origin}/?cfg=${toBase64Url(JSON.stringify({ style: blank, view: scenarios[0]!.open }))}`);
  await warm.page.waitForFunction(() => (window as unknown as { ux?: { marks: { idle?: number } } }).ux?.marks.idle !== undefined, null, { timeout: 60_000 });
  await warm.context.close();
  console.log(`browser: Chromium ${browser.version()}, WebGL on ${renderer}; pages at ${pages.origin}`);
  writeFileSync(
    join(OUT, "meta.json"),
    JSON.stringify({ tag, family, started: new Date().toISOString(), chromium: browser.version(), renderer, rounds, candidates: candidates.map((c) => ({ id: c.id, image: c.image, variant: variantOf(c) })), scenarios: scenarios.map((s) => s.id), profiles: profiles.map((p) => p.id) }, null, 1),
  );

  for (let round = onlyRound ?? 1; round <= (onlyRound ?? rounds); round++) {
    const order = round % 2 === 1 ? candidates : [...candidates].reverse();
    for (const c of order) {
      for (const scenario of scenarios) {
        for (const profile of profiles) {
          const load = await quietHost();
          const { base, readyMs } = await restartEngine(c);
          const key = `${c.id}-${scenario.id}-${profile.id}-r${round}`;
          const style =
            family === "archive"
              ? archiveStyle(pages.origin, base + c.tilePath("berlin", TEMPLATE))
              : postgisStyle(Object.fromEntries(POSTGIS_LAYERS.map((l) => [l, base + c.tilePath(l, TEMPLATE)])) as Record<PostgisLayer, string>, await sourceLayers(c, base));
          const styleUrl = pages.publishStyle(key, style);
          const url = `${pages.origin}/?cfg=${toBase64Url(JSON.stringify({ style: styleUrl, view: scenario.open }))}`;
          const dir = join(OUT, c.id, scenario.id, profile.id, `r${round}`);
          const engine = engineContainer(c, variantOf(c));

          const visit = async (session: Awaited<ReturnType<typeof newSession>>, v: Visit): Promise<VisitRecord> => {
            const before = { engine: await cpuMs(engine), db: family === "postgis" ? await cpuMs(DB_CONTAINER) : null };
            const rec = await recordVisit(session, url, scenario, join(dir, v, "frames"), { openTimeoutMs: 60_000, settleMs: 800 });
            const after = { engine: await cpuMs(engine), db: family === "postgis" ? await cpuMs(DB_CONTAINER) : null };
            const cpu = { engineMs: before.engine !== null && after.engine !== null ? after.engine - before.engine : null, dbMs: before.db !== null && after.db !== null ? after.db - before.db : null };
            writeFileSync(join(dir, v, "visit.json"), JSON.stringify({ candidate: c.id, scenario: scenario.id, profile: profile.id, round, visit: v, tileBase: base, load, readyMs, cpu, ...rec }));
            const tiles = rec.requests.filter((r) => r.url.startsWith(base));
            const open = rec.marks.idle !== undefined ? Math.round(rec.marks.idle - rec.navStart) : "-";
            const acts = rec.actions.map((a) => Math.round(a.idle - a.start)).join("/");
            console.log(`r${round} ${c.id} ${scenario.id} ${profile.id} ${v}: open ${open} ms${acts ? `, actions ${acts} ms` : ""}, ${tiles.length} tile requests, ${tiles.filter((r) => r.failure).length} failed, ${rec.frames.length} frames${rec.failure ? `, FAILED: ${rec.failure}` : ""}`);
            return rec;
          };

          const first = await newSession(browser, profile);
          await visit(first, "first");
          await first.context.close();
          const next = await newSession(browser, profile);
          await visit(next, "next");
          await visit(next, "return");
          await next.context.close();
        }
      }
      engineDown(c, variantOf(c));
    }
  }
  await browser.close();
  pages.stop();
  writeFileSync(join(OUT, "done.json"), JSON.stringify({ finished: new Date().toISOString() }));
  console.log(`done: ${OUT}`);
}

await main();
