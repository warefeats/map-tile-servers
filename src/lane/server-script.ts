/**
 * The scripts a server instance runs for one unit of the archive lane (docs/adr/0011), rendered from the server
 * table so they can be tested and shellchecked before they run. Setup runs once: it fetches the archive from the
 * rig bucket, writes the server's config files, pulls the image, starts a sampler that records the network card's
 * allowance counters, the server's memory and the host's CPU every 10 seconds, and starts the server once, so the
 * instance's own first container start never lands in a measured one. Start runs before each
 * scenario: a cold start, timed to the first tile from inside the instance so neither the network nor SSM sits
 * in the number. Collect puts the samples and the server's log beside the unit's results. On Berlin, the catalog
 * step then starts the server once more with 1,000 small archives beside the dataset's own, timing its first tile
 * and a tile of the last source, as the diagnostic lane does.
 */
import { lonLatToTile } from "../tiles";
import { type Arch, archiveDir, dockerRun, type Format, type LaneServer } from "./servers";
import { q, scriptHead, waitReady, writeFile } from "./shell";

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

// every 2 s for the whole unit: the server container's memory (anonymous and page cache charged to it) and its own
// CPU time, read from its cgroup (one container runs at a time), the host's busy and total CPU time, and the
// network card's allowance counters; the report prices CPU per tile from the container's counter
const SAMPLER = [
  "iface=$(ip -o -4 route show to default | awk '{ print $5 }')",
  "while sleep 2; do",
  "  box=",
  "  for d in /sys/fs/cgroup/system.slice/docker-*.scope; do [ -r \"$d/cpu.stat\" ] && box=$(awk '$1 == \"anon\" || $1 == \"file\" { printf \"%s=%s \", $1, $2 }' \"$d/memory.stat\"; awk '$1 == \"usage_usec\" { printf \"%s=%s \", $1, $2 }' \"$d/cpu.stat\"); done",
  `  cpu=$(awk 'NR == 1 { busy = $2 + $3 + $4 + $7 + $8 + $9; printf "cpu=%d/%d ", busy, busy + $5 + $6 }' /proc/stat)`,
  `  echo "$(date +%s.%N) $box$cpu$(ethtool -S "$iface" | awk '/allowance_exceeded/ { printf "%s%s ", $1, $2 }')"`,
  "done",
];

/** Where the dataset lands on the server: an archive, or for tile files the Btrfs image that holds them. */
export const archivePath = (u: Pick<ServerUnit, "server" | "tileset" | "format">) => `${archiveDir(u.server, "/opt/lane/data")}/${u.tileset}.${u.format === "files" ? "btrfs" : u.format}`;

export function setupScript(u: ServerUnit): string {
  const files = Object.entries(u.server.config?.([u.tileset], u.format) ?? {});
  const mountAt = `/opt/lane/data/${u.tileset}`;
  // OpenFreeMap mounts each build's image read-only (linux_host/linux_host_lib/mount.py)
  const mount =
    u.format === "files"
      ? [
          'modprobe btrfs 2>/dev/null || { apt-get install -y -q "linux-modules-extra-$(uname -r)" >/dev/null && modprobe btrfs; }',
          `mkdir -p ${q(mountAt)}`,
          `mount -o loop,ro ${q(archivePath(u))} ${q(mountAt)}`,
          `[ -f ${q(`${mountAt}/metadata.json`)} ] || { echo 'the image holds no metadata.json'; exit 1; }`,
        ]
      : [];
  return [
    ...scriptHead(`setup ${u.server.id} ${u.server.version} ${u.format} ${u.tileset} ${u.arch}`),
    ...waitReady,
    // Docker on Ubuntu starts containers at 1,024 open files and only the Go runtimes raise their own; an operator
    // raises it for a server that holds a thousand connections, so every container gets one high limit
    `echo '{ "default-ulimits": { "nofile": { "Name": "nofile", "Soft": 1048576, "Hard": 1048576 } } }' > /etc/docker/daemon.json`,
    "systemctl restart docker",
    `mkdir -p ${q(archiveDir(u.server, "/opt/lane/data"))}`,
    "t0=$(date +%s)",
    `aws s3 cp ${q(`s3://${u.bucket}/${u.dataKey}`)} ${q(archivePath(u))} --only-show-errors`,
    'echo "data in $(( $(date +%s) - t0 )) s"',
    ...mount,
    ...files.flatMap(([name, content]) => writeFile(`/opt/lane/data/${name}`, content)),
    u.localImage ? `aws s3 cp ${q(`s3://${u.bucket}/${u.localImage.key}`)} - --only-show-errors | zstd -dc | docker load -q` : `docker pull -q ${q(u.server.image[u.arch] ?? "")}`,
    "cat > /opt/lane/sampler.sh <<'SAMPLER'",
    ...SAMPLER,
    "SAMPLER",
    "nohup setsid bash /opt/lane/sampler.sh > /opt/lane/samples.log 2>&1 < /dev/null &",
    // a fresh instance's first container start once took 18.7 s where its next took 0.9 s (lane smoke 40958958712)
    ...startToFirstTile(u),
    'echo "warm-up start $(( (end - start) / 1000000 )) ms"',
    "docker rm -f lane-server >/dev/null",
    'echo "setup done"',
  ].join("\n") + "\n";
}

