import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type Browser, type BrowserContext, type CDPSession, chromium, type Page, type Request } from "playwright";
import type { Action, NetworkProfile, Scenario } from "./scenarios";

/**
 * Headless Chromium on the rig's GPU (Metal through ANGLE on macOS, as web-map-renderers runs it).
 * Web security is off so a tile server's CORS headers, which differ by server, never decide whether
 * the map draws; the headers each server sends are still recorded.
 */
export async function launchBrowser(): Promise<Browser> {
  const angle = process.platform === "darwin" ? ["--use-angle=metal"] : [];
  return chromium.launch({
    headless: true,
    chromiumSandbox: false,
    args: [...angle, "--use-gl=angle", "--ignore-gpu-blocklist", "--disable-web-security"],
  });
}

export const VIEWPORT = { width: 1920, height: 1080 } as const;
/** Screen frames are captured at half size: enough to watch and to measure visual progress. */
const FRAME = { maxWidth: 960, maxHeight: 540, quality: 60 } as const;

export interface Frame {
  file: string;
  /** When the frame was drawn, epoch milliseconds. */
  t: number;
}

export interface RequestRecord {
  url: string;
  /** Epoch milliseconds: issued, first response byte, last byte. Null when it never got that far. */
  start: number;
  sent: number | null;
  ttfb: number | null;
  end: number | null;
  status: number | null;
  /** Encoded body bytes over the wire; 0 when the browser's cache answered. */
  bodyBytes: number | null;
  headers: Record<string, string>;
  /** The validator the browser sent (If-None-Match or If-Modified-Since): a revalidation of a cached tile. */
  conditional: string | null;
  failure: string | null;
}

export interface ActionRecord {
  name: string;
  /** Epoch milliseconds. */
  start: number;
  moveEnd: number;
  idle: number;
}

export interface VisitRecord {
  url: string;
  /** Navigation start (the page's time origin), epoch milliseconds. */
  navStart: number;
  /** The map's lifecycle marks (create, style, firstTile, load, idle), epoch milliseconds. */
  marks: Record<string, number>;
  actions: ActionRecord[];
  /** Tiles as the map finished loading them: [epoch ms, source, z, x, y]. */
  tiles: [number, string, number, number, number][];
  errors: { t: number; message: string; url: string | null }[];
  frames: Frame[];
  requests: RequestRecord[];
  /** When recording stopped, epoch milliseconds. */
  end: number;
  failure: string | null;
}

export interface Session {
  context: BrowserContext;
  page: Page;
  cdp: CDPSession;
}

/** A fresh browser context (empty cache, no cookies) with one page, throttled to `profile`. */
export async function newSession(browser: Browser, profile: NetworkProfile): Promise<Session> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  if (profile.throttle) {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: profile.throttle.latencyMs,
      downloadThroughput: profile.throttle.downloadBps,
      uploadThroughput: profile.throttle.uploadBps,
    });
  }
  return { context, page, cdp };
}

/** What the page's WebGL actually rendered with. */
export async function webglRenderer(page: Page): Promise<string> {
  return page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
    if (!gl) return "no WebGL";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  });
}

const KEPT_HEADERS = ["content-type", "content-encoding", "content-length", "cache-control", "etag", "last-modified", "expires", "vary", "access-control-allow-origin", "age"];

async function requestRecord(req: Request, failure: string | null): Promise<RequestRecord> {
  const t = req.timing();
  const at = (offset: number) => (offset >= 0 ? t.startTime + offset : null);
  const response = failure ? null : await req.response().catch(() => null);
  const headers: Record<string, string> = {};
  if (response) {
    const all = await response.allHeaders().catch(() => ({}) as Record<string, string>);
    for (const k of KEPT_HEADERS) if (all[k] !== undefined) headers[k] = all[k]!;
  }
  const sizes = failure ? null : await req.sizes().catch(() => null);
  const sent = await req.allHeaders().catch(() => ({}) as Record<string, string>);
  return {
    url: req.url(),
    start: t.startTime,
    sent: at(t.requestStart),
    ttfb: at(t.responseStart),
    end: at(t.responseEnd),
    status: response?.status() ?? null,
    bodyBytes: sizes ? sizes.responseBodySize : null,
    headers,
    conditional: sent["if-none-match"] ?? sent["if-modified-since"] ?? null,
    failure,
  };
}

