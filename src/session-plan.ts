import type { Family } from "./matrix";
import type { TileCoord } from "./tiles";

/**
 * A map session: what a MapLibre client asks for while someone flies into Berlin and pans around.
 * A 1920 x 1080 viewport over 512 px vector tiles, zoom levels as integers (the tile zoom MapLibre
 * requests), a per-user tile cache so a pan asks only for the tiles it newly reveals, and six
 * keep-alive connections per user (a browser's HTTP/1.1 per-host limit).
 */
export const VIEWPORT_PX = { width: 1920, height: 1080 } as const;
export const TILE_PX = 512;
export const CONNECTIONS_PER_USER = 6;

export interface View {
  lon: number;
  lat: number;
  zoom: number;
}

/** Tiles covering a viewport centred on `view`, row-major. */
export function viewTiles(view: View): TileCoord[] {
  const z = view.zoom;
  const world = TILE_PX * 2 ** z;
  const cx = ((view.lon + 180) / 360) * world;
  const latRad = (view.lat * Math.PI) / 180;
  const cy = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * world;
  const x0 = Math.floor((cx - VIEWPORT_PX.width / 2) / TILE_PX);
  const x1 = Math.floor((cx + VIEWPORT_PX.width / 2 - 1) / TILE_PX);
  const y0 = Math.floor((cy - VIEWPORT_PX.height / 2) / TILE_PX);
  const y1 = Math.floor((cy + VIEWPORT_PX.height / 2 - 1) / TILE_PX);
  const tiles: TileCoord[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ z, x, y });
  return tiles;
}

/** Offset a view by whole screen widths/heights (a pan), in degrees at that zoom. */
export function pan(view: View, dxScreens: number, dyScreens: number): View {
  const world = TILE_PX * 2 ** view.zoom;
  const dLon = ((dxScreens * VIEWPORT_PX.width) / world) * 360;
  const latRad = (view.lat * Math.PI) / 180;
  const my = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 + (dyScreens * VIEWPORT_PX.height) / world;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * my))) * 180) / Math.PI;
  return { lon: view.lon + dLon, lat, zoom: view.zoom };
}

export const BERLIN = { lon: 13.405, lat: 52.52 };
export const PRENZLAUER_BERG = { lon: 13.4185, lat: 52.5365 };

/** Half-screen pans in a loop: east, east, south, west, west, north (every pan reveals new tiles). */
function panLoop(start: View): View[] {
  const steps: [number, number][] = [
    [0.5, 0],
    [0.5, 0],
    [0, 0.5],
    [-0.5, 0],
    [-0.5, 0],
    [0, -0.5],
  ];
  const views: View[] = [];
  let v = start;
  for (const [dx, dy] of steps) {
    v = pan(v, dx, dy);
    views.push(v);
  }
  return views;
}

/**
 * Archive flight: zoom from the whole region to street level over Prenzlauer Berg, then pan at
 * z14 (the archive's maxzoom). PostGIS flight: city zooms z13 to z16 (tiles are cut per request at
 * any zoom), then pan at z15. Every tile a flight touches is inside the extract.
 */
export function flight(family: Family): View[] {
  if (family === "archive") {
    const zooms: View[] = [5, 6, 7, 8, 9, 10, 11].map((zoom) => ({ ...BERLIN, zoom }));
    zooms.push(...[12, 13, 14].map((zoom) => ({ ...PRENZLAUER_BERG, zoom })));
    return [...zooms, ...panLoop({ ...PRENZLAUER_BERG, zoom: 14 })];
  }
  const zooms: View[] = [13, 14, 15, 16].map((zoom) => ({ ...PRENZLAUER_BERG, zoom }));
  return [...zooms, ...panLoop({ ...PRENZLAUER_BERG, zoom: 15 })];
}

/** The layers a PostGIS map style would draw as separate sources; the archive is one source. */
export function sessionLayers(family: Family): string[] {
  return family === "postgis" ? ["buildings", "roads", "pois"] : ["berlin"];
}

/**
 * User `u` of `n` starts the flight at a different view, so concurrent users are spread over the
 * flight instead of asking for the same tiles in lockstep.
 */
export function userFlight(family: Family, u: number, n: number): View[] {
  const views = flight(family);
  const offset = n <= 1 ? 0 : Math.floor((u * views.length) / n);
  return [...views.slice(offset), ...views.slice(0, offset)];
}
