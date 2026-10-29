"""
Extracts an MBTiles archive into tile files the way OpenFreeMap's extract_mbtiles does
(github.com/hyperknot/openfreemap at 332669ab, tilegen/tilegen_lib/mbtiles.py): one file per distinct tile under
dedupl/, every tile at tiles/z/x/y.pbf as a hard link to it with y flipped from TMS, a further copy when a file
reaches the hard-link limit, and metadata.json and osm_date beside them. It reads the flat `tiles` table as well
as Planetiler's deduplicated tables.
    python3 scripts/lane_extract_mbtiles.py <archive.mbtiles> <dir>
"""

import errno
import json
import shutil
import sqlite3
import sys
from pathlib import Path


def dedupl_path(root: Path, i: int) -> Path:
    s = f"{i:09}"
    return root / "dedupl" / s[:3] / s[3:6] / f"{s[6:]}.pbf"


def extract(archive: str, out: str) -> None:
    root = Path(out)
    if root.exists() and any(root.iterdir()):
        raise SystemExit(f"{root} is not empty")
    root.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(f"file:{archive}?mode=ro", uri=True)
    tables = {r[0] for r in db.execute("select name from sqlite_master where type in ('table', 'view')")}
    if {"tiles_shallow", "tiles_data"} <= tables:
        rows = db.execute("select s.zoom_level, s.tile_column, s.tile_row, d.tile_data from tiles_shallow s join tiles_data d using (tile_data_id)")
    else:
        rows = db.execute("select zoom_level, tile_column, tile_row, tile_data from tiles")
    ids: dict[bytes, int] = {}
    copies: dict[Path, int] = {}
    count = 0
    for z, x, y, data in rows:
        if data not in ids:
            ids[data] = len(ids) + 1
            first = dedupl_path(root, ids[data])
            first.parent.mkdir(parents=True, exist_ok=True)
            first.write_bytes(data)
        d = dedupl_path(root, ids[data])
        tile = root / "tiles" / str(z) / str(x) / f"{(1 << z) - 1 - y}.pbf"
        tile.parent.mkdir(parents=True, exist_ok=True)
        if tile.is_file():
            continue
        try:
            tile.hardlink_to(d.with_name(f"{d.name}-{copies[d]}") if d in copies else d)
        except OSError as e:
            if e.errno != errno.EMLINK:
                raise
            copies[d] = copies.get(d, 0) + 1
            shutil.copyfile(d, d.with_name(f"{d.name}-{copies[d]}"))
            tile.hardlink_to(d.with_name(f"{d.name}-{copies[d]}"))
        count += 1
    metadata = dict(db.execute("select name, value from metadata"))
    metadata.setdefault("osm_date", metadata.get("planetiler:osm:osmosisreplicationtime", "")[:10])
    (root / "metadata.json").write_text(json.dumps(metadata, indent=2))
    (root / "osm_date").write_text(metadata["osm_date"])
    print(f"{count} tiles, {len(ids)} distinct")


if __name__ == "__main__":
    extract(sys.argv[1], sys.argv[2])
