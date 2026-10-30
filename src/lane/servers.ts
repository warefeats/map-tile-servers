/**
 * The archive lane's servers (docs/adr/0011): each as the image or binary its project tells users to install,
 * at its latest release, started the way its docs show for production. For most that is their defaults:
 * Martin's 256 MB tile cache and 128 MB PMTiles directory cache (1.16.1 and 2.0 alike), go-pmtiles' 64 MB
 * directory cache, each server's own request logging. Every server runs alone on its instance with host
 * networking, so no Docker port forwarding sits in the path.
 */
import type { TileCoord } from "../tiles";

export type Arch = "arm64" | "amd64";
export type Format = "pmtiles" | "mbtiles" | "files";
export type Dataset = "berlin" | "planet";

export interface LaneServer {
  id: string;
  name: string;
  version: string;
  /** The release operators run today; false for a pre-release, which the page labels. */
  stable: boolean;
  /** No commit in the last six months (2026-10-29 survey). */
  unmaintained?: boolean;
  formats: readonly Format[];
  /** The official image per architecture; null where the project publishes none for it. */
  image: Record<Arch, string | null>;
  /** Where it publishes none: the tag of the image lane.yml builds around the project's release binary. */
  release?: Partial<Record<Arch, string>>;
  port: number;
  path: (tileset: string, t: TileCoord) => string;
  /** Arguments after the image, for archives mounted at /data/<tileset>.<format>: one, or a catalog of them. */
  args: (tilesets: readonly string[], format: Format) => string[];
  /** Config files the server reads, written into /data beside the archives: name → content. */
  config?: (tilesets: readonly string[], format: Format) => Record<string, string>;
  /** Where the image expects a file from /data, when it is not /data itself: name → path in the container. */
  mounts?: Record<string, string>;
  /** The container's environment. */
  env?: (tilesets: readonly string[], format: Format) => Record<string, string>;
  /** Archives in /data/tiles/ of a /data the image may write to, rather than beside the config in a read-only /data. */
  layout?: "tiles-dir";
  /** The status the server answers a tile its archive lacks with, where it is not 204 or 404: counted as that empty tile. */
  emptyStatus?: number;
  /** A cache in front of the server answers repeats, so a start probe asks for a fresh URL every time. */
  cachedFront?: boolean;
  /** Archives the server cannot open, with why: the units are skipped and the reason reported. */
  unsupported?: Partial<Record<Dataset, Partial<Record<Format, string>>>>;
}

const xyz = (t: TileCoord) => `${t.z}/${t.x}/${t.y}`;