/**
 * One visit: navigate, wait for the map's first idle, run the scenario's actions, let label fades
 * finish, and keep every frame, request and map mark on one epoch-millisecond clock.
 */
export async function recordVisit(session: Session, url: string, scenario: Scenario, framesDir: string, opts: { openTimeoutMs: number; settleMs: number }): Promise<VisitRecord> {
  const { page, cdp } = session;
  mkdirSync(framesDir, { recursive: true });
  const frames: Frame[] = [];
  const writes: Promise<unknown>[] = [];
  const onFrame = (e: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
    cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId }).catch(() => {});
    const file = join(framesDir, `${String(frames.length).padStart(5, "0")}.jpg`);
    frames.push({ file, t: (e.metadata.timestamp ?? Date.now() / 1000) * 1000 });
    writes.push(Bun.write(file, Buffer.from(e.data, "base64")));
  };
  const pending: Promise<RequestRecord>[] = [];
  const onFinished = (req: Request) => pending.push(requestRecord(req, null));
  const onFailed = (req: Request) => pending.push(requestRecord(req, req.failure()?.errorText ?? "failed"));

  cdp.on("Page.screencastFrame", onFrame);
  page.on("requestfinished", onFinished);
  page.on("requestfailed", onFailed);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: FRAME.quality, maxWidth: FRAME.maxWidth, maxHeight: FRAME.maxHeight, everyNthFrame: 1 });

  const actions: ActionRecord[] = [];
  let failure: string | null = null;
  try {
    await page.goto(url, { waitUntil: "commit", timeout: opts.openTimeoutMs });
    await page.waitForFunction(() => (window as unknown as { ux?: { marks: { idle?: number } } }).ux?.marks.idle !== undefined, null, { timeout: opts.openTimeoutMs, polling: 50 });
    for (const action of scenario.actions) {
      const r = await page.evaluate((a: Action) => (window as unknown as { ux: { act(a: Action): Promise<{ start: number; moveEnd: number; idle: number }> } }).ux.act(a), action);
      actions.push({ name: action.name, ...r });
    }
  } catch (err) {
    failure = err instanceof Error ? err.message.split("\n")[0]! : String(err);
  }
  await Bun.sleep(opts.settleMs);

  const state = await page
    .evaluate(() => {
      const ux = (window as unknown as { ux?: { marks: Record<string, number>; errors: { t: number; message: string; url: string | null }[]; tiles: [number, string, number, number, number][] } }).ux;
      return { timeOrigin: performance.timeOrigin, marks: ux?.marks ?? {}, errors: ux?.errors ?? [], tiles: ux?.tiles ?? [] };
    })
    .catch(() => ({ timeOrigin: 0, marks: {} as Record<string, number>, errors: [], tiles: [] as [number, string, number, number, number][] }));
  await cdp.send("Page.stopScreencast").catch(() => {});
  const end = Date.now();
  cdp.off("Page.screencastFrame", onFrame);
  page.off("requestfinished", onFinished);
  page.off("requestfailed", onFailed);
  await Promise.all(writes);
  const requests = await Promise.all(pending);

  const epoch = (ms: number) => state.timeOrigin + ms;
  return {
    url,
    navStart: state.timeOrigin,
    marks: Object.fromEntries(Object.entries(state.marks).map(([k, v]) => [k, epoch(v)])),
    actions: actions.map((a) => ({ name: a.name, start: epoch(a.start), moveEnd: epoch(a.moveEnd), idle: epoch(a.idle) })),
    tiles: state.tiles.map(([t, s, z, x, y]) => [epoch(t), s, z, x, y]),
    errors: state.errors.map((e) => ({ ...e, t: epoch(e.t) })),
    frames,
    requests,
    end,
    failure,
  };
}
