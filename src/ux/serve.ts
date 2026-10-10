import { existsSync, readFileSync } from "node:fs";
import { join, normalize, sep } from "node:path";

const ROOT = join(import.meta.dirname!, "..", "..");
const PAGE_DIR = join(ROOT, "ux", "page");
const STYLE_DIR = join(ROOT, "ux", "style");
const GLYPHS_DIR = join(ROOT, "data", "ux", "glyphs");
const VENDOR_DIR = join(ROOT, "node_modules", "maplibre-gl", "dist");
/** The current major, for checks against gl-js 6 (`/index6.html`); the runs themselves load 5.24.0. */
const VENDOR6_DIR = join(ROOT, "node_modules", "maplibre-gl-6", "dist");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".pbf": "application/x-protobuf",
};

/**
 * Everything but the tiles comes from this server, the same for every candidate. It is cacheable,
 * so a returning visitor's browser only has the tile server's caching left to exercise.
 */
const CACHEABLE = { "Cache-Control": "public, max-age=86400" };

function contentType(path: string): string {
  const dot = path.lastIndexOf(".");
  return (dot >= 0 && CONTENT_TYPES[path.slice(dot)]) || "application/octet-stream";
}

/** Refuses any resolved path that escapes its base directory. */
function safeJoin(base: string, ...parts: string[]): string | null {
  const full = normalize(join(base, ...parts));
  const root = normalize(base).replace(/[\\/]+$/, "");
  return full === root || full.startsWith(root + sep) ? full : null;
}

function file(path: string | null): Response {
  if (!path || !existsSync(path)) return new Response("not found", { status: 404 });
  return new Response(Bun.file(path), { headers: { ...CACHEABLE, "Content-Type": contentType(path) } });
}

export interface PageServer {
  origin: string;
  /** Publishes a style under `/style/{key}.json` and returns its URL. */
  publishStyle(key: string, style: unknown): string;
  stop(): void;
}

export function startPageServer(): PageServer {
  const styles = new Map<string, string>();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname);
      if (path === "/" || path === "/index.html") return file(join(PAGE_DIR, "index.html"));
      if (path === "/index6.html") return file(join(PAGE_DIR, "index6.html"));
      if (path === "/ux.js") return file(join(PAGE_DIR, "ux.js"));
      // gl-js 6 is ES modules only: the main module loads its worker and shared chunk from beside itself.
      if (path.startsWith("/vendor6/")) return file(safeJoin(VENDOR6_DIR, path.slice("/vendor6/".length)));
      if (path === "/vendor/maplibre-gl.js" || path === "/vendor/maplibre-gl.css") return file(join(VENDOR_DIR, path.slice("/vendor/".length)));
      const style = path.match(/^\/style\/([\w.-]+)\.json$/);
      if (style) {
        const body = styles.get(style[1]!);
        return body ? new Response(body, { headers: { ...CACHEABLE, "Content-Type": CONTENT_TYPES[".json"]! } }) : new Response("not found", { status: 404 });
      }
      const sprite = path.match(/^\/sprite\/(sprite(?:@2x)?\.(?:json|png))$/);
      if (sprite) return file(join(STYLE_DIR, sprite[1]!));
      const glyph = path.match(/^\/glyphs\/([^/]+)\/(\d+-\d+)\.pbf$/);
      if (glyph) {
        // A font stack is a comma-separated list; every font this style names has its own directory.
        const font = glyph[1]!.split(",")[0]!.trim();
        return file(safeJoin(GLYPHS_DIR, font, `${glyph[2]}.pbf`));
      }
      return new Response("not found", { status: 404 });
    },
  });
  const origin = `http://127.0.0.1:${server.port}`;
  return {
    origin,
    publishStyle(key, style) {
      styles.set(key, JSON.stringify(style));
      return `${origin}/style/${key}.json`;
    },
    stop() {
      server.stop(true);
    },
  };
}

/** OSM Bright over the candidate's tiles: the style's own source, re-pointed, glyphs and sprites from this server. */
export function archiveStyle(origin: string, tileTemplate: string): unknown {
  const style = JSON.parse(readFileSync(join(STYLE_DIR, "osm-bright.json"), "utf8").replaceAll("{origin}", origin)) as {
    sources: Record<string, { tiles?: string[] }>;
  };
  style.sources["openmaptiles"]!.tiles = [tileTemplate];
  return style;
}

export type PostgisLayer = "boundaries" | "roads" | "buildings" | "pois";
export const POSTGIS_LAYERS: readonly PostgisLayer[] = ["boundaries", "roads", "buildings", "pois"];

/** The zoom each PostGIS layer starts at; below it the map asks for none of that layer's tiles. */
export const POSTGIS_MINZOOM: Record<PostgisLayer, number> = { boundaries: 8, roads: 12, buildings: 13, pois: 14 };

/**
 * Four sources, one per bench layer, each with the layer name the candidate writes into its tiles.
 * No labels or icons: nothing in it depends on a server's attribute names.
 */
export function postgisStyle(templates: Record<PostgisLayer, string>, sourceLayers: Record<PostgisLayer, string>): unknown {
  const source = (layer: PostgisLayer) => ({ type: "vector", tiles: [templates[layer]], minzoom: POSTGIS_MINZOOM[layer], maxzoom: 22 });
  return {
    version: 8,
    name: "martin-2 ux postgis",
    sources: Object.fromEntries(POSTGIS_LAYERS.map((l) => [l, source(l)])),
    layers: [
      { id: "background", type: "background", paint: { "background-color": "#f2efe9" } },
      { id: "boundaries", type: "line", source: "boundaries", "source-layer": sourceLayers.boundaries, paint: { "line-color": "#8e7cc3", "line-width": 1.5, "line-dasharray": [3, 2] } },
      { id: "roads", type: "line", source: "roads", "source-layer": sourceLayers.roads, paint: { "line-color": "#7d7d7d", "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.5, 16, 2.5] } },
      { id: "buildings", type: "fill", source: "buildings", "source-layer": sourceLayers.buildings, paint: { "fill-color": "#d9d0c9", "fill-outline-color": "#b8aca2" } },
      { id: "pois", type: "circle", source: "pois", "source-layer": sourceLayers.pois, paint: { "circle-radius": 3, "circle-color": "#d1495b", "circle-stroke-width": 1, "circle-stroke-color": "#ffffff" } },
    ],
  };
}
