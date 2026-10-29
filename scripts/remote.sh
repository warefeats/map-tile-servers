#!/usr/bin/env bash
# Runs on a rig instance as root, through SSM: unpack the bundle, restore the corpus, get the Martin 2.0
# image (build it, or load the one another host built), run the unchanged protocol for this host's
# families, upload results, and shut the instance down (it terminates).
#   remote.sh <bucket> <run id> <martin 2.0 image tag> [--families=postgis,archive] [--build=<commit>:<rustc>]
#             [--smoke | --smoke-first] [--keep]
# --build builds the image here (docs/adr/0010) and uploads it for the other host; without it the host waits
# for that upload. --smoke runs only the smoke protocol; --smoke-first runs it and goes on to the measured run
# (two passes, the second mirrored, docs/adr/0005) only when no smoke step recorded a failure. --keep leaves
# the instance up at the end (the user data's ten-hour shutdown still holds).
# SSM runs commands under a minimal PATH, so this sets its own and fails on the first error.
export PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin
export HOME=${HOME:-/root}
set -euo pipefail

bucket=$1; run_id=$2; image=$3; shift 3
families="postgis archive"; build=""; mode=full; keep=""
for arg in "$@"; do
  case "$arg" in
    --families=*) families=$(echo "${arg#--families=}" | tr ',' ' ') ;;
    --build=*) build=${arg#--build=} ;;
    --smoke) mode=smoke ;;
    --smoke-first) mode=smoke-first ;;
    --keep) keep=1 ;;
    *) echo "unknown argument $arg" >&2; exit 2 ;;
  esac
done
label=$(echo "$families" | tr ' ' '-')
log=/var/log/martin-2-bench-$run_id-$label.log
s3=s3://$bucket
image_key=images/$(echo "$image" | tr ':/' '__').tar.zst
exec > >(tee -a "$log") 2>&1

# Every results file that exists reaches the bucket, so no later failure can take an earlier step's data with it.
upload_results() {
  local f
  for f in /opt/m2/results-*-"$run_id"*.json /opt/m2/verdict-"$run_id".* /opt/martin-build/build-info.txt; do
    if [ -e "$f" ]; then aws s3 cp "$f" "$s3/results/$run_id/$(basename "$f")" --only-show-errors || true; fi
  done
}

# shellcheck disable=SC2329 # the EXIT trap calls it
finish() {
  local status=$?
  echo "EXIT $status $(date -u +%FT%TZ)"
  kill "$uploader" 2>/dev/null || true
  upload_results
  aws s3 cp "$log" "$s3/results/$run_id/run-$label.log" --only-show-errors || true
  if [ -z "$keep" ]; then shutdown -h +1 || true; fi
}
trap finish EXIT

# The progress log reaches the bucket every minute, so the workflow can follow a run without SSM.
uploader=""
( while sleep 60; do aws s3 cp "$log" "$s3/results/$run_id/run-$label.log" --only-show-errors || true; done ) &
uploader=$!

echo "START $(date -u +%FT%TZ) run $run_id image $image families [$families] mode $mode${build:+ build $build}${keep:+ keep}"
# User data installs Docker, the AWS CLI and bun; SSM can come up first.
for _ in $(seq 1 240); do [ -e /var/lib/martin-2-bench-ready ] && break; sleep 5; done
[ -e /var/lib/martin-2-bench-ready ] || { echo "user data never finished"; exit 1; }
for bin in docker aws bun zstd jq; do command -v "$bin" >/dev/null || { echo "missing $bin"; exit 1; }; done

token=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
instance_type=$(curl -fsS -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/instance-type)
instance_id=$(curl -fsS -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/instance-id)
echo "instance $instance_id $instance_type, $(nproc) cores, $(awk '/MemTotal/ { printf "%d GB", $2 / 1048576 }' /proc/meminfo), $(uname -r)"

# The bundle: this run's committed tree, and the inputs it names (uploaded once, shared by every run).
mkdir -p /opt/bundle /opt/inputs
aws s3 cp "$s3/bundles/$run_id/" "/opt/bundle/$run_id/" --recursive --only-show-errors
input() { awk -v n="$1" '$1 == n { print $2 }' "/opt/bundle/$run_id/inputs.txt"; }
for name in images.tar.zst dbdata.tar.zst berlin.mbtiles berlin.pmtiles; do
  key=$(input "$name")
  [ -n "$key" ] || { echo "the bundle names no $name"; exit 1; }
  [ -s "/opt/inputs/$(basename "$key")" ] || aws s3 cp "$s3/$key" "/opt/inputs/$(basename "$key")" --only-show-errors
  ln -sf "/opt/inputs/$(basename "$key")" "/opt/inputs/$name"
done
rm -rf /opt/m2 && mkdir -p /opt/m2
tar -xzf "/opt/bundle/$run_id/repo.tar.gz" -C /opt/m2
cd /opt/m2
bun install --frozen-lockfile
mkdir -p data/cache
cp /opt/inputs/berlin.mbtiles /opt/inputs/berlin.pmtiles data/cache/

echo "images: the local builds (client, BBOX, mbtileserver)"
docker image inspect wf-client:1 wf-bbox:0.6.2 wf-mbtileserver:0.11.0 >/dev/null 2>&1 || zstd -dc /opt/inputs/images.tar.zst | docker load
echo "images: pulling the published ones the justfile names"
grep -oE 'docker pull [^ ]+' justfile | awk '{ print $3 }' | while read -r ref; do docker pull -q "$ref"; done

