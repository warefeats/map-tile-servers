import { describe, expect, test } from "bun:test";
import { dockerRun, LANE_SERVERS, openFreeMapNginx, tileUrl, units } from "../src/lane/servers";

const server = (id: string) => LANE_SERVERS.find((s) => s.id === id)!;
const tile = { z: 14, x: 8802, y: 5371 };

describe("the lane's servers", () => {
  test("address a tile the way each server does", () => {
    expect(tileUrl(server("martin-2"), "10.0.0.5", "planet", tile)).toBe("http://10.0.0.5:3000/planet/14/8802/5371");
    expect(tileUrl(server("go-pmtiles"), "h", "planet", tile)).toBe("http://h:8080/planet/14/8802/5371.mvt");
    expect(tileUrl(server("mbtileserver"), "h", "berlin", tile)).toBe("http://h:8000/services/berlin/tiles/14/8802/5371.pbf");
  });

  test("a pass measures every server on every format it serves, per dataset and architecture", () => {
    const u = units(["berlin", "planet"], ["arm64", "amd64"]);
    // Martin 2 and 1, VersaTiles, tileserver-gl-light and BBOX serve two formats; go-pmtiles, mbtileserver and nginx one
    expect(u.length).toBe((5 * 2 + 3) * 2 * 2);
    expect(new Set(u.filter((x) => x.server.id === "martin-2").map((x) => x.format))).toEqual(new Set(["pmtiles", "mbtiles"]));
  });

  test("start on host networking with the archive read-only, configs where the image expects them", () => {
    expect(dockerRun(server("martin-1"), "arm64", ["planet"], "pmtiles")).toEqual(["docker", "run", "-d", "--name", "lane-server", "--network", "host", "-v", "/opt/lane/data:/data:ro", "ghcr.io/maplibre/martin:1.16.1", "/data/planet.pmtiles"]);
    expect(dockerRun(server("nginx"), "amd64", ["berlin"], "files")).toContain("/opt/lane/data/nginx.conf:/etc/nginx/nginx.conf:ro");
  });

  test("BBOX on Graviton needs the image built from its release binary", () => {
    expect(() => dockerRun(server("bbox"), "arm64", ["planet"], "pmtiles")).toThrow(/arm64/);
    expect(dockerRun(server("bbox"), "arm64", ["planet"], "pmtiles", "wf-bbox-release:0.6.2")).toContain("wf-bbox-release:0.6.2");
  });

  test("configs name the tileset and its file", () => {
    expect(JSON.parse(server("tileserver-gl").config!(["planet"], "pmtiles")["config.json"]!).data).toEqual({ planet: { pmtiles: "planet.pmtiles" } });
    expect(server("bbox").config!(["berlin"], "mbtiles")["bbox.toml"]).toContain('[tileset.mbtiles]\npath = "/data/berlin.mbtiles"');
  });

  test("VersaTiles runs as its production image: nginx's cache in front, plain HTTP, archives in a writable /data/tiles", () => {
    const run = dockerRun(server("versatiles"), "arm64", ["planet"], "pmtiles");
    expect(run).toContain("versatiles/versatiles-nginx:v5.4.1");
    expect(run).toContain("/opt/lane/data:/data");
    expect(run).not.toContain("/opt/lane/data:/data:ro");
    for (const e of ["HTTP_ONLY=1", "FRONTEND=none", "TILE_SOURCES=planet.pmtiles", "DOMAIN=localhost"]) expect(run).toContain(e);
    expect(server("versatiles").port).toBe(80);
    // the 60%-of-RAM cache its startup script sizes, not Docker's 64 MB /dev/shm
    expect(run.join(" ")).toContain("--shm-size 5g");
    expect(dockerRun(server("martin-2"), "arm64", ["planet"], "pmtiles")).not.toContain("--shm-size");
    expect(server("bbox").emptyStatus).toBe(500);
    expect(server("martin-2").emptyStatus).toBeUndefined();
  });

  test("nginx serves tile files with OpenFreeMap's production settings", () => {
    const conf = openFreeMapNginx(["planet"]);
    for (const line of ["worker_connections 40000;", "open_file_cache max=200000 inactive=60m;", "location ^~ /planet/ {", "alias /data/planet/tiles/;", "try_files $uri @empty_tile;", "add_header Content-Encoding gzip;", "return 200 '';", "access_log /var/log/nginx/access.jsonl access_json buffer=128k;"]) {
      expect(conf).toContain(line);
    }
    expect(server("nginx").path("planet", { z: 14, x: 8802, y: 5373 })).toBe("/planet/14/8802/5373.pbf");
  });

  test("a catalog is every archive in one start: arguments or config entries, one per tileset", () => {
    const ts = ["berlin", "t0000", "t0001"];
    expect(server("martin-2").args(ts, "pmtiles")).toEqual(["/data/berlin.pmtiles", "/data/t0000.pmtiles", "/data/t0001.pmtiles"]);
    expect(server("versatiles").env!(ts, "mbtiles").TILE_SOURCES).toBe("berlin.mbtiles,t0000.mbtiles,t0001.mbtiles");
    expect(Object.keys(JSON.parse(server("tileserver-gl").config!(ts, "mbtiles")["config.json"]!).data)).toEqual(ts);
    expect(server("bbox").config!(ts, "pmtiles")["bbox.toml"]!.match(/\[\[tileset\]\]/g)).toHaveLength(3);
    expect(dockerRun(server("go-pmtiles"), "arm64", ts, "pmtiles", undefined, "/opt/lane/catalog")).toContain("/opt/lane/catalog:/data:ro");
  });
});
