/**
 * Render this runner's unpublished page on the site's dev server without pushing anything: merge
 * benchmark.json and the run files the way the site's sync does, and write the result into the
 * site checkout's cache under a local-only registry entry. `--remove` takes the entry out again.
 * Never commit the site files this touches; the real pin comes from `bun run sync` after a merge.
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname!, "..");
const site = process.argv.find((a) => a.startsWith("--site="))?.split("=")[1] ?? join(root, "..", "warefeats.com");
const data = join(site, "web", "data");
const meta = JSON.parse(readFileSync(join(root, "benchmark.json"), "utf8"));
const slug: string = meta.slug;
const repo = "warefeats/martin-2";
const registryPath = join(data, "registry.json");
const manifestPath = join(data, "cache", "manifest.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

if (process.argv.includes("--remove")) {
  registry.benchmarks = registry.benchmarks.filter((b: { slug: string }) => b.slug !== slug);
  delete manifest[slug];
  rmSync(join(data, "cache", `${slug}.json`), { force: true });
} else {
  const ref = Bun.spawnSync(["git", "-C", root, "rev-parse", "HEAD"]).stdout.toString().trim().padEnd(40, "0").slice(0, 40);
  const runs = meta.runs.map((p: string) => JSON.parse(readFileSync(join(root, p), "utf8")));
  const primary = runs[0];
  const benchmark = {
    id: meta.id,
    slug,
    category: meta.category,
    title: meta.title,
    deck: meta.deck,
    publishedAt: primary.publishedAt,
    unit: meta.unit,
    lowerIsBetter: meta.lowerIsBetter,
    verdict: meta.verdict,
    ...(meta.corpus ? { corpus: meta.corpus } : {}),
    environment: primary.environment,
    protocol: primary.protocol,
    candidates: primary.candidates ?? [],
    ...(primary.sections ? { sections: primary.sections } : {}),
    limitations: meta.limitations,
    ...(meta.trademarks ? { trademarks: meta.trademarks } : {}),
    ...(meta.story ? { story: meta.story } : {}),
    runnerUrl: `https://github.com/${repo}`,
  };
  writeFileSync(join(data, "cache", `${slug}.json`), JSON.stringify(benchmark, null, 2) + "\n");
  registry.benchmarks = registry.benchmarks.filter((b: { slug: string }) => b.slug !== slug).concat([{ slug, repo, ref }]);
  manifest[slug] = { repo, ref };
}
writeFileSync(registryPath, JSON.stringify(registry, null, 2) + "\n");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(process.argv.includes("--remove") ? `removed ${slug} from the site checkout` : `wrote ${slug} into ${site}; open http://localhost:5173/benchmarks/${slug}/ on \`just dev\``);
