#!/usr/bin/env bash
# Where Martin 2.0.0 spends its time and memory where a competitor beats it on archives.
# Diagnostic only: nothing here feeds the verdict. Needs the client container up, every engine
# stopped, and nothing else running.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=.work/diagnostics
mkdir -p "$OUT"
IMG=${IMG:-wf-martin:2.0.0-055d4ea}
SYM=wf-martin:2.0.0-sym
CFG_PM=configs/archive/martin-pmtiles
H='Accept: application/vnd.mapbox-vector-tile'
G='Accept-Encoding: gzip'

start_engine() { # name image config-dir [extra docker args...] -- [martin args...]
  local name=$1 image=$2 cfg=$3; shift 3
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker run -d --name "$name" --network m2 --cpus 4 --memory 4g -v "$PWD/$cfg:/config:ro" -v "$PWD/data/cache:/tiles:ro" "$@" "$image" --config /config/config.yaml >/dev/null
}

wait_tile() {
  local url=$1
  for _ in $(seq 1 400); do
    [ "$(docker exec m2-client curl -s -o /dev/null -w '%{http_code}' -H "$H" -H "$G" "$url")" = 200 ] && return 0
    sleep 0.05
  done
  return 1
}

anon_mib() { docker exec "$1" sh -c 'cat /sys/fs/cgroup/memory.stat 2>/dev/null' | awk '/^anon /{printf "%.1f", $2/1048576}'; }

echo "== 1. startup phases (RUST_LOG=debug timestamps vs container start)" | tee "$OUT/startup.txt"
for rep in 1 2 3; do
  start_engine m2-diag "$IMG" "$CFG_PM" -e RUST_LOG=debug -e RUST_LOG_FORMAT=json
  wait_tile http://m2-diag:3000/berlin/14/8802/5371
  started=$(docker inspect -f '{{.State.StartedAt}}' m2-diag)
  echo "-- rep $rep, StartedAt $started" >> "$OUT/startup.txt"
  docker logs m2-diag 2>&1 | head -60 | cut -c1-260 >> "$OUT/startup.txt"
done
docker rm -f m2-diag >/dev/null

echo "== 2. memory: anon MiB idle / after a 10 s walk, with allocator and worker variants" | tee "$OUT/memory.txt"
docker exec m2-client sh -c 'sed "s#http://engine:3000#http://m2-diag:3000#" /work/martin-2-pmtiles-walk.txt > /work/diag-walk.txt'
mem_variant() { # label [docker args...]
  local label=$1; shift
  start_engine m2-diag "$IMG" "$CFG_PM" "$@"
  wait_tile http://m2-diag:3000/berlin/14/8802/5371
  sleep 3
  local idle; idle=$(anon_mib m2-diag)
  docker exec m2-client oha --no-tui --disable-compression -H "$H" -H "$G" -c 10 -z 10s --urls-from-file /work/diag-walk.txt >/dev/null 2>&1
  sleep 1
  printf '%-40s idle %6s MiB   after walk %6s MiB\n' "$label" "$idle" "$(anon_mib m2-diag)" | tee -a "$OUT/memory.txt"
}
mem_variant "default"
mem_variant "MALLOC_ARENA_MAX=1" -e MALLOC_ARENA_MAX=1
mem_variant "MALLOC_ARENA_MAX=2" -e MALLOC_ARENA_MAX=2
docker rm -f m2-diag >/dev/null

echo "== 3. per-request profile, one client, z5 (4 KB, root directory) against z12 (76 KB, leaf directory), symbolized build" | tee "$OUT/profile.txt"
start_engine m2-diag "$SYM" "$CFG_PM"
wait_tile http://m2-diag:3000/berlin/5/17/10
PID=$(docker inspect -f '{{.State.Pid}}' m2-diag)
docker rm -f m2-perf >/dev/null 2>&1 || true
docker run -d --name m2-perf --privileged --pid=host -v "$PWD/.work:/out" wf-perf:1 >/dev/null
for t in "5/17/10" "12/2200/1342"; do
  tag=${t%%/*}
  docker exec m2-client oha --no-tui --disable-compression -H "$H" -H "$G" -c 1 -z 3s "http://m2-diag:3000/berlin/$t" >/dev/null 2>&1
  (docker exec m2-client oha --no-tui --output-format json --disable-compression -H "$H" -H "$G" -c 1 -z 12s "http://m2-diag:3000/berlin/$t" > "$OUT/profile-oha-z$tag.json" 2>&1 &)
  sleep 2
  docker exec m2-perf perf record -F 4999 -g -p "$PID" -o "/out/diagnostics/perf-z$tag.data" -- sleep 8 >/dev/null 2>&1
  sleep 3
  echo "-- z$tag: $(jq -r '"\(.summary.requestsPerSec|floor) req/s, p50 \(.latencyPercentiles.p50*1e6|floor) us"' "$OUT/profile-oha-z$tag.json")" | tee -a "$OUT/profile.txt"
  docker exec m2-perf sh -c "perf report -i /out/diagnostics/perf-z$tag.data --no-children --sort dso,sym --stdio -g none 2>/dev/null | grep -v '^#' | grep -v '^\$' | head -30" | tee -a "$OUT/profile.txt"
  docker exec m2-perf sh -c "perf report -i /out/diagnostics/perf-z$tag.data --children --sort sym --stdio -g none 2>/dev/null | grep -v '^#' | grep -v '^\$' | grep -E 'martin|pmtiles|actix_web|prom|cors|xxh|Tile|get_tile' | head -30" | tee -a "$OUT/profile.txt"
done
docker rm -f m2-diag m2-perf >/dev/null
echo "results in $OUT/"
