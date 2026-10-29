/**
 * The script a server instance runs for one unit of the archive lane (docs/adr/0011), rendered from the server
 * table so it can be tested and shellchecked before it runs. It fetches the archive from the rig bucket,
 * writes the server's config files, pulls the image, drops the page cache and starts the server, timing the
 * first tile from inside the instance so neither the network nor SSM sits in the cold number. A sampler
 * records the network card's allowance counters every 10 seconds while the client measures.
 */
import { type Arch, dockerRun, type Format, type LaneServer } from "./servers";

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

const q = (s: string) => `'${s.replaceAll("'", `'"'"'`)}'`;

export function serverScript(u: ServerUnit): string {
  const files = Object.entries(u.server.config?.(u.tileset, u.format) ?? {});
  const run = dockerRun(u.server, u.arch, u.tileset, u.format, u.localImage?.tag).map(q).join(" ");
  const url = `http://127.0.0.1:${u.server.port}${u.server.path(u.tileset, u.firstTile)}`;
  return [
    "#!/usr/bin/env bash",
    "export PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin",
    "set -euo pipefail",
    `echo "unit ${u.server.id} ${u.server.version} ${u.format} ${u.tileset} ${u.arch}"`,
    "for _ in $(seq 1 240); do [ -e /var/lib/martin-2-bench-ready ] && break; sleep 5; done",
    "[ -e /var/lib/martin-2-bench-ready ] || { echo 'user data never finished'; exit 1; }",
    "mkdir -p /opt/lane/data",
    `aws s3 cp ${q(`s3://${u.bucket}/${u.dataKey}`)} ${q(`/opt/lane/data/${u.tileset}.${u.format}`)} --only-show-errors`,
    ...files.map(([name, content]) => `printf '%s' ${q(content)} > ${q(`/opt/lane/data/${name}`)}`),
    u.localImage ? `aws s3 cp ${q(`s3://${u.bucket}/${u.localImage.key}`)} - --only-show-errors | zstd -dc | docker load -q` : `docker pull -q ${q(u.server.image[u.arch] ?? "")}`,
    // the network card's allowance counters, every 10 s, for the whole unit
    "iface=$(ip -o -4 route show to default | awk '{ print $5 }')",
    `( while sleep 10; do echo "$(date +%s) $(ethtool -S "$iface" | awk '/allowance_exceeded/ { printf "%s%s ", $1, $2 }')"; done ) > /opt/lane/ena.log 2>&1 &`,
    // cold: nothing of the archive in the page cache, the server just started
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
