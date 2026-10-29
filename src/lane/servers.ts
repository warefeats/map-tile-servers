/**
 * The archive lane's servers (docs/adr/0011): each as the image or binary its project tells users to install,
 * at its latest release, started the way its docs show for production. For most that is their defaults:
 * Martin's 512 MB cache, go-pmtiles' 64 MB directory cache, each server's own request logging. Every server
 * runs alone on its instance with host networking, so no Docker port forwarding sits in the path.
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
  /** Arguments after the image, for one archive mounted at /data/<tileset>.<format>. */
  args: (tileset: string, format: Format) => string[];
  /** Config files the server reads, written into /data beside the archive: name → content. */
  config?: (tileset: string, format: Format) => Record<string, string>;
  /** Where the image expects a file from /data, when it is not /data itself: name → path in the container. */
  mounts?: Record<string, string>;
}

const xyz = (t: TileCoord) => `${t.z}/${t.x}/${t.y}`;

export const LANE_SERVERS: readonly LaneServer[] = [
  { id: "martin-2", name: "Martin", version: "2.0.0-beta.4", stable: false, formats: ["pmtiles", "mbtiles"], image: { arm64: "ghcr.io/maplibre/martin:2.0.0-beta.4", amd64: "ghcr.io/maplibre/martin:2.0.0-beta.4" }, port: 3000, path: (s, t) => `/${s}/${xyz(t)}`, args: (s, f) => [`/data/${s}.${f}`] },
  { id: "martin-1", name: "Martin", version: "1.16.1", stable: true, formats: ["pmtiles", "mbtiles"], image: { arm64: "ghcr.io/maplibre/martin:1.16.1", amd64: "ghcr.io/maplibre/martin:1.16.1" }, port: 3000, path: (s, t) => `/${s}/${xyz(t)}`, args: (s, f) => [`/data/${s}.${f}`] },
  { id: "go-pmtiles", name: "go-pmtiles", version: "1.31.2", stable: true, formats: ["pmtiles"], image: { arm64: "protomaps/go-pmtiles:v1.31.2", amd64: "protomaps/go-pmtiles:v1.31.2" }, port: 8080, path: (s, t) => `/${s}/${xyz(t)}.mvt`, args: () => ["serve", "/data", "--port=8080"] },
  { id: "versatiles", name: "VersaTiles", version: "5.4.1", stable: true, formats: ["pmtiles", "mbtiles"], image: { arm64: "versatiles/versatiles:v5.4.1", amd64: "versatiles/versatiles:v5.4.1" }, port: 8080, path: (s, t) => `/tiles/${s}/${xyz(t)}`, args: (s, f) => ["serve", "--port", "8080", `[${s}]/data/${s}.${f}`] },
  {
    id: "tileserver-gl", name: "tileserver-gl-light", version: "5.7.0", stable: true, formats: ["pmtiles", "mbtiles"], image: { arm64: "maptiler/tileserver-gl-light:v5.7.0", amd64: "maptiler/tileserver-gl-light:v5.7.0" }, port: 8080, path: (s, t) => `/data/${s}/${xyz(t)}.pbf`, args: () => ["--config", "/data/config.json"],
    config: (s, f) => ({ "config.json": JSON.stringify({ options: { paths: { root: "/data", mbtiles: "/data", pmtiles: "/data" } }, styles: {}, data: { [s]: { [f]: `${s}.${f}` } } }, null, 2) }),
  },
  { id: "mbtileserver", name: "mbtileserver", version: "0.11.0", stable: true, unmaintained: true, formats: ["mbtiles"], image: { arm64: "ghcr.io/consbio/mbtileserver:0.11.0", amd64: "ghcr.io/consbio/mbtileserver:0.11.0" }, port: 8000, path: (s, t) => `/services/${s}/tiles/${xyz(t)}.pbf`, args: () => ["--dir", "/data", "--port", "8000"] },
  // The project publishes an amd64 image only; on Graviton the lane wraps its official aarch64 release binary.
  {
    id: "bbox", name: "BBOX", version: "0.6.2", stable: true, unmaintained: true, formats: ["pmtiles", "mbtiles"], image: { arm64: null, amd64: "sourcepole/bbox-tile-server:v0.6.2" }, release: { arm64: "wf-bbox-release:0.6.2" }, port: 8080, path: (s, t) => `/xyz/${s}/${xyz(t)}.mvt`, args: () => ["bbox-tile-server", "-c", "/data/bbox.toml", "serve"],
    // its documented defaults: worker threads one per core, loglevel Info, no tile cache
    config: (s, f) => ({ "bbox.toml": `[webserver]\nserver_addr = "0.0.0.0:8080"\n\n[[tileset]]\nname = "${s}"\n[tileset.${f}]\npath = "/data/${s}.${f}"\n` }),
  },
  {
    id: "nginx", name: "nginx (tile files)", version: "1.30.4", stable: true, formats: ["files"], image: { arm64: "nginx:1.30.4", amd64: "nginx:1.30.4" }, port: 8080, path: (s, t) => `/tiles/${s}/${xyz(t)}`, args: () => [],
    // the archive's stored tiles as files under /data/tiles/<tileset>/z/x/y, gzip-encoded as stored; a tile with no file is empty
    config: () => ({ "nginx.conf": "worker_processes auto;\nevents { worker_connections 4096; }\nhttp {\n  open_file_cache max=100000 inactive=600s;\n  tcp_nodelay on;\n  server {\n    listen 8080;\n    location /tiles/ {\n      root /data;\n      default_type application/vnd.mapbox-vector-tile;\n      add_header Content-Encoding gzip;\n      try_files $uri =204;\n    }\n  }\n}\n" }),
    mounts: { "nginx.conf": "/etc/nginx/nginx.conf" },
  },
];

/** The server's tile URL for a tile of a dataset, on a host. */
export function tileUrl(server: LaneServer, host: string, tileset: string, t: TileCoord): string {
  return `http://${host}:${server.port}${server.path(tileset, t)}`;
}

/** Every measurement a pass makes: each server on each format it serves, on each architecture with an image. */
export function units(datasets: readonly Dataset[], archs: readonly Arch[]): { server: LaneServer; format: Format; dataset: Dataset; arch: Arch }[] {
  return LANE_SERVERS.flatMap((server) => server.formats.flatMap((format) => datasets.flatMap((dataset) => archs.map((arch) => ({ server, format, dataset, arch })))));
}

/** The `docker run` that starts a server on its instance, the archive at /opt/lane/data. */
export function dockerRun(server: LaneServer, arch: Arch, tileset: string, format: Format, localImage?: string): string[] {
  const image = server.image[arch] ?? localImage;
  if (!image) throw new Error(`${server.id} publishes no ${arch} image and none was built from its release binary`);
  const mounts = Object.entries(server.mounts ?? {}).flatMap(([name, at]) => ["-v", `/opt/lane/data/${name}:${at}:ro`]);
  return ["docker", "run", "-d", "--name", "lane-server", "--network", "host", "-v", "/opt/lane/data:/data:ro", ...mounts, image, ...server.args(tileset, format)];
}
