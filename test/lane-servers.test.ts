import { describe, expect, test } from "bun:test";
import { dockerRun, LANE_SERVERS, tileUrl, units } from "../src/lane/servers";

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
    expect(dockerRun(server("martin-1"), "arm64", "planet", "pmtiles")).toEqual(["docker", "run", "-d", "--name", "lane-server", "--network", "host", "-v", "/opt/lane/data:/data:ro", "ghcr.io/maplibre/martin:1.16.1", "/data/planet.pmtiles"]);
    expect(dockerRun(server("nginx"), "amd64", "berlin", "files")).toContain("/opt/lane/data/nginx.conf:/etc/nginx/nginx.conf:ro");
  });

  test("BBOX on Graviton needs the image built from its release binary", () => {
    expect(() => dockerRun(server("bbox"), "arm64", "planet", "pmtiles")).toThrow(/arm64/);
    expect(dockerRun(server("bbox"), "arm64", "planet", "pmtiles", "wf-bbox-release:0.6.2")).toContain("wf-bbox-release:0.6.2");
  });

  test("configs name the tileset and its file", () => {
    expect(JSON.parse(server("tileserver-gl").config!("planet", "pmtiles")["config.json"]!).data).toEqual({ planet: { pmtiles: "planet.pmtiles" } });
    expect(server("bbox").config!("berlin", "mbtiles")["bbox.toml"]).toContain('[tileset.mbtiles]\npath = "/data/berlin.mbtiles"');
  });
});