echo "images: Martin 2.0 $image"
if docker image inspect "$image" >/dev/null 2>&1; then
  echo "  already here"
elif [ -n "$build" ]; then
  # the training run needs the same oha the harness uses
  docker run --rm --entrypoint cat wf-client:1 /usr/local/bin/oha > /tmp/oha && install -m 755 /tmp/oha /usr/local/bin/oha
  echo "== build $(date -u +%T)"
  if ! bash scripts/build-martin-pgo.sh "${build%%:*}" "${build##*:}" "$image"; then
    # the hosts waiting for this image stop waiting
    echo "build of $image failed on $instance_id" | aws s3 cp - "$s3/$image_key.failed" --only-show-errors || true
    echo "BUILD FAILED"; exit 1
  fi
  echo "== build done $(date -u +%T)"
  docker save "$image" | zstd -T0 -3 -q -f -o /opt/inputs/martin-2.tar.zst
  aws s3 cp /opt/inputs/martin-2.tar.zst "$s3/$image_key" --only-show-errors
  aws s3 cp /opt/martin-build/build-info.txt "$s3/$image_key.txt" --only-show-errors
else
  echo "  waiting for the building host to upload $image_key"
  exists() { aws s3api head-object --bucket "$bucket" --key "$1" >/dev/null 2>&1; }
  for _ in $(seq 1 180); do
    exists "$image_key" && break
    exists "$image_key.failed" && { echo "the building host failed: $(aws s3 cp "$s3/$image_key.failed" -)"; exit 1; }
    sleep 60
  done
  aws s3 cp "$s3/$image_key" /opt/inputs/martin-2.tar.zst --only-show-errors
  zstd -dc /opt/inputs/martin-2.tar.zst | docker load
  mkdir -p /opt/martin-build
  aws s3 cp "$s3/$image_key.txt" /opt/martin-build/build-info.txt --only-show-errors || true
fi
want=$(bun -e "import { MARTIN_2 } from './src/matrix'; console.log(MARTIN_2.version)")
got=$(docker run --rm --entrypoint /usr/local/bin/martin "$image" --version)
echo "  $got"
case "$got" in *"$want"*) ;; *) echo "image $image is not Martin $want"; exit 1 ;; esac

if echo "$families" | grep -qw postgis; then
  echo "corpus: a fresh copy of the database volume"
  docker rm -f m2-db >/dev/null 2>&1 || true
  docker volume rm m2-dbdata >/dev/null 2>&1 || true
  docker volume create m2-dbdata >/dev/null
  db_image=$(bun -e "import { DB_IMAGE } from './src/docker'; console.log(DB_IMAGE)")
  zstd -dc /opt/inputs/dbdata.tar.zst | docker run --rm -i -v m2-dbdata:/v --entrypoint tar "$db_image" -C /v -xf -
fi

export WF_MARTIN_2_IMAGE=$image
export WF_MACHINE="EC2 $instance_type"
# One step's failure is recorded and the run goes on; each step's results upload as soon as it ends.
failed=0
step() {
  local name=$1; shift
  echo "== $name $(date -u +%T)"
  if ! "$@"; then echo "STEP FAILED: $name"; failed=1; fi
  upload_results
}
ids() { bun -e "import { CANDIDATES } from './src/matrix'; console.log(CANDIDATES.filter((c) => c.family === '$1' && !'$2'.split(',').includes(c.id)).map((c) => c.id).join(','))"; }

if [ "$mode" != full ]; then
  for family in $families; do
    step "$family smoke" bun run src/run.ts --family="$family" --smoke --output="results-$family-$run_id-smoke.json"
    # BBOX 0.6.2 never serves with 1,001 PMTiles tilesets; the measured run records that, the smoke skips its ten minutes
    step "$family catalog smoke" bun run src/catalog.ts --family="$family" --smoke --candidates="$(ids "$family" bbox-pmtiles)" --output="results-$family-catalog-$run_id-smoke.json"
  done
  for f in results-*-"$run_id"-smoke.json; do
    jq -e '.failures | length == 0' "$f" >/dev/null || { echo "SMOKE FAILURES in $f:"; jq -c '.failures[]' "$f"; failed=1; }
  done
  [ "$failed" = 0 ] || { echo "SMOKE FAILED"; exit 1; }
  echo "SMOKE PASSED $(date -u +%T)"
  [ "$mode" = smoke ] && { echo "DONE $(date -u +%FT%TZ) failed=0"; exit 0; }
fi

# Pass 1 runs each family's protocol and then its thousand sources; pass 2 runs the same steps mirrored.
reversed=""
for family in $families; do reversed="$family $reversed"; done
for family in $families; do
  step "pass 1: $family run" bun run src/run.ts --family="$family" --output="results-$family-$run_id-p1.json"
  step "pass 1: $family catalog" bun run src/catalog.ts --family="$family" --output="results-$family-catalog-$run_id-p1.json"
done
for family in $reversed; do
  step "pass 2: $family catalog" bun run src/catalog.ts --family="$family" --reverse --output="results-$family-catalog-$run_id-p2.json"
  step "pass 2: $family run" bun run src/run.ts --family="$family" --reverse --output="results-$family-$run_id-p2.json"
done
if [ "$families" = "postgis archive" ]; then
  echo "== verdict $(date -u +%T)"
  bun run src/analysis.ts --run="$run_id" > "verdict-$run_id.txt" 2>&1 || true
  upload_results
fi
echo "DONE $(date -u +%FT%TZ) failed=$failed"
exit "$failed"