export const LANE_SERVERS: readonly LaneServer[] = [
  { id: "martin-2", name: "Martin", version: "2.0.0-beta.4", stable: false, formats: ["pmtiles", "mbtiles"], image: { arm64: "ghcr.io/maplibre/martin:2.0.0-beta.4", amd64: "ghcr.io/maplibre/martin:2.0.0-beta.4" }, port: 3000, path: (s, t) => `/${s}/${xyz(t)}`, args: (ts, f) => ts.map((t) => `/data/${t}.${f}`) },
  { id: "martin-1", name: "Martin", version: "1.16.1", stable: true, formats: ["pmtiles", "mbtiles"], image: { arm64: "ghcr.io/maplibre/martin:1.16.1", amd64: "ghcr.io/maplibre/martin:1.16.1" }, port: 3000, path: (s, t) => `/${s}/${xyz(t)}`, args: (ts, f) => ts.map((t) => `/data/${t}.${f}`) },
  { id: "go-pmtiles", name: "go-pmtiles", version: "1.31.2", stable: true, formats: ["pmtiles"], image: { arm64: "protomaps/go-pmtiles:v1.31.2", amd64: "protomaps/go-pmtiles:v1.31.2" }, port: 8080, path: (s, t) => `/${s}/${xyz(t)}.mvt`, args: () => ["serve", "/data", "--port=8080"] },
  // VersaTiles' deploy guides run it as its versatiles-nginx image: `versatiles serve` behind an in-memory nginx tile
  // cache in one container. Bare `serve` re-encodes every tile to Brotli for a browser and held no rate within the
  // target in the coverage smoke. HTTP_ONLY serves plain HTTP on port 80, as its README says for a private network.
  {
    id: "versatiles", name: "VersaTiles", version: "5.4.1", stable: true, formats: ["pmtiles", "mbtiles"], image: { arm64: "versatiles/versatiles-nginx:v5.4.1", amd64: "versatiles/versatiles-nginx:v5.4.1" }, port: 80, path: (s, t) => `/tiles/${s}/${xyz(t)}`, args: () => [],
    layout: "tiles-dir",
    // its nginx keeps every response five minutes, errors included (proxy_cache_valid any 5m)
    cachedFront: true,
    env: (ts, f) => ({ DOMAIN: "localhost", HTTP_ONLY: "1", FRONTEND: "none", TILE_SOURCES: ts.map((t) => `${t}.${f}`).join(",") }),
  },
  {
    id: "tileserver-gl", name: "tileserver-gl-light", version: "5.7.0", stable: true, formats: ["pmtiles", "mbtiles"], image: { arm64: "maptiler/tileserver-gl-light:v5.7.0", amd64: "maptiler/tileserver-gl-light:v5.7.0" }, port: 8080, path: (s, t) => `/data/${s}/${xyz(t)}.pbf`, args: () => ["--config", "/data/config.json"],
    config: (ts, f) => ({ "config.json": JSON.stringify({ options: { paths: { root: "/data", mbtiles: "/data", pmtiles: "/data" } }, styles: {}, data: Object.fromEntries(ts.map((t) => [t, { [f]: `${t}.${f}` }])) }, null, 2) }),
  },
  { id: "mbtileserver", name: "mbtileserver", version: "0.11.0", stable: true, unmaintained: true, formats: ["mbtiles"], image: { arm64: "ghcr.io/consbio/mbtileserver:0.11.0", amd64: "ghcr.io/consbio/mbtileserver:0.11.0" }, port: 8000, path: (s, t) => `/services/${s}/tiles/${xyz(t)}.pbf`, args: () => ["--dir", "/data", "--port", "8000"] },
  // The project publishes an amd64 image only; on Graviton the lane wraps its official aarch64 release binary.
  {
    id: "bbox", name: "BBOX", version: "0.6.2", stable: true, unmaintained: true, formats: ["pmtiles", "mbtiles"], image: { arm64: null, amd64: "sourcepole/bbox-tile-server:v0.6.2" }, release: { arm64: "wf-bbox-release:0.6.2" }, port: 8080, path: (s, t) => `/xyz/${s}/${xyz(t)}.mvt`, args: () => ["bbox-tile-server", "-c", "/data/bbox.toml", "serve"],
    // a tile the archive lacks gets 500 where the others answer 204; the report shows that share beside theirs
    emptyStatus: 500,
    // its mbtiles reader predates Planetiler's deduplicated schema, which OpenFreeMap's planet uses (smoke 40990904006)
    unsupported: { planet: { mbtiles: "BBOX 0.6.2 cannot open Planetiler's deduplicated MBTiles schema (tiles_shallow and tiles_data under a tiles view): \"Invalid data format for MBTile file\"" } },
    // its documented defaults: worker threads one per core, loglevel Info, no tile cache
    config: (ts, f) => ({ "bbox.toml": `[webserver]\nserver_addr = "0.0.0.0:8080"\n\n${ts.map((t) => `[[tileset]]\nname = "${t}"\n[tileset.${f}]\npath = "/data/${t}.${f}"\n`).join("\n")}` }),
  },
  // OpenFreeMap's way (github.com/hyperknot/openfreemap at 332669ab): the tiles as files in a read-only Btrfs image,
  // gzip-encoded as stored, served by nginx with OpenFreeMap's production settings; a tile with no file is an empty 200
  {
    id: "nginx", name: "nginx (OpenFreeMap's files)", version: "1.30.4", stable: true, formats: ["files"], image: { arm64: "nginx:1.30.4", amd64: "nginx:1.30.4" }, port: 8080, path: (s, t) => `/${s}/${xyz(t)}.pbf`, args: () => [],
    config: (ts) => ({ "nginx.conf": openFreeMapNginx(ts) }),
    mounts: { "nginx.conf": "/etc/nginx/nginx.conf" },
  },
];

