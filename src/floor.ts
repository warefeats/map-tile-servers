/**
 * The archive family's floor control (docs/adr/0007): nginx serving, as plain files, every tile the
 * floored sections request. The files are the archive's own stored bytes, read straight out of
 * berlin.mbtiles, so the floor does not depend on any server's output. A tile the archive does not
 * have gets no file, and nginx answers 204 for it, as Martin does.
 */
import { Database } from "bun:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { run } from "./docker";
import { FLOOR_IMAGE, protocol, TILES, VIEWPORT } from "./matrix";
import { userFlight, viewTiles } from "./session-plan";
import type { TileCoord } from "./tiles";

const ROOT = join(import.meta.dirname!, "..");
const SOURCE = join(ROOT, "data", "cache", "berlin.mbtiles");
const STAGING = join(ROOT, ".work", "floor-www");
export const FLOOR_VOLUME = "m2-floor-www";

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
  run(["docker", "volume", "create", FLOOR_VOLUME], { quiet: true });
  const copy = run(["docker", "run", "--rm", "-v", `${FLOOR_VOLUME}:/www`, "-v", `${STAGING}:/src:ro`, "--entrypoint", "sh", FLOOR_IMAGE, "-c", "rm -rf /www/tiles && cp -a /src/tiles /www/tiles && find /www/tiles -type f | wc -l"]);
  const copied = Number(copy.stdout.trim());
  if (copy.exitCode !== 0 || copied !== files) throw new Error(`floor volume holds ${copied} files, expected ${files}: ${copy.stderr.slice(-300)}`);
  return { files, empty, bytes };
}
