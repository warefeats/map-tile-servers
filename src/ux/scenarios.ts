import type { Family } from "../matrix";
import { BERLIN, PRENZLAUER_BERG, pan, type View } from "../session-plan";

/** One camera change. `ease` and `fly` animate over `durationMs`; `jump` is instant. */
export interface Move {
  kind: "ease" | "fly" | "jump";
  lon: number;
  lat: number;
  zoom: number;
  durationMs?: number;
}

/** One user action: its moves (`gapMs` apart when there are several), then the wait for idle. */
export interface Action {
  name: string;
  moves: Move[];
  gapMs?: number;
  timeoutMs: number;
}

/**
 * A kind of tile load, from where a user is to what they do next. The map opens on `open`; the
 * open itself is measured from navigation start, and each action from its own start.
 */
export interface Scenario {
  id: string;
  family: Family;
  title: string;
  open: View;
  actions: Action[];
}

const ACTION_TIMEOUT_MS = 60_000;

function ease(view: View, durationMs: number): Move {
  return { kind: "ease", ...view, durationMs };
}

/** Steps of one zoom level, easing toward `to` over 500 ms, each its own action. */
function zoomSteps(from: View, to: View, levels: number[]): Action[] {
  return levels.map((zoom) => {
    const f = (zoom - from.zoom) / (to.zoom - from.zoom);
    const view = { lon: from.lon + (to.lon - from.lon) * f, lat: from.lat + (to.lat - from.lat) * f, zoom };
    return { name: `zoom to ${zoom}`, moves: [ease(view, 500)], timeoutMs: ACTION_TIMEOUT_MS };
  });
}

/** Half-screen pans east, east, south, west, west, north, 400 ms each, each its own action. */
function panSteps(start: View): Action[] {
  const steps: [string, number, number][] = [
    ["pan east", 0.5, 0],
    ["pan east", 0.5, 0],
    ["pan south", 0, 0.5],
    ["pan west", -0.5, 0],
    ["pan west", -0.5, 0],
    ["pan north", 0, -0.5],
  ];
  let v = start;
  return steps.map(([name, dx, dy]) => {
    v = pan(v, dx, dy);
    return { name, moves: [ease(v, 400)], timeoutMs: ACTION_TIMEOUT_MS };
  });
}

/** A quick scroll: half-level steps 120 ms apart in to `peak` and back out to `end`, then the wait. */
function quickZoom(center: { lon: number; lat: number }, start: number, peak: number, end: number): Action {
  const zooms: number[] = [];
  for (let z = start + 0.5; z <= peak; z += 0.5) zooms.push(z);
  for (let z = peak - 0.5; z >= end; z -= 0.5) zooms.push(z);
  return {
    name: `scroll in to ${peak} and out to ${end}`,
    moves: zooms.map((zoom) => ease({ ...center, zoom }, 120)),
    gapMs: 120,
    timeoutMs: ACTION_TIMEOUT_MS,
  };
}

/**
 * Archive maps are the OSM Bright basemap over the OpenMapTiles archive (z0 to z14). PostGIS maps
 * draw the four bench layers, each its own source (boundaries from z8, roads z12, buildings z13,
 * points z14), so every server answers the same requests it answers in the benchmark.
 */
export const SCENARIOS: readonly Scenario[] = [
  { id: "open-street", family: "archive", title: "Open the map at street level (z14)", open: { ...PRENZLAUER_BERG, zoom: 14 }, actions: [] },
  { id: "open-city", family: "archive", title: "Open the map on the whole city (z11)", open: { ...BERLIN, zoom: 11 }, actions: [] },
  { id: "zoom-in", family: "archive", title: "Zoom in from the city to street level, one level at a time", open: { ...BERLIN, zoom: 10 }, actions: zoomSteps({ ...BERLIN, zoom: 10 }, { ...PRENZLAUER_BERG, zoom: 14 }, [11, 12, 13, 14]) },
  { id: "fly", family: "archive", title: "Fly from the region (z5) to street level (z14)", open: { ...BERLIN, zoom: 5 }, actions: [{ name: "fly to street level", moves: [{ kind: "fly", ...PRENZLAUER_BERG, zoom: 14, durationMs: 4000 }], timeoutMs: ACTION_TIMEOUT_MS }] },
  { id: "pan", family: "archive", title: "Pan around at street level (z14)", open: { ...PRENZLAUER_BERG, zoom: 14 }, actions: panSteps({ ...PRENZLAUER_BERG, zoom: 14 }) },
  { id: "quick-zoom", family: "archive", title: "Scroll in fast and back out, cancelling tiles in flight", open: { ...BERLIN, zoom: 11 }, actions: [quickZoom(PRENZLAUER_BERG, 11, 14, 12)] },

  { id: "open-street", family: "postgis", title: "Open the map at street level (z15)", open: { ...PRENZLAUER_BERG, zoom: 15 }, actions: [] },
  { id: "open-district", family: "postgis", title: "Open the map on the district (z13)", open: { ...PRENZLAUER_BERG, zoom: 13 }, actions: [] },
  { id: "zoom-in", family: "postgis", title: "Zoom in from the district to the block, one level at a time", open: { ...PRENZLAUER_BERG, zoom: 13 }, actions: zoomSteps({ ...PRENZLAUER_BERG, zoom: 13 }, { ...PRENZLAUER_BERG, zoom: 16 }, [14, 15, 16]) },
  { id: "fly", family: "postgis", title: "Fly from the city (z10) to street level (z15)", open: { ...BERLIN, zoom: 10 }, actions: [{ name: "fly to street level", moves: [{ kind: "fly", ...PRENZLAUER_BERG, zoom: 15, durationMs: 3000 }], timeoutMs: ACTION_TIMEOUT_MS }] },
  { id: "pan", family: "postgis", title: "Pan around at street level (z15)", open: { ...PRENZLAUER_BERG, zoom: 15 }, actions: panSteps({ ...PRENZLAUER_BERG, zoom: 15 }) },
  { id: "quick-zoom", family: "postgis", title: "Scroll in fast and back out, cancelling tiles in flight", open: { ...PRENZLAUER_BERG, zoom: 13 }, actions: [quickZoom(PRENZLAUER_BERG, 13, 16, 14)] },
];

export function scenariosFor(family: Family): Scenario[] {
  return SCENARIOS.filter((s) => s.family === family);
}

/** How the browser reaches the server: unthrottled, or shaped like a phone on a good 4G connection. */
export interface NetworkProfile {
  id: string;
  title: string;
  /** Chrome's request latency, download and upload throughput (bytes per second); none means unthrottled. */
  throttle?: { latencyMs: number; downloadBps: number; uploadBps: number };
}

export const PROFILES: readonly NetworkProfile[] = [
  { id: "local", title: "Unthrottled, the browser next to the server" },
  { id: "4g", title: "Fast 4G: 60 ms latency, 9 Mbps down, 1.5 Mbps up", throttle: { latencyMs: 60, downloadBps: 9_000_000 / 8, uploadBps: 1_500_000 / 8 } },
];

/**
 * Who is loading: the first visitor after the server starts (its caches cold), the next visitor
 * (server warm, browser cold), and that visitor coming back (server and browser warm).
 */
export type Visit = "first" | "next" | "return";
export const VISITS: readonly Visit[] = ["first", "next", "return"];