// what OpenFreeMap adds to every tile and empty tile; Strict-Transport-Security is left out with TLS
const OFM_HEADERS = `add_header 'Access-Control-Allow-Origin' '*' always;
      add_header Cache-Control public;
      add_header X-Robots-Tag "noindex, nofollow" always;`;

/**
 * OpenFreeMap's production nginx (shared_lib/assets/nginx/nginx.conf, and the tile locations
 * linux_host/linux_host_lib/nginx_config_gen.py and nginx_templates/static_blocks.conf write), with each tileset's
 * Btrfs image mounted at /data/<tileset>; what serves TLS, ACME, styles, fonts and sprites is left out. The lane
 * is plain HTTP throughout (docs/adr/0011).
 */
export function openFreeMapNginx(tilesets: readonly string[]): string {
  const locations = tilesets.map(
    (t) => `
    location ^~ /${t}/ {
      alias /data/${t}/tiles/;
      try_files $uri @empty_tile;
      add_header Content-Encoding gzip;
      expires 10y;
      types { application/vnd.mapbox-vector-tile pbf; }
      ${OFM_HEADERS}
    }
`,
  );
  return `user nginx;
pid /var/run/nginx.pid;
worker_processes auto;
worker_rlimit_nofile 300000;
error_log /dev/stderr warn;
events {
  worker_connections 40000;
  multi_accept off;
}
http {
  open_file_cache max=200000 inactive=60m;
  open_file_cache_valid 60m;
  open_file_cache_min_uses 1;
  open_file_cache_errors on;
  server_tokens off;
  include /etc/nginx/mime.types;
  types { application/x-protobuf pbf; }
  default_type application/octet-stream;
  charset utf-8;
  sendfile on;
  tcp_nopush on;
  tcp_nodelay on;
  reset_timedout_connection on;
  send_timeout 20;
  max_ranges 0;
  gzip on;
  gzip_comp_level 1;
  gzip_types application/json application/x-protobuf;
  log_format access_json '{"time": "$time_iso8601", "status": $status, "body_bytes_sent": $body_bytes_sent, "http_referrer": "$http_referer", "http_user_agent": "$http_user_agent", "_": "_"}';
  access_log off;
  server {
    listen 8080;
    access_log /var/log/nginx/access.jsonl access_json buffer=128k;
${locations.join("")}
    location @empty_tile {
      return 200 '';
      expires 10y;
      types { application/vnd.mapbox-vector-tile pbf; }
      ${OFM_HEADERS}
    }
  }
}
`;
}

/** The server's tile URL for a tile of a dataset, on a host. */
export function tileUrl(server: LaneServer, host: string, tileset: string, t: TileCoord): string {
  return `http://${host}:${server.port}${server.path(tileset, t)}`;
}

/** Every measurement a pass makes: each server on each format it serves, on each architecture with an image. */
export function units(datasets: readonly Dataset[], archs: readonly Arch[]): { server: LaneServer; format: Format; dataset: Dataset; arch: Arch }[] {
  return LANE_SERVERS.flatMap((server) => server.formats.flatMap((format) => datasets.flatMap((dataset) => archs.map((arch) => ({ server, format, dataset, arch })))));
}

/** Where a server's archives go under a data directory on the instance. */
export const archiveDir = (server: LaneServer, dir: string) => (server.layout === "tiles-dir" ? `${dir}/tiles` : dir);

/** The `docker run` that starts a server on its instance, with the archives and config files of `dir` at /data. */
export function dockerRun(server: LaneServer, arch: Arch, tilesets: readonly string[], format: Format, localImage?: string, dir = "/opt/lane/data"): string[] {
  const image = server.image[arch] ?? localImage;
  if (!image) throw new Error(`${server.id} publishes no ${arch} image and none was built from its release binary`);
  const mounts = Object.entries(server.mounts ?? {}).flatMap(([name, at]) => ["-v", `${dir}/${name}:${at}:ro`]);
  const env = Object.entries(server.env?.(tilesets, format) ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  const data = server.layout === "tiles-dir" ? `${dir}:/data` : `${dir}:/data:ro`;
  return ["docker", "run", "-d", "--name", "lane-server", "--network", "host", "-v", data, ...mounts, ...env, image, ...server.args(tilesets, format)];
}
