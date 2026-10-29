import { describe, expect, test } from "bun:test";
import { collectScript, type ServerUnit, setupScript, startScript } from "../src/lane/server-script";
import { LANE_SERVERS } from "../src/lane/servers";

const server = (id: string) => LANE_SERVERS.find((s) => s.id === id)!;
const unit = { arch: "arm64" as const, tileset: "planet", bucket: "b", dataKey: "inputs/openfreemap-planet-20261025_080012_pt.pmtiles", firstTile: { z: 14, x: 8802, y: 5372 } };

describe("the server scripts", () => {
  test("setup fetches the archive, raises the open-file limit, pulls the image and starts the sampler", () => {
    const s = setupScript({ ...unit, server: server("martin-2"), format: "pmtiles" });
    expect(s).toContain("aws s3 cp 's3://b/inputs/openfreemap-planet-20261025_080012_pt.pmtiles' '/opt/lane/data/planet.pmtiles'");
    expect(s).toContain('"Soft": 1048576');
    expect(s.indexOf("systemctl restart docker")).toBeLessThan(s.indexOf("docker pull"));
    expect(s).toContain("docker pull -q 'ghcr.io/maplibre/martin:2.0.0-beta.4'");
    expect(s).toContain("allowance_exceeded");
    expect(s).toContain("nohup setsid bash /opt/lane/sampler.sh");
  });

  test("setup writes the server's config files, quoting their content", () => {
    const s = setupScript({ ...unit, server: server("bbox"), format: "mbtiles", arch: "amd64" });
    expect(s).toContain("> '/opt/lane/data/bbox.toml'");
    expect(s).toContain('path = "/data/planet.mbtiles"');
  });

  test("setup loads the image built from a release binary where the project publishes none", () => {
    const s = setupScript({ ...unit, server: server("bbox"), format: "pmtiles", localImage: { tag: "wf-bbox-release:0.6.2", key: "inputs/x-bbox.tar.zst" } });
    expect(s).toContain("docker load");
    expect(s).not.toContain("docker pull");
  });

  test("start drops the page cache, starts the server and times its first tile", () => {
    const s = startScript({ ...unit, server: server("martin-2"), format: "pmtiles" }, "alone");
    expect(s).toContain("echo 3 > /proc/sys/vm/drop_caches");
    expect(s).toContain("'http://127.0.0.1:3000/planet/14/8802/5372'");
    expect(s.indexOf("drop_caches")).toBeLessThan(s.indexOf("'docker' 'run'"));
    expect(s.indexOf("docker rm -f lane-server")).toBeLessThan(s.indexOf("drop_caches"));
  });

  test("collect puts the samples and the server's log under the unit's prefix", () => {
    const s = collectScript({ ...unit, server: server("go-pmtiles"), format: "pmtiles" }, "s3://b/results/lane/1/p1/u/");
    expect(s).toContain("'s3://b/results/lane/1/p1/u/samples.log'");
    expect(s).toContain("'s3://b/results/lane/1/p1/u/server.log'");
  });

  test("renders scripts bash accepts for every server and format", () => {
    for (const sv of LANE_SERVERS) {
      for (const format of sv.formats) {
        const u: ServerUnit = { ...unit, arch: "amd64", server: sv, format };
        for (const s of [setupScript(u), startScript(u, "cdn"), collectScript(u, "s3://b/p/")]) {
          const p = Bun.spawnSync(["bash", "-n"], { stdin: new TextEncoder().encode(s) });
          expect(p.exitCode).toBe(0);
        }
      }
    }
  });
});
