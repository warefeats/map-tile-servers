import { describe, expect, test } from "bun:test";
import { CATALOG_NAMES, catalogScript, collectScript, type ServerUnit, SMALL_TILE, setupScript, startScript } from "../src/lane/server-script";
import { LANE_SERVERS } from "../src/lane/servers";
import { writeFile } from "../src/lane/shell";

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
    expect(s).toContain("while sleep 2; do");
    expect(s).toContain('$1 == "usage_usec"');
    expect(s).not.toContain("docker inspect");
    expect(s).toContain("nohup setsid bash /opt/lane/sampler.sh");
    // the server starts once and goes again, so no measured start carries the instance's first container start
    expect(s.indexOf("docker pull")).toBeLessThan(s.indexOf("'docker' 'run'"));
    expect(s.indexOf("warm-up start")).toBeLessThan(s.lastIndexOf("docker rm -f lane-server"));
    expect(s.lastIndexOf("docker rm -f lane-server")).toBeLessThan(s.indexOf("setup done"));
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

  test("setup mounts a tile-file image read-only where nginx reads it, as OpenFreeMap does", () => {
    const s = setupScript({ ...unit, dataKey: "inputs/openfreemap-planet-20261025_080012_pt.btrfs", server: server("nginx"), format: "files" });
    expect(s).toContain("aws s3 cp 's3://b/inputs/openfreemap-planet-20261025_080012_pt.btrfs' '/opt/lane/data/planet.btrfs'");
    expect(s).toContain("mount -o loop,ro '/opt/lane/data/planet.btrfs' '/opt/lane/data/planet'");
    expect(s).toContain("'/opt/lane/data/planet/metadata.json'");
    expect(s.indexOf("mount -o loop,ro")).toBeLessThan(s.indexOf("docker pull"));
    expect(setupScript({ ...unit, server: server("martin-2"), format: "pmtiles" })).not.toContain("mount -o loop");
  });

  test("the catalog starts the server with the dataset and 1,000 copies of the small archive, timing two tiles", () => {
    const u: ServerUnit = { ...unit, tileset: "berlin", dataKey: "inputs/x-berlin.pmtiles", server: server("martin-2"), format: "pmtiles" };
    const s = catalogScript(u, "bundles/lane-7/catalog/small.pmtiles");
    expect(CATALOG_NAMES).toHaveLength(1000);
    expect(SMALL_TILE).toEqual({ z: 8, x: 137, y: 83 });
    expect(s).toContain("ln '/opt/lane/data/berlin.pmtiles' '/opt/lane/catalog/berlin.pmtiles'");
    expect(s).toContain("for i in $(seq 0 999); do cp '/opt/lane/small.pmtiles'");
    expect(s).toContain("'-v' '/opt/lane/catalog:/data:ro'");
    expect(s).toContain("'/data/t0999.pmtiles'");
    expect(s).toContain("until200 'http://127.0.0.1:3000/berlin/14/8802/5372'");
    expect(s).toContain("until200 'http://127.0.0.1:3000/t0999/8/137/83'");
    expect(s.indexOf("drop_caches")).toBeLessThan(s.indexOf("'docker' 'run'"));
  });

  test("writes config files verbatim, and refuses content holding the heredoc's delimiter", () => {
    expect(writeFile("/x", "a $b 'c'\n")).toEqual(["cat > '/x' <<'WF_FILE'", "a $b 'c'", "WF_FILE"]);
    expect(() => writeFile("/x", "WF_FILE\n")).toThrow(/delimiter/);
  });

  test("renders scripts bash accepts for every server and format", () => {
    for (const sv of LANE_SERVERS) {
      for (const format of sv.formats) {
        const u: ServerUnit = { ...unit, arch: "amd64", server: sv, format };
        const catalog = sv.formats.includes("files") ? [] : [catalogScript({ ...u, tileset: "berlin" }, "bundles/lane-7/catalog/small.pmtiles")];
        for (const s of [setupScript(u), startScript(u, "cdn"), collectScript(u, "s3://b/p/"), ...catalog]) {
          const p = Bun.spawnSync(["bash", "-n"], { stdin: new TextEncoder().encode(s) });
          expect(p.exitCode).toBe(0);
        }
      }
    }
  });
});
