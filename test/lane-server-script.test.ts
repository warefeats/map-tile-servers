import { describe, expect, test } from "bun:test";
import { serverScript } from "../src/lane/server-script";
import { LANE_SERVERS } from "../src/lane/servers";

const server = (id: string) => LANE_SERVERS.find((s) => s.id === id)!;
const unit = { arch: "arm64" as const, tileset: "planet", bucket: "b", dataKey: "inputs/openfreemap-planet-20261025_080012_pt.pmtiles", firstTile: { z: 14, x: 8802, y: 5371 } };

describe("serverScript", () => {
  test("fetches the archive, pulls the image, starts cold and times the first tile", () => {
    const s = serverScript({ ...unit, server: server("martin-2"), format: "pmtiles" });
    expect(s).toContain("aws s3 cp 's3://b/inputs/openfreemap-planet-20261025_080012_pt.pmtiles' '/opt/lane/data/planet.pmtiles'");
    expect(s).toContain("docker pull -q 'ghcr.io/maplibre/martin:2.0.0-beta.4'");
    expect(s).toContain("echo 3 > /proc/sys/vm/drop_caches");
    expect(s).toContain("'http://127.0.0.1:3000/planet/14/8802/5371'");
    expect(s.indexOf("drop_caches")).toBeLessThan(s.indexOf("docker' 'run'"));
  });

  test("writes the server's config files, quoting their content", () => {
    const s = serverScript({ ...unit, server: server("bbox"), format: "mbtiles", arch: "amd64" });
    expect(s).toContain("> '/opt/lane/data/bbox.toml'");
    expect(s).toContain('path = "/data/planet.mbtiles"');
  });

  test("loads the image built from a release binary where the project publishes none", () => {
    const s = serverScript({ ...unit, server: server("bbox"), format: "pmtiles", localImage: { tag: "wf-bbox-release:0.6.2", key: "inputs/x-bbox.tar.zst" } });
    expect(s).toContain("docker load");
    expect(s).toContain("'wf-bbox-release:0.6.2'");
  });

  test("renders a script bash accepts for every server and format", async () => {
    for (const sv of LANE_SERVERS) {
      for (const format of sv.formats) {
        const s = serverScript({ ...unit, arch: "amd64", server: sv, format });
        const p = Bun.spawnSync(["bash", "-n"], { stdin: new TextEncoder().encode(s) });
        expect(p.exitCode).toBe(0);
      }
    }
  });
});
