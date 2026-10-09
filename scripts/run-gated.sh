#!/usr/bin/env bash
# One measured run (docs/adr/0005): both families and both thousand-source runs, every candidate on its own
# behind a quiet-host gate, then everything again in mirror order. The verdict pools the two passes.
#   scripts/run-gated.sh <run>   ->  results-<family>[-catalog]-<run>-p1.json and -p2.json, verdict-<run>.json
#   ONLY="martin-2 martin-2-pmtiles" TAG=redo scripts/run-gated.sh <run>   re-measures those candidates into the same
#   files (their old entries must be dropped first), in the same pass order, logging to run-<run>-<TAG>.full.log.
# Each candidate waits for a 1-minute host load under 6, the CPU of everything but the OrbStack VM is sampled
# through its slot, and a slot in which that went over 4 cores is measured again (three tries, the third kept).
# The host load average counts the VM's own vCPUs, so it rises with every candidate and cannot be the test.
set -uo pipefail
RUN=${1:?usage: scripts/run-gated.sh <run>}
R=$(cd "$(dirname "$0")/.." && pwd)
cd "$R"
LOG=$R/.work/run-$RUN${TAG:+-$TAG}.full.log
mkdir -p "$R/.work"
load1() { sysctl -n vm.loadavg | awk '{print $2}'; }
other_cpu() { ps -Ao pcpu,comm | awk 'NR > 1 && !/OrbStack Helper/ { s += $1 } END { printf "%.0f\n", s }'; }
gate() { until awk -v l="$(load1)" 'BEGIN { exit !(l < 6) }'; do sleep 30; done; }
drop() {
  python3 - "$1" "$2" <<'PY'
import json, os, sys
path, cand = sys.argv[1], sys.argv[2]
if os.path.exists(path):
    d = json.load(open(path))
    d["results"] = [r for r in d["results"] if r["id"] != cand]
    json.dump(d, open(path, "w"), indent=2)
PY
}
measure() {
  local script=$1 family=$2 cand=$3 out=$4 flag=$5 attempt samples stop max
  for attempt in 1 2 3; do
    gate
    samples=$(mktemp); stop=$(mktemp -u)
    ( while [ ! -e "$stop" ]; do other_cpu >> "$samples"; sleep 15; done ) &
    echo "### $script $family $cand attempt $attempt $(date +%H:%M:%S)" >> "$LOG"
    bun run "src/$script.ts" --family="$family" --candidates="$cand" --output="$out" --resume $flag >> "$LOG" 2>&1
    touch "$stop"; wait
    max=$(sort -n "$samples" | tail -1); rm -f "$samples" "$stop"
    echo "  $script $cand attempt $attempt done $(date +%H:%M): other processes peaked at ${max}% CPU"
    if awk -v m="$max" 'BEGIN { exit !(m < 400) }'; then return; fi
    [ "$attempt" -lt 3 ] && drop "$out" "$cand"
  done
  echo "  $script $cand: kept the third attempt"
}
ids() { bun -e "import { CANDIDATES } from './src/matrix'; const only = '${ONLY:-}'.split(' ').filter(Boolean); console.log(CANDIDATES.filter((c) => c.family === '$1' && (!only.length || only.includes(c.id))).map((c) => c.id).join(' '))"; }
mirror() { local out=""; for w in "$@"; do out="$w $out"; done; echo $out; }
step() {
  local pass=$1 family=$2 script=$3 list flag="" out
  list=$(ids "$family")
  if [ "$pass" = 2 ]; then list=$(mirror $list); flag=--reverse; fi
  if [ "$script" = run ]; then out="$R/results-$family-$RUN-p$pass.json"; else out="$R/results-$family-catalog-$RUN-p$pass.json"; fi
  echo "== pass $pass: $family $script $(date +%H:%M)"
  for c in $list; do measure "$script" "$family" "$c" "$out" "$flag"; done
}
echo "run $RUN${ONLY:+ (only $ONLY)} with $(bun -e "import { MARTIN_2 } from './src/matrix'; console.log(MARTIN_2.image)"), started $(date '+%Y-%m-%d %H:%M')"
for pass in 1 2; do
  if [ "$pass" = 1 ]; then seq="postgis:run postgis:catalog archive:run archive:catalog"; else seq="archive:catalog archive:run postgis:catalog postgis:run"; fi
  for s in $seq; do step "$pass" "${s%%:*}" "${s##*:}"; done
done
echo "== verdict"; bun run src/analysis.ts --run="$RUN"
echo "FULLDONE $(date '+%Y-%m-%d %H:%M')"
