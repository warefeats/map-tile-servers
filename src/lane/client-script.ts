/**
 * The scripts a client instance runs for one unit of the archive lane (docs/adr/0011). Setup fetches what the
 * workflow bundled: the unit as one file, oha, and the dataset's two replays. Each scenario runs the unit against
 * the server's private address and puts its result in the bucket.
 */
import type { Dataset, Format } from "./servers";
import { q, scriptHead, waitReady } from "./shell";

export type Scenario = "alone" | "cdn";
export const SCENARIOS: readonly Scenario[] = ["alone", "cdn"];

export interface ClientUnit {
  bucket: string;
  /** The bundle's prefix in the bucket, ending in a slash. */
  bundle: string;
  dataset: Dataset;
}

export const replayKey = (dataset: Dataset, scenario: Scenario) => `replay/${dataset}-${scenario}.txt`;

export function clientSetupScript(c: ClientUnit): string {
  const from = (key: string) => q(`s3://${c.bucket}/${c.bundle}${key}`);
  return [
    ...scriptHead(`client setup for ${c.dataset}`),
    ...waitReady,
    "mkdir -p /opt/lane",
    `aws s3 cp ${from("lane-unit.js")} /opt/lane/lane-unit.js --only-show-errors`,
    `aws s3 cp ${from("oha")} /usr/local/bin/oha --only-show-errors`,
    "chmod +x /usr/local/bin/oha",
    ...SCENARIOS.map((s) => `aws s3 cp ${from(replayKey(c.dataset, s))} ${q(`/opt/lane/${c.dataset}-${s}.txt`)} --only-show-errors`),
    "oha --version",
  ].join("\n") + "\n";
}

export interface ScenarioRun {
  server: string;
  /** What the result records as the server's version, where it differs from the server table's (a Martin build). */
  version?: string;
  /** The server's private address. */
  host: string;
  format: Format;
  scenario: Scenario;
  quick: boolean;
  /** Where the result goes in the bucket. */
  resultKey: string;
}

export function clientScenarioScript(c: ClientUnit, r: ScenarioRun): string {
  const out = `/opt/lane/${r.scenario}.json`;
  const unit = ["bun", "/opt/lane/lane-unit.js", `--server=${r.server}`, `--host=${r.host}`, `--tileset=${c.dataset}`, `--format=${r.format}`, `--scenario=${r.scenario}`, `--replay=/opt/lane/${c.dataset}-${r.scenario}.txt`, `--out=${out}`];
  if (r.quick) unit.push("--quick");
  if (r.version) unit.push(`--version=${r.version}`);
  return [
    ...scriptHead(`${r.scenario}: ${r.server} ${r.format} ${c.dataset} at ${r.host}`),
    // a thousand connections, and oha's own files
    "ulimit -n 65536",
    unit.map(q).join(" "),
    `aws s3 cp ${q(out)} ${q(`s3://${c.bucket}/${r.resultKey}`)} --only-show-errors`,
  ].join("\n") + "\n";
}
