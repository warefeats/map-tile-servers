/**
 * The scripts a server instance runs for one unit of the archive lane (docs/adr/0011), rendered from the server
 * table so they can be tested and shellchecked before they run. Setup runs once: it fetches the archive from the
 * rig bucket, writes the server's config files, pulls the image and starts a sampler that records the network
 * card's allowance counters, the server's memory and the host's CPU every 10 seconds. Start runs before each
 * scenario: a cold start, timed to the first tile from inside the instance so neither the network nor SSM sits
 * in the number. Collect runs last and puts the samples and the server's log beside the unit's results.
 */
import { type Arch, dockerRun, type Format, type LaneServer } from "./servers";
import { q, scriptHead, waitReady } from "./shell";

export interface ServerUnit {
  server: LaneServer;
  arch: Arch;
  tileset: string;
  format: Format;
  bucket: string;
  /** The archive's key in the rig bucket. */
  dataKey: string;
  /** A tile the first request asks for, as z/x/y. */
  firstTile: { z: number; x: number; y: number };
  /** The image built from the project's release binary, where it publishes none for this architecture. */
  localImage?: { tag: string; key: string };
}

// every 10 s for the whole unit: the server's memory (anonymous and page cache charged to its container), the
// host's busy and total CPU time, and the network card's allowance counters
const SAMPLER = [
  "iface=$(ip -o -4 route show to default | awk '{ print $5 }')",
  "while sleep 10; do",
  "  mem=",
  "  id=$(docker inspect -f '{{.Id}}' lane-server 2>/dev/null || true)",
  '  stat="/sys/fs/cgroup/system.slice/docker-$id.scope/memory.stat"',
  `  if [ -n "$id" ] && [ -r "$stat" ]; then mem=$(awk '$1 == "anon" || $1 == "file" { printf "%s=%s ", $1, $2 }' "$stat"); fi`,
  `  cpu=$(awk 'NR == 1 { busy = $2 + $3 + $4 + $7 + $8 + $9; printf "cpu=%d/%d ", busy, busy + $5 + $6 }' /proc/stat)`,
  `  echo "$(date +%s) $mem$cpu$(ethtool -S "$iface" | awk '/allowance_exceeded/ { printf "%s%s ", $1, $2 }')"`,
  "done",
];

export function setupScript(u: ServerUnit): string {
  const files = Object.entries(u.server.config?.(u.tileset, u.format) ?? {});
  return [
    ...scriptHead(`setup ${u.server.id} ${u.server.version} ${u.format} ${u.tileset} ${u.arch}`),
    ...waitReady,
    // Docker on Ubuntu starts containers at 1,024 open files and only the Go runtimes raise their own; an operator
    // raises it for a server that holds a thousand connections, so every container gets one high limit
    `echo '{ "default-ulimits": { "nofile": { "Name": "nofile", "Soft": 1048576, "Hard": 1048576 } } }' > /etc/docker/daemon.json`,
    "systemctl restart docker",
    "mkdir -p /opt/lane/data",
    "t0=$(date +%s)",
    `aws s3 cp ${q(`s3://${u.bucket}/${u.dataKey}`)} ${q(`/opt/lane/data/${u.tileset}.${u.format}`)} --only-show-errors`,
    'echo "data in $(( $(date +%s) - t0 )) s"',
    ...files.map(([name, content]) => `printf '%s' ${q(content)} > ${q(`/opt/lane/data/${name}`)}`),
    u.localImage ? `aws s3 cp ${q(`s3://${u.bucket}/${u.localImage.key}`)} - --only-show-errors | zstd -dc | docker load -q` : `docker pull -q ${q(u.server.image[u.arch] ?? "")}`,
    "cat > /opt/lane/sampler.sh <<'SAMPLER'",
    ...SAMPLER,
    "SAMPLER",
    "nohup setsid bash /opt/lane/sampler.sh > /opt/lane/samples.log 2>&1 < /dev/null &",
    'echo "setup done"',
  ].join("\n") + "\n";
}

/** Nothing of the archive in the page cache, the server just started, timed to its first tile. */
export function startScript(u: ServerUnit, scenario: string): string {
  const run = dockerRun(u.server, u.arch, u.tileset, u.format, u.localImage?.tag).map(q).join(" ");
  const url = `http://127.0.0.1:${u.server.port}${u.server.path(u.tileset, u.firstTile)}`;
  return [
    ...scriptHead(`start ${u.server.id} ${u.format} ${u.tileset} ${u.arch} for ${scenario}`),
    "docker rm -f lane-server >/dev/null 2>&1 || true",
    "sync && echo 3 > /proc/sys/vm/drop_caches",
    "start=$(date +%s%N)",
    run,
    "code=000",
    `for _ in $(seq 1 6000); do code=$(curl -s -o /dev/null -w '%{http_code}' ${q(url)} || true); [ "$code" = 200 ] && break; sleep 0.01; done`,
    "end=$(date +%s%N)",
    '[ "$code" = 200 ] || { echo "no 200 from the server within a minute (last $code)"; docker logs --tail 40 lane-server; exit 1; }',
    'echo "READY $(( (end - start) / 1000000 )) ms to the first tile"',
  ].join("\n") + "\n";
}

/** The samples and the end of the server's log, into the unit's results prefix (s3://bucket/key/). */
export function collectScript(u: ServerUnit, prefix: string): string {
  return [
    ...scriptHead(`collect ${u.server.id} ${u.format} ${u.tileset} ${u.arch}`),
    "docker logs --tail 2000 lane-server > /opt/lane/server.log 2>&1 || true",
    `aws s3 cp /opt/lane/samples.log ${q(`${prefix}samples.log`)} --only-show-errors`,
    `aws s3 cp /opt/lane/server.log ${q(`${prefix}server.log`)} --only-show-errors`,
  ].join("\n") + "\n";
}
