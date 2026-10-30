import { describe, expect, test } from "bun:test";
import { CapacityError, type Cloud, type CommandResult, type Host, type LaunchRequest, type RunOptions } from "../src/lane/cloud";
import { dataKey, FIRST_TILE, parseInputs, planUnits, type RunContext, runUnit, serverUnitOf } from "../src/lane/orchestrate";
import { setupScript, startScript } from "../src/lane/server-script";

/** Records what the orchestrator asks for, and answers the way the scripts would. */
class FakeCloud implements Cloud {
  calls: string[] = [];
  texts = new Map<string, string>();
  private hosts = 0;

  constructor(
    private readonly opts: {
      /** false: no capacity for this launch */
      capacity?: (role: string, subnet: string) => boolean;
      failScript?: string;
    } = {},
  ) {}

  async createPlacementGroup(name: string) {
    this.calls.push(`placement ${name}`);
  }

  async launch(r: LaunchRequest): Promise<Host> {
    for (const subnet of r.subnets) {
      if (this.opts.capacity?.(r.tags.Role!, subnet) === false) continue;
      const h = { id: `i-${++this.hosts}`, ip: `10.0.0.${this.hosts}`, az: `zone-${subnet}`, subnet };
      this.calls.push(`launch ${r.tags.Role} ${h.id} ${subnet} ${r.placementGroup}`);
      return h;
    }
    throw new CapacityError(`no capacity for ${r.template}`);
  }

  async waitOnline(id: string) {
    this.calls.push(`online ${id}`);
  }

  async run(id: string, key: string, _opts: RunOptions): Promise<CommandResult> {
    const name = key.split("/").at(-1)!.replace(/\.sh$/, "");
    this.calls.push(`run ${id} ${name}`);
    if (name === this.opts.failScript) return { status: "Failed", stdout: "no 200 from the server within a minute", stderr: "" };
    const stdout = name === "setup" ? "data in 812 s\nsetup done" : name.startsWith("start-") ? "READY 1234 ms to the first tile" : name === "alone" || name === "cdn" ? "capacity 4000/s, 50000 bytes a tile" : name === "catalog" ? "CATALOG first 95 ms, last none ms" : "";
    return { status: "Success", stdout, stderr: "" };
  }

  async terminate(ids: readonly string[]) {
    this.calls.push(`terminate ${ids.join(" ")}`);
  }

  async putText(key: string, text: string) {
    this.texts.set(key, text);
  }
}

const inputs = parseInputs("berlin.mbtiles inputs/584bacc2c3adf678-berlin.mbtiles\nberlin.pmtiles inputs/6879dc65c96911c8-berlin.pmtiles\n");
const ctx: RunContext = { run: "7", bucket: "b", templates: { arm64: "lt-arm", amd64: "lt-x86", client: "lt-client" }, subnets: ["s-a", "s-b"], quick: true, inputs, retryMs: 0 };
const martin = planUnits("martin-2-pmtiles-planet-arm64").run[0]!;

describe("the lane's plan", () => {
  test("runs every server on every format, dataset and architecture it can open, and says why not the rest", () => {
    const { run, skipped } = planUnits("all");
    expect(run).toHaveLength(50);
    expect(skipped.map((x) => x.id)).toEqual(["bbox-mbtiles-planet-arm64", "bbox-mbtiles-planet-amd64"]);
    expect(skipped[0]!.reason).toContain("deduplicated MBTiles schema");
  });

  test("filters by id, with wildcards", () => {
    expect(planUnits("martin-2-pmtiles-*-arm64").run.map((u) => u.id)).toEqual(["martin-2-pmtiles-berlin-arm64", "martin-2-pmtiles-planet-arm64"]);
    expect(planUnits("go-pmtiles-*, mbtileserver-mbtiles-berlin-amd64").run).toHaveLength(5);
  });

  test("finds each archive in the bucket", () => {
    expect(dataKey({ dataset: "planet", format: "mbtiles" }, inputs, "7")).toBe("inputs/openfreemap-planet-20261025_080012_pt.mbtiles");
    expect(dataKey({ dataset: "berlin", format: "pmtiles" }, inputs, "7")).toBe("inputs/6879dc65c96911c8-berlin.pmtiles");
    // tile files: OpenFreeMap's own planet image, and Berlin's built into the run's bundle
    expect(dataKey({ dataset: "planet", format: "files" }, inputs, "7")).toBe("inputs/openfreemap-planet-20261025_080012_pt.btrfs");
    expect(dataKey({ dataset: "berlin", format: "files" }, inputs, "7")).toBe("bundles/lane-7/files/berlin.btrfs");
    expect(FIRST_TILE).toEqual({ z: 14, x: 8802, y: 5373 });
  });

  test("runs BBOX on arm64 from the image the run built around its release binary", () => {
    const bbox = planUnits("bbox-pmtiles-berlin-*").run;
    const [arm, x86] = [bbox.find((u) => u.arch === "arm64")!, bbox.find((u) => u.arch === "amd64")!];
    const su = serverUnitOf(arm, "b", "7", inputs);
    expect(su.localImage).toEqual({ tag: "wf-bbox-release:0.6.2", key: "bundles/lane-7/images/bbox-arm64.tar.zst" });
    expect(setupScript(su)).toContain("aws s3 cp 's3://b/bundles/lane-7/images/bbox-arm64.tar.zst' - --only-show-errors | zstd -dc | docker load -q");
    expect(startScript(su, "alone")).toContain("'wf-bbox-release:0.6.2' 'bbox-tile-server'");
    expect(serverUnitOf(x86, "b", "7", inputs).localImage).toBeUndefined();
  });
});

