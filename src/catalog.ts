/**
 * "A thousand sources": every server starts with 1,000 extra sources configured next to the usual
 * ones, and the runner times process start to the first marquee tile, then asks once for a tile
 * of the last extra source. PostGIS: 1,000 tables in schema `many`, visible only to the role
 * `tiles_many`. Archives: 1,000 small archives (z0-8 of the Berlin build) per format.
 */
import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clientUp, dbUp, ensureNetwork, engineDown, imageDigest, psql, run, stopAllEngines, WORK_DIR } from "./docker";
import { type Candidate, CANDIDATES, type Family, protocol, REQUEST_HEADERS, TILES, tileUrl } from "./matrix";
import { prepareFloor } from "./floor";
import { coldStart, type ColdStartResult } from "./measure";
import { lonLatToTile, type TileCoord } from "./tiles";

const ROOT = join(import.meta.dirname!, "..");
export const CATALOG_SIZE = 1000;
const pad = (i: number) => String(i).padStart(4, "0");
export const CATALOG_NAMES = Array.from({ length: CATALOG_SIZE }, (_, i) => `t${pad(i)}`);
const LAST = CATALOG_NAMES[CATALOG_SIZE - 1]!;

// ---- PostGIS: tables, role, configs --------------------------------------------------------

export function preparePostgisTables(): void {
  const have = Number(psql("SELECT count(*) FROM pg_tables WHERE schemaname = 'many'"));
  if (have === CATALOG_SIZE) {
    console.log(`catalog: schema many already has ${have} tables`);
    return;
  }
  console.log(`catalog: creating ${CATALOG_SIZE} tables in schema many (each a 1/${CATALOG_SIZE} slice of bench.buildings)`);
  psql(`
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tiles_many') THEN CREATE ROLE tiles_many LOGIN PASSWORD 'tiles'; END IF;
END $$;
DROP SCHEMA IF EXISTS many CASCADE;
CREATE SCHEMA many;
DO $$ DECLARE t text; BEGIN
  FOR i IN 0..${CATALOG_SIZE - 1} LOOP
    t := 't' || lpad(i::text, 4, '0');
    EXECUTE format('CREATE TABLE many.%I AS SELECT fid, osm_id, name, building, geom FROM bench.buildings WHERE fid %% ${CATALOG_SIZE} = %s', t, i);
    EXECUTE format('ALTER TABLE many.%I ADD PRIMARY KEY (fid)', t);
    EXECUTE format('CREATE INDEX ON many.%I USING GIST (geom)', t);
    EXECUTE format('ANALYZE many.%I', t);
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA bench, many TO tiles_many;
GRANT SELECT ON ALL TABLES IN SCHEMA bench TO tiles_many;
GRANT SELECT ON ALL TABLES IN SCHEMA many TO tiles_many;
`);
}

const CATALOG_DB_URL = "postgresql://tiles_many:tiles@db/bench";