/** Starts the server and waits up to a minute for its first tile, leaving `start` and `end` in nanoseconds. */
function startToFirstTile(u: ServerUnit): string[] {
  const run = dockerRun(u.server, u.arch, [u.tileset], u.format, u.localImage?.tag).map(q).join(" ");
  // behind a cache each try asks for a fresh URL, or the cache could answer a try made before the server listened
  const url = `${q(`http://127.0.0.1:${u.server.port}${u.server.path(u.tileset, u.firstTile)}`)}${u.server.cachedFront ? '"?start=$n"' : ""}`;
  return [
    "start=$(date +%s%N)",
    run,
    // a server that takes the connection and never answers must not stall the wait, so each try has its own limit
    "code=000",
    "n=0",
    "deadline=$(( $(date +%s) + 60 ))",
    `while [ "$(date +%s)" -lt "$deadline" ]; do n=$((n + 1)); code=$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' ${url} || true); [ "$code" = 200 ] && break; sleep 0.01; done`,
    "end=$(date +%s%N)",
    '[ "$code" = 200 ] || { echo "no 200 from the server within a minute (last $code)"; docker logs --tail 40 lane-server; exit 1; }',
  ];
}

/** Nothing of the archive in the page cache, the server just started, timed to its first tile. */
export function startScript(u: ServerUnit, scenario: string): string {
  return [
    ...scriptHead(`start ${u.server.id} ${u.format} ${u.tileset} ${u.arch} for ${scenario}`),
    "docker rm -f lane-server >/dev/null 2>&1 || true",
    "sync && echo 3 > /proc/sys/vm/drop_caches",
    ...startToFirstTile(u),
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
    // a server whose image runs nginx in front of it keeps that nginx's own error log in its data directory
    `if [ -f /opt/lane/data/log/error.log ]; then tail -n 2000 /opt/lane/data/log/error.log | aws s3 cp - ${q(`${prefix}nginx-error.log`)} --only-show-errors; fi`,
  ].join("\n") + "\n";
}

/** The catalog start (docs/adr/0011, reported, not ranked): the dataset's archive plus 1,000 small ones. */
export const CATALOG_SIZE = 1000;
export const CATALOG_NAMES = Array.from({ length: CATALOG_SIZE }, (_, i) => `t${String(i).padStart(4, "0")}`);
/** The zoom-8 tile holding central Berlin, which every small archive (zooms 0-8 of the Berlin build) holds. */
export const SMALL_TILE = lonLatToTile(13.405, 52.52, 8);
const CATALOG_WAIT_S = 300;

/** `smallKey` is the small archive in the bucket; each of the 1,000 is a copy of it, a distinct file, not a link. */
export function catalogScript(u: ServerUnit, smallKey: string): string {
  const dir = "/opt/lane/catalog";
  const names = [u.tileset, ...CATALOG_NAMES];
  const files = Object.entries(u.server.config?.(names, u.format) ?? {});
  const run = dockerRun(u.server, u.arch, names, u.format, u.localImage?.tag, dir).map(q).join(" ");
  const url = (tileset: string, t: { z: number; x: number; y: number }) => q(`http://127.0.0.1:${u.server.port}${u.server.path(tileset, t)}`);
  return [
    ...scriptHead(`catalog ${u.server.id} ${u.format} ${u.tileset} ${u.arch}: ${CATALOG_SIZE} more sources`),
    "docker rm -f lane-server >/dev/null 2>&1 || true",
    `rm -rf ${dir}`,
    `mkdir -p ${q(archiveDir(u.server, dir))}`,
    `ln ${q(archivePath(u))} ${q(`${archiveDir(u.server, dir)}/${u.tileset}.${u.format}`)}`,
    `aws s3 cp ${q(`s3://${u.bucket}/${smallKey}`)} ${q(`/opt/lane/small.${u.format}`)} --only-show-errors`,
    `for i in $(seq 0 ${CATALOG_SIZE - 1}); do cp ${q(`/opt/lane/small.${u.format}`)} "${archiveDir(u.server, dir)}/t$(printf %04d "$i").${u.format}"; done`,
    ...files.flatMap(([name, content]) => writeFile(`${dir}/${name}`, content)),
    // milliseconds from the start to a URL's first 200, or "none" when the wait runs out
    "until200() {",
    "  local deadline n=0",
    `  deadline=$(( $(date +%s) + ${CATALOG_WAIT_S} ))`,
    '  while [ "$(date +%s)" -lt "$deadline" ]; do',
    "    n=$((n + 1))",
    `    if [ "$(curl -s --max-time 2 -o /dev/null -w '%{http_code}' "$1${u.server.cachedFront ? "?start=$n" : ""}" || true)" = 200 ]; then echo $(( ($(date +%s%N) - start) / 1000000 )); return; fi`,
    "    sleep 0.01",
    "  done",
    "  echo none",
    "}",
    "sync && echo 3 > /proc/sys/vm/drop_caches",
    "start=$(date +%s%N)",
    run,
    `first=$(until200 ${url(u.tileset, u.firstTile)})`,
    `if [ "$first" = none ]; then last=none; else last=$(until200 ${url(CATALOG_NAMES.at(-1)!, SMALL_TILE)}); fi`,
    'echo "CATALOG first $first ms, last $last ms"',
    '[ "$last" != none ] || docker logs --tail 20 lane-server 2>&1 || true',
    "docker rm -f lane-server >/dev/null 2>&1 || true",
  ].join("\n") + "\n";
}