describe("a unit's flow", () => {
  test("launches the client and then the server in one zone, sets both up, starts cold before each scenario, collects and terminates", async () => {
    const cloud = new FakeCloud();
    const rec = await runUnit(cloud, ctx, martin, 1);
    expect(rec.error).toBeNull();
    expect(cloud.calls).toEqual([
      "placement lane-7-p1-martin-2-pmtiles-planet-arm64-0",
      "launch client i-1 s-a lane-7-p1-martin-2-pmtiles-planet-arm64-0",
      "launch server i-2 s-a lane-7-p1-martin-2-pmtiles-planet-arm64-0",
      "online i-2",
      "online i-1",
      "run i-2 setup",
      "run i-1 client-setup",
      "run i-2 start-alone",
      "run i-1 alone",
      "run i-2 start-cdn",
      "run i-1 cdn",
      "run i-2 collect",
      "terminate i-2 i-1",
    ]);
    expect(rec.placementGroup).toBe("lane-7-p1-martin-2-pmtiles-planet-arm64-0");
    expect(rec.dataSeconds).toBe(812);
    expect(rec.readyMs).toEqual({ alone: 1234, cdn: 1234 });
    expect(rec.results.cdn).toBe("results/lane/7/p1/martin-2-pmtiles-planet-arm64/cdn.json");
    const alone = cloud.texts.get("bundles/lane-7/p1/martin-2-pmtiles-planet-arm64/alone.sh")!;
    expect(alone).toContain("'--host=10.0.0.2'");
    expect(alone).toContain("'--quick'");
    expect(JSON.parse(cloud.texts.get("results/lane/7/p1/martin-2-pmtiles-planet-arm64/unit.json")!).serverHost.az).toBe("zone-s-a");
  });

  test("ends a Berlin unit with the catalog start, after the server's log is kept", async () => {
    const cloud = new FakeCloud();
    const rec = await runUnit(cloud, ctx, planUnits("bbox-pmtiles-berlin-amd64").run[0]!, 1);
    expect(rec.error).toBeNull();
    expect(cloud.calls.slice(-3)).toEqual(["run i-2 collect", "run i-2 catalog", "terminate i-2 i-1"]);
    expect(rec.catalog).toEqual({ firstMs: 95, lastMs: null });
    expect(cloud.texts.get("bundles/lane-7/p1/bbox-pmtiles-berlin-amd64/catalog.sh")).toContain("s3://b/bundles/lane-7/catalog/small.pmtiles");
  });

  test("serves Berlin's tile files without a catalog start, which only archive servers have", async () => {
    const cloud = new FakeCloud();
    const rec = await runUnit(cloud, ctx, planUnits("nginx-files-berlin-arm64").run[0]!, 1);
    expect(rec.error).toBeNull();
    expect(cloud.calls.slice(-2)).toEqual(["run i-2 collect", "terminate i-2 i-1"]);
    expect(cloud.texts.get("bundles/lane-7/p1/nginx-files-berlin-arm64/setup.sh")).toContain("aws s3 cp 's3://b/bundles/lane-7/files/berlin.btrfs' '/opt/lane/data/berlin.btrfs'");
  });

  test("a catalog start that never finishes is recorded as never served, and the unit's scenarios stand", async () => {
    const cloud = new FakeCloud({ failScript: "catalog" });
    const rec = await runUnit(cloud, ctx, planUnits("bbox-pmtiles-berlin-arm64").run[0]!, 1);
    expect(rec.error).toBeNull();
    expect(rec.catalog).toEqual({ firstMs: null, lastMs: null });
    expect(rec.results.cdn).toBe("results/lane/7/p1/bbox-pmtiles-berlin-arm64/cdn.json");
    expect(cloud.calls.at(-1)).toBe("terminate i-2 i-1");
  });

  test("moves the pair on from a zone with no client, and from one that takes the client but not the server", async () => {
    // no clients in s-a; s-b takes the client but never the server; s-c takes both
    const cloud = new FakeCloud({ capacity: (role, subnet) => (role === "client" ? subnet !== "s-a" : subnet === "s-c") });
    const rec = await runUnit(cloud, { ...ctx, subnets: ["s-a", "s-b", "s-c"] }, martin, 2);
    expect(rec.error).toBeNull();
    expect(rec.serverHost?.subnet).toBe("s-c");
    expect(rec.clientHost?.subnet).toBe("s-c");
    expect(rec.placementGroup).toBe("lane-7-p2-martin-2-pmtiles-planet-arm64-2");
    expect(cloud.calls).toContain("terminate i-1");
    expect(rec.log.some((l) => l.endsWith("no client capacity in s-a"))).toBe(true);
    expect(rec.log.some((l) => l.endsWith("no server capacity in zone-s-b, attempt 2"))).toBe(true);
  });

  test("a failed step ends the unit, keeps the server's log and terminates both hosts", async () => {
    const cloud = new FakeCloud({ failScript: "start-cdn" });
    const rec = await runUnit(cloud, ctx, martin, 1);
    expect(rec.error).toContain("start-cdn on i-2: Failed");
    expect(rec.results).toEqual({ alone: "results/lane/7/p1/martin-2-pmtiles-planet-arm64/alone.json" });
    expect(cloud.calls.slice(-2)).toEqual(["run i-2 collect", "terminate i-2 i-1"]);
    expect(cloud.texts.has("results/lane/7/p1/martin-2-pmtiles-planet-arm64/unit.json")).toBe(true);
  });

  test("no room in any zone fails the unit with nothing left running", async () => {
    const cloud = new FakeCloud({ capacity: () => false });
    const rec = await runUnit(cloud, ctx, martin, 1);
    expect(rec.error).toContain("no zone had room");
    expect(cloud.calls.filter((c) => c.startsWith("launch"))).toEqual([]);
    expect(cloud.calls.at(-1)).toBe("terminate ");
  });
});
