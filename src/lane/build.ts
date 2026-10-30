/**
 * A Martin commit built for the lane's martin-2 units, to measure a change before it is published; docs/adr/0011
 * otherwise runs published images only. One arm64 builder, the lane's server template on a bigger instance, builds
 * it the way Martin's release builds its arm64 image (scripts/build-martin-pgo.sh, docs/adr/0010) and leaves the
 * image in the run's bundle, where the martin-2 arm64 units load it. The recipe has no x86 counterpart, so the x86
 * units are skipped.
 */
import { readFileSync } from "node:fs";
import { MARTIN_2_BUILD } from "../matrix";
import type { Cloud } from "./cloud";
import type { LaneServer } from "./servers";
import { q, scriptHead } from "./shell";

export interface MartinBuild {
  /** The GitHub repository the commit is fetched from, owner/name. */
  repo: string;
  commit: string;
}

/** 32 Graviton4 cores: the recipe builds twice with a training run between (26 minutes on a c7g.metal). */
export const BUILDER_TYPE = "c8g.8xlarge";
const BUILD_TIMEOUT_S = 2 * 3600;

/** `owner/name@commit` with the commit in full, or null. */
export function parseBuild(s: string): MartinBuild | null {
  const m = /^([\w.-]+\/[\w.-]+)@([0-9a-f]{40})$/.exec(s.trim());
  return m ? { repo: m[1]!, commit: m[2]! } : null;
}

const short = (b: MartinBuild) => b.commit.slice(0, 7);

/** martin-2 as the build: on arm64 only, from the run's bundle, labelled with its commit. */
export function builtServer(server: LaneServer, b: MartinBuild): LaneServer {
  return { ...server, version: `build ${short(b)}`, stable: false, image: { arm64: null, amd64: null }, release: { arm64: `wf-martin:build-${short(b)}` } };
}

/** The builder's script: the oha the units use for the training run, the build, then the image where the units load it. */
export function buildScript(b: MartinBuild, server: LaneServer, bucket: string, run: string): string {
  const bundle = `s3://${bucket}/bundles/lane-${run}`;
  const tag = server.release?.arm64;
  if (!tag) throw new Error(`${server.id} is not a build`);
  return [
    ...scriptHead(`build ${b.repo}@${b.commit} as ${tag}`),
    `aws s3 cp ${q(`${bundle}/oha`)} /usr/local/bin/oha --only-show-errors`,
    "chmod 755 /usr/local/bin/oha",
    `aws s3 cp ${q(`${bundle}/build/build-martin-pgo.sh`)} /opt/lane/build-martin-pgo.sh --only-show-errors`,
    `MARTIN_REPO=${q(`https://github.com/${b.repo}`)} bash /opt/lane/build-martin-pgo.sh ${q(b.commit)} ${q(MARTIN_2_BUILD.rustc)} ${q(tag)}`,
    `docker save ${q(tag)} | zstd -T0 -3 -q | aws s3 cp - ${q(`${bundle}/images/${server.id}-arm64.tar.zst`)} --only-show-errors`,
    `aws s3 cp /opt/martin-build/build-info.txt ${q(`s3://${bucket}/results/lane/${run}/martin-build.txt`)} --only-show-errors`,
    "echo 'build done'",
  ].join("\n") + "\n";
}

/** Builds on one instance and terminates it whatever happens; throws when the build fails. */
export async function buildMartin(cloud: Cloud, b: MartinBuild, server: LaneServer, ctx: { bucket: string; run: string; template: string; subnets: readonly string[] }): Promise<void> {
  const name = `lane-${ctx.run}-build`;
  const tags = (role: string) => ({ Name: name, Project: "martin-2-bench", LaneRun: ctx.run, Role: role });
  const dir = `bundles/lane-${ctx.run}/build/`;
  await cloud.putText(`${dir}build-martin-pgo.sh`, readFileSync("scripts/build-martin-pgo.sh", "utf8"));
  await cloud.putText(`${dir}build.sh`, buildScript(b, server, ctx.bucket, ctx.run));
  await cloud.createPlacementGroup(name, tags("placement"));
  const host = await cloud.launch({ template: ctx.template, instanceType: BUILDER_TYPE, placementGroup: name, subnets: ctx.subnets, tags: tags("build") });
  try {
    await cloud.waitOnline(host.id, 15 * 60_000);
    const r = await cloud.run(host.id, `${dir}build.sh`, { timeoutS: BUILD_TIMEOUT_S, outputPrefix: `results/lane/${ctx.run}/build/ssm`, comment: `lane ${ctx.run} build ${short(b)}` });
    if (r.status !== "Success") throw new Error(`build of ${b.repo}@${b.commit} on ${host.id}: ${r.status}\n${`${r.stdout}\n${r.stderr}`.trim().slice(-1500)}`);
  } finally {
    await cloud.terminate([host.id]);
  }
}