function writeFile(path: string, text: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

/** Per-candidate catalog configs plus the compose override that points the engine at them. */
export function writePostgisCatalogConfigs(): void {
  const cfg = join(ROOT, "configs", "catalog", "postgis");
  const cmp = join(ROOT, "compose", "postgis");
  const buildingsColumns = { fid: "INTEGER", osm_id: "STRING", name: "STRING", building: "STRING" };

  // Martin: same file as the main run, publishing both schemas.
  writeFile(
    join(cfg, "martin", "config.yaml"),
    `# Martin catalog run: the main config, publishing schema many as well (1,000 more tables).
listen_addresses: '0.0.0.0:3000'
worker_processes: 4
keep_alive: 75
cache: disable
postgres:
  connection_string: \${DATABASE_URL}
  pool_size: 8
  auto_bounds: skip
  auto_publish:
    from_schemas:
      - bench
      - many
    tables:
      source_id_format: '{table}'
      id_columns: fid
      extent: 4096
      buffer: 64
      clip_geom: true
`,
  );
  for (const id of ["martin-2", "martin-1"]) {
    writeFile(join(cmp, `${id}.catalog.yml`), `services:\n  engine:\n    environment:\n      DATABASE_URL: ${CATALOG_DB_URL}\n    volumes:\n      - ../../configs/catalog/postgis/martin:/config:ro\n`);
  }

  // pg_tileserv discovers every table the role can read.
  writeFile(join(cmp, "pg-tileserv.catalog.yml"), `services:\n  engine:\n    environment:\n      DATABASE_URL: ${CATALOG_DB_URL}\n`);

  // TiPg: environment overrides the env_file.
  writeFile(join(cmp, "tipg.catalog.yml"), `services:\n  engine:\n    environment:\n      DATABASE_URL: postgresql://tiles_many:tiles@db:5432/bench\n      TIPG_DB_SCHEMAS: '["bench","many"]'\n`);

  // Tegola: one layer per table in the same map.
  const tegolaMain = readText(join(ROOT, "configs", "postgis", "tegola", "config.toml"));
  const [head, maps] = tegolaMain.split("[[maps]]");
  const providerLayers = CATALOG_NAMES.map(
    (t) => `
  [[providers.layers]]
  name = "${t}"
  geometry_fieldname = "geom"
  id_fieldname = "fid"
  geometry_type = "multipolygon"
  sql = "SELECT ST_AsMVTGeom(geom, !BBOX!, 4096, 64, true) AS geom, fid, osm_id, name, building FROM many.${t} WHERE geom && !BBOX!"
`,
  ).join("");
  const mapLayers = CATALOG_NAMES.map((t) => `\n  [[maps.layers]]\n  provider_layer = "bench.${t}"\n  min_zoom = 0\n  max_zoom = 22\n`).join("");
  writeFile(join(cfg, "tegola", "config.toml"), `${head!.trimEnd()}\n${providerLayers}\n[[maps]]${maps!.trimEnd()}\n${mapLayers}`);
  writeFile(join(cmp, "tegola.catalog.yml"), `services:\n  engine:\n    environment:\n      DATABASE_URL: postgresql://tiles_many:tiles@db:5432/bench\n    volumes:\n      - ../../configs/catalog/postgis/tegola:/config:ro\n`);

  // BBOX: one tileset per table.
  const bboxMain = readText(join(ROOT, "configs", "postgis", "bbox", "bbox.toml")).replace("postgresql://tiles:tiles@db/bench", CATALOG_DB_URL);
  const bboxExtra = CATALOG_NAMES.map(
    (t) => `
[[tileset]]
name = "${t}"
[tileset.postgis]
datasource = "bench"
[[tileset.postgis.layer]]
name = "${t}"
table_name = "many.${t}"
geometry_field = "geom"
geometry_type = "MULTIPOLYGON"
fid_field = "fid"
srid = 3857
tile_size = 4096
buffer_size = 64
`,
  ).join("");
  writeFile(join(cfg, "bbox", "bbox.toml"), bboxMain.trimEnd() + "\n" + bboxExtra);
  writeFile(join(cmp, "bbox.catalog.yml"), `services:\n  engine:\n    volumes:\n      - ../../configs/catalog/postgis/bbox:/config:ro\n`);

  // ldproxy (both): one feature type and one tileset per table.
  const typeYaml = (t: string) =>
    `  ${t}:\n    sourcePath: /${t}\n    type: OBJECT\n    properties:\n${Object.entries(buildingsColumns)
      .map(([col, type]) => `      ${col}:\n        sourcePath: ${col}\n        type: ${type}${col === "fid" ? "\n        role: ID" : ""}`)
      .join("\n")}\n      geom:\n        sourcePath: geom\n        type: GEOMETRY\n        role: PRIMARY_GEOMETRY\n        geometryType: MULTI_POLYGON\n`;
  for (const variant of ["plain", "pgis"] as const) {
    const src = variant === "plain" ? join(ROOT, "configs", "postgis", "ldproxy", "entities", "instances", "providers", "bench.yml") : join(ROOT, "configs", "postgis", "ldproxy", "providers", "bench-pgis.yml");
    let provider = readText(src).replace("user: tiles\n", "user: tiles_many\n").replace("  schemas:\n    - bench\n", "  schemas:\n    - bench\n    - many\n");
    // Insert the extra types right after `types:` (the extensions block, if any, follows the types).
    provider = provider.replace("types:\n", `types:\n${CATALOG_NAMES.map((t) => typeYaml(t).replace(`sourcePath: /${t}`, `sourcePath: /many.${t}`)).join("")}`);
    writeFile(join(cfg, "ldproxy", `bench-${variant}.yml`), provider);
  }
  const tilesMain = readText(join(ROOT, "configs", "postgis", "ldproxy", "entities", "instances", "providers", "bench-tiles.yml"));
  writeFile(join(cfg, "ldproxy", "bench-tiles.yml"), tilesMain.trimEnd() + "\n" + CATALOG_NAMES.map((t) => `  ${t}:\n    id: ${t}\n`).join(""));
  const ldMount = (variant: string) =>
    `services:\n  engine:\n    volumes:\n      - ../../configs/catalog/postgis/ldproxy/bench-${variant}.yml:/ldproxy/data/entities/instances/providers/bench.yml:ro\n      - ../../configs/catalog/postgis/ldproxy/bench-tiles.yml:/ldproxy/data/entities/instances/providers/bench-tiles.yml:ro\n`;
  writeFile(join(cmp, "ldproxy.catalog.yml"), ldMount("plain"));
  writeFile(join(cmp, "ldproxy-pgis.catalog.yml"), ldMount("pgis"));
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

/** The last extra source's tile path, per PostGIS candidate. */
function postgisCatalogPath(c: Candidate, tile: TileCoord): string {
  switch (c.server) {
    case "pg-tileserv":
      return `/many.${LAST}/${tile.z}/${tile.x}/${tile.y}.pbf`;
    case "tipg":
      return `/collections/many.${LAST}/tiles/WebMercatorQuad/${tile.z}/${tile.x}/${tile.y}`;
    default:
      return c.tilePath(LAST, tile);
  }
}

// ---- archives: 1,000 small files per format ------------------------------------------------

const CATALOG_DIR = join(ROOT, "data", "catalog");
/** The z8 tile holding central Berlin, present in every small archive. */
export const SMALL_TILE: TileCoord = lonLatToTile(13.405, 52.52, 8);

export function prepareArchiveFiles(): void {
  const pmDir = join(CATALOG_DIR, "pmtiles");
  const mbDir = join(CATALOG_DIR, "mbtiles");
  mkdirSync(pmDir, { recursive: true });
  mkdirSync(mbDir, { recursive: true });
  const smallMb = join(CATALOG_DIR, "small.mbtiles");
  const smallPm = join(CATALOG_DIR, "small.pmtiles");
  if (!existsSync(smallMb)) {
    console.log("catalog: cutting z0-8 of berlin.mbtiles into small.mbtiles");
    const r = run(["docker", "run", "--rm", "-v", `${join(ROOT, "data", "cache")}:/in:ro`, "-v", `${CATALOG_DIR}:/out`, "--entrypoint", "/usr/local/bin/mbtiles", "ghcr.io/maplibre/martin:1.16.1", "copy", "/in/berlin.mbtiles", "/out/small.mbtiles", "--max-zoom", "8", "--dst-type", "flat"]);
    if (r.exitCode !== 0) throw new Error("mbtiles copy failed");
  }
  if (!existsSync(smallPm)) {
    console.log("catalog: converting small.mbtiles to small.pmtiles");
    const r = run(["docker", "run", "--rm", "-v", `${CATALOG_DIR}:/w`, "protomaps/go-pmtiles:v1.31.2", "convert", "/w/small.mbtiles", "/w/small.pmtiles"]);
    if (r.exitCode !== 0) throw new Error("pmtiles convert failed");
  }
  const count = (dir: string, ext: string) => readdirSync(dir).filter((f) => f.endsWith(ext)).length;
  // The copies come first: the -all directories link to them, and a clean tree has none yet.
  if (count(pmDir, ".pmtiles") !== CATALOG_SIZE || count(mbDir, ".mbtiles") !== CATALOG_SIZE) {
    console.log(`catalog: writing ${CATALOG_SIZE} copies per format (distinct files, not links)`);
    for (const name of CATALOG_NAMES) {
      copyFileSync(smallPm, join(pmDir, `${name}.pmtiles`));
      copyFileSync(smallMb, join(mbDir, `${name}.mbtiles`));
    }
  }
  for (const fmt of ["pmtiles", "mbtiles"] as const) {
    const all = join(CATALOG_DIR, `${fmt}-all`);
    mkdirSync(all, { recursive: true });
    if (count(all, `.${fmt}`) !== CATALOG_SIZE + 1) {
      for (const name of CATALOG_NAMES) linkIfMissing(join(CATALOG_DIR, fmt, `${name}.${fmt}`), join(all, `${name}.${fmt}`));
      linkIfMissing(join(ROOT, "data", "cache", `berlin.${fmt}`), join(all, `berlin.${fmt}`));
    }
  }
}

export function writeArchiveCatalogConfigs(): void {
  const cfg = join(ROOT, "configs", "catalog", "archive");
  const cmp = join(ROOT, "compose", "archive");
  const catalogMount = (fmt: string, target: string) => `      - ../../data/catalog/${fmt}:${target}:ro\n`;

  // Martin: the berlin source plus a directory of 1,000 files (source ids are the file stems).
  for (const fmt of ["pmtiles", "mbtiles"] as const) {
    const dirCache = fmt === "pmtiles" ? "  directory_cache:\n    size_mb: 64\n" : "";
    writeFile(
      join(cfg, `martin-${fmt}`, "config.yaml"),
      `# Martin catalog run: berlin plus 1,000 small archives discovered from a directory.
listen_addresses: '0.0.0.0:3000'
worker_processes: 4
keep_alive: 75
cache:
  size_mb: 256
  tile_size_mb: 0
${fmt}:
${dirCache}  paths:
    - /catalog
  sources:
    berlin: /tiles/berlin.${fmt}
`,
    );
    for (const v of ["2", "1"]) {
      writeFile(join(cmp, `martin-${v}-${fmt}.catalog.yml`), `services:\n  engine:\n    volumes:\n      - ../../configs/catalog/archive/martin-${fmt}:/config:ro\n${catalogMount(fmt, "/catalog")}`);
    }
  }

  // go-pmtiles and mbtileserver serve one directory: the catalog dir, with berlin mounted into it.
  // (Docker cannot bind a file into a read-only directory mount, so these two read hard-linked
  // directories holding the 1,000 files plus berlin.)
  writeFile(join(cmp, "go-pmtiles.catalog.yml"), `services:\n  engine:\n    command: ["serve", "/catalog", "--port=8080", "--cache-size=64"]\n    volumes:\n${catalogMount("pmtiles-all", "/catalog")}`);
  writeFile(join(cmp, "mbtileserver.catalog.yml"), `services:\n  engine:\n    command: ["--dir", "/catalog", "--port", "8000", "--tiles-only"]\n    volumes:\n${catalogMount("mbtiles-all", "/catalog")}`);

  // tileserver-gl: one data entry per archive.
  // /tiles is replaced by the hard-linked directory (berlin plus the 1,000), since a directory cannot
  // be bound inside the base file's read-only /tiles mount.
  const data: Record<string, { mbtiles: string }> = { berlin: { mbtiles: "berlin.mbtiles" } };
  for (const name of CATALOG_NAMES) data[name] = { mbtiles: `${name}.mbtiles` };
  writeFile(
    join(cfg, "tileserver-gl", "config.json"),
    JSON.stringify({ options: { paths: { root: "/tiles", mbtiles: "/tiles", pmtiles: "/tiles", fonts: "/tiles", sprites: "/tiles", styles: "/tiles", icons: "/tiles", files: "/tiles" }, serveAllFonts: false, serveStaticMaps: false }, styles: {}, data }, null, 2),
  );
  writeFile(join(cmp, "tileserver-gl.catalog.yml"), `services:\n  engine:\n    volumes:\n      - ../../configs/catalog/archive/tileserver-gl:/config:ro\n${catalogMount("mbtiles-all", "/tiles")}`);

  // The floor control has no sources to load: the same files and config as the main run (docs/adr/0007).
  writeFile(join(cmp, "floor.catalog.yml"), `services:\n  engine:\n    labels:\n      wf.catalog: "nothing extra to load"\n`);

  // BBOX and VersaTiles: one entry per archive.
  for (const fmt of ["pmtiles", "mbtiles"] as const) {
    const sets = [`[[tileset]]\nname = "berlin"\n[tileset.${fmt}]\npath = "/tiles/berlin.${fmt}"\n`, ...CATALOG_NAMES.map((n) => `[[tileset]]\nname = "${n}"\n[tileset.${fmt}]\npath = "/catalog/${n}.${fmt}"\n`)];
    writeFile(join(cfg, `bbox-${fmt}`, "bbox.toml"), `# BBOX catalog run: berlin plus 1,000 small archives.\n[webserver]\nserver_addr = "0.0.0.0:8080"\nworker_threads = 4\nloglevel = "Warn"\n\n${sets.join("\n")}`);
    writeFile(join(cmp, `bbox-${fmt}.catalog.yml`), `services:\n  engine:\n    volumes:\n      - ../../configs/catalog/archive/bbox-${fmt}:/config:ro\n${catalogMount(fmt, "/catalog")}`);
    const vtArgs = ["serve", "--port", "8080", `[berlin]/tiles/berlin.${fmt}`, ...CATALOG_NAMES.map((n) => `[${n}]/catalog/${n}.${fmt}`)];
    writeFile(join(cmp, `versatiles-${fmt}.catalog.yml`), `services:\n  engine:\n    command: ${JSON.stringify(vtArgs)}\n    volumes:\n${catalogMount(fmt, "/catalog")}`);
  }
}

function linkIfMissing(from: string, to: string): void {
  if (!existsSync(to)) linkSync(from, to);
}

function archiveCatalogPath(c: Candidate, tile: TileCoord): string {
  const t = tile;
  switch (c.server) {
    case "martin":
      return `/${LAST}/${t.z}/${t.x}/${t.y}`;
    case "go-pmtiles":
      return `/${LAST}/${t.z}/${t.x}/${t.y}.mvt`;
    case "versatiles":
      return `/tiles/${LAST}/${t.z}/${t.x}/${t.y}`;
    case "bbox":
      return `/xyz/${LAST}/${t.z}/${t.x}/${t.y}.mvt`;
    case "mbtileserver":
      return `/services/${LAST}/tiles/${t.z}/${t.x}/${t.y}.pbf`;
    case "tileserver-gl":
      return `/data/${LAST}/${t.z}/${t.x}/${t.y}.pbf`;
    case "floor":
      return `/tiles/${LAST}/${t.z}/${t.x}/${t.y}`;
    default:
      throw new Error(`no catalog path for ${c.id}`);
  }
}

// ---- run -------------------------------------------------------------------------------------

export interface CatalogResult {
  id: string;
  imageDigest: string;
  coldStart: ColdStartResult;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const family = (flag("family") ?? "archive") as Family;
  const only = flag("candidates")?.split(",");
  const smoke = args.includes("--smoke");
  const reverse = args.includes("--reverse");
  const { warmups, reps, timeoutMs } = protocol(family, smoke).catalog;
  const outputPath = flag("output") ?? join(ROOT, `results-${family}-catalog${smoke ? "-smoke" : ""}.json`);

  mkdirSync(WORK_DIR, { recursive: true });
  ensureNetwork();
  if (family === "postgis") {
    dbUp();
    preparePostgisTables();
    writePostgisCatalogConfigs();
  } else {
    prepareArchiveFiles();
    writeArchiveCatalogConfigs();
    if (!only || only.includes("floor")) prepareFloor();
  }
  clientUp(family === "archive" ? 6 : 2);

  const existing = args.includes("--resume") ? ((await Bun.file(outputPath).json().catch(() => undefined)) as { results: CatalogResult[]; failures?: { id: string; error: string }[] } | undefined) : undefined;
  const results: CatalogResult[] = existing?.results ?? [];
  // A resumed run keeps earlier failures, except for the candidates it measures again.
  const failures: { id: string; error: string }[] = (existing?.failures ?? []).filter((f) => !only || !only.includes(f.id));
  const marquee = TILES[family][0]!;
  const followTile = family === "postgis" ? marquee.tile : SMALL_TILE;
  const inFamily = CANDIDATES.filter((x) => x.family === family && (!only || only.includes(x.id)));
  for (const c of reverse ? [...inFamily].reverse() : inFamily) {
    if (results.some((r) => r.id === c.id)) continue;
    console.log(`\n> ${c.id} with ${CATALOG_SIZE} extra sources`);
    stopAllEngines();
    try {
      const follow = `http://engine:${c.port}${family === "postgis" ? postgisCatalogPath(c, followTile) : archiveCatalogPath(c, followTile)}`;
      const cs = await coldStart(c, tileUrl(c, marquee.layer, marquee.tile), { ...REQUEST_HEADERS[family] }, reps, timeoutMs, { variant: "catalog", then: [follow], warmups });
      results.push({ id: c.id, imageDigest: await imageDigest(c.image), coldStart: cs });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  FAILED ${c.id}: ${message}`);
      failures.push({ id: c.id, error: message });
    } finally {
      engineDown(c, "catalog");
      await Bun.write(outputPath, JSON.stringify({ family, generatedAt: new Date().toISOString(), smoke, order: reverse ? "reverse" : "forward", catalogSize: CATALOG_SIZE, followTile, results, failures }, null, 2) + "\n");
    }
  }
  console.log(`\nDone: ${results.length} measured, ${failures.length} failed.`);
}
