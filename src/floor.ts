/**
 * The floor controls: nginx serving tiles as plain files.
 *
 * Archive family (docs/adr/0007): every tile the floored sections request, as the archive's own stored
 * bytes, read straight out of berlin.mbtiles, so the floor does not depend on any server's output. A
 * tile the archive does not have gets no file, and nginx answers 204 for it, as Martin does.
 *
 * PostGIS family (docs/adr/0012): only the marquee tile, for the two start categories, as the bytes
 * PostGIS makes from the corpus with the tile parameters every server uses.
 */
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { psql, run } from "./docker";
import { FLOOR_IMAGE, protocol, TILES, VIEWPORT } from "./matrix";
import { userFlight, viewTiles } from "./session-plan";
import type { TileCoord } from "./tiles";

const ROOT = join(import.meta.dirname!, "..");
const SOURCE = join(ROOT, "data", "cache", "berlin.mbtiles");
const STAGING = join(ROOT, ".work", "floor-www");
export const FLOOR_VOLUME = "m2-floor-www";
const POSTGIS_STAGING = join(ROOT, ".work", "floor-postgis-www");
export const FLOOR_POSTGIS_VOLUME = "m2-floor-postgis-www";

/** Every tile the control is asked for: the test tiles, the viewport burst and every view of both sessions. */
export function floorTiles(): TileCoord[] {
  const want = new Map<string, TileCoord>();
  const add = (t: TileCoord) => want.set(`${t.z}/${t.x}/${t.y}`, t);
  for (const spec of TILES.archive) add(spec.tile);
  for (const t of VIEWPORT.archive.tiles) add(t);
  for (const users of protocol("archive", false).session.users) for (let u = 0; u < users; u++) for (const view of userFlight("archive", u, users)) for (const t of viewTiles(view)) add(t);
  return [...want.values()];
}

/** Write the tiles under .work/floor-www/tiles/berlin/z/x/y and copy them into the control's volume. */
export function prepareFloor(): { files: number; empty: number; bytes: number } {
  rmSync(STAGING, { recursive: true, force: true });
  const db = new Database(SOURCE, { readonly: true });
  const query = db.query<{ tile_data: Uint8Array }, [number, number, number]>("SELECT tile_data FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?");
  let files = 0;
  let empty = 0;
  let bytes = 0;
  for (const t of floorTiles()) {
    // MBTiles rows count from the south (TMS).
    const row = query.get(t.z, t.x, 2 ** t.z - 1 - t.y);
    if (!row) {
      empty++;
      continue;
    }
    const path = join(STAGING, "tiles", "berlin", String(t.z), String(t.x), String(t.y));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, row.tile_data);
    files++;
    bytes += row.tile_data.byteLength;
  }
  db.close();
  fillVolume(FLOOR_VOLUME, STAGING, files);
  return { files, empty, bytes };
}

/** Copy a staged tiles/ tree into a control's volume and check every file arrived. */
function fillVolume(volume: string, staging: string, files: number): void {
  run(["docker", "volume", "create", volume], { quiet: true });
  const copy = run(["docker", "run", "--rm", "-v", `${volume}:/www`, "-v", `${staging}:/src:ro`, "--entrypoint", "sh", FLOOR_IMAGE, "-c", "rm -rf /www/tiles && cp -a /src/tiles /www/tiles && find /www/tiles -type f | wc -l"]);
  const copied = Number(copy.stdout.trim());
  if (copy.exitCode !== 0 || copied !== files) throw new Error(`${volume} holds ${copied} files, expected ${files}: ${copy.stderr.slice(-300)}`);
}

/** Write the marquee tile, gzipped, under .work/floor-postgis-www/tiles/<layer>/z/x/y and copy it into the control's volume. */
export function preparePostgisFloor(): { bytes: number } {
  rmSync(POSTGIS_STAGING, { recursive: true, force: true });
  const { layer, tile } = TILES.postgis[0]!;
  const { z, x, y } = tile;
  const mvt = psql(
    `SELECT encode(ST_AsMVT(t, '${layer}', 4096, 'geom'), 'base64') FROM (SELECT ST_AsMVTGeom(geom, ST_TileEnvelope(${z}, ${x}, ${y}), 4096, 64, true) AS geom, fid, osm_id, name, building FROM bench.${layer} WHERE geom && ST_TileEnvelope(${z}, ${x}, ${y}, margin => 64.0 / 4096)) AS t`,
  );
  const bytes = Bun.gzipSync(Buffer.from(mvt, "base64"));
  if (bytes.byteLength < 1000) throw new Error(`the marquee tile came out ${bytes.byteLength} bytes`);
  const path = join(POSTGIS_STAGING, "tiles", layer, String(z), String(x), String(y));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  fillVolume(FLOOR_POSTGIS_VOLUME, POSTGIS_STAGING, 1);
  return { bytes: bytes.byteLength };
}
