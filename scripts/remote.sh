#!/usr/bin/env bash
# Runs on the rig instance as root, through SSM: unpack the bundle, restore the corpus, run the
# unchanged protocol for each family, upload results, and shut the instance down (it terminates).
#   remote.sh <bucket> <run id> <martin 2.0.0 image tag> [--smoke] [--families=postgis,archive]
# SSM runs commands under a minimal PATH, so this sets its own and fails on the first error.
export PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin
set -euo pipefail

bucket=$1; run_id=$2; image=$3; shift 3
smoke=""; families="postgis archive"
for arg in "$@"; do
  case "$arg" in
    --smoke) smoke="--smoke" ;;
    --families=*) families=$(echo "${arg#--families=}" | tr ',' ' ') ;;
    *) echo "unknown argument $arg" >&2; exit 2 ;;
  esac
done
suffix=$run_id
log=/var/log/martin-2-bench.log
s3=s3://$bucket
exec > >(tee -a "$log") 2>&1

finish() {
  local status=$?
  echo "EXIT $status $(date -u +%FT%TZ)"
  aws s3 cp "$log" "$s3/results/$run_id/run.log" --only-show-errors || true
  shutdown -h +1 || true
}
trap finish EXIT

# The progress log reaches the bucket every minute, so the laptop can follow a run without SSM.
( while sleep 60; do aws s3 cp "$log" "$s3/results/$run_id/run.log" --only-show-errors || true; done ) &

echo "START $(date -u +%FT%TZ) run $run_id image $image families [$families] $smoke"
# User data installs Docker, the AWS CLI and bun; SSM can come up first.
for _ in $(seq 1 240); do [ -e /var/lib/martin-2-bench-ready ] && break; sleep 5; done
[ -e /var/lib/martin-2-bench-ready ] || { echo "user data never finished"; exit 1; }
for bin in docker aws bun zstd jq; do command -v "$bin" >/dev/null || { echo "missing $bin"; exit 1; }; done

token=$(curl -fsS -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
instance_type=$(curl -fsS -H "X-aws-ec2-metadata-token: $token" http://169.254.169.254/latest/meta-data/instance-type)
echo "instance $instance_type, $(nproc) cores, $(awk '/MemTotal/ { printf "%d GB", $2 / 1048576 }' /proc/meminfo)"

mkdir -p /opt/bundle /opt/m2
aws s3 cp "$s3/bundles/$run_id/" /opt/bundle/ --recursive --only-show-errors
tar -xzf /opt/bundle/repo.tar.gz -C /opt/m2
cd /opt/m2
bun install --frozen-lockfile

echo "images: loading the local builds"
zstd -dc /opt/bundle/images.tar.zst | docker load
echo "images: pulling the published ones the justfile names"
grep -oE 'docker pull [^ ]+' justfile | awk '{ print $3 }' | while read -r ref; do docker pull -q "$ref"; done

echo "corpus: database volume and archives"
docker volume create m2-dbdata >/dev/null
zstd -dc /opt/bundle/dbdata.tar.zst | docker run --rm -i -v m2-dbdata:/v --entrypoint tar imresamu/postgis:18-3.6 -C /v -xf -
mkdir -p data/cache
cp /opt/bundle/berlin.mbtiles /opt/bundle/berlin.pmtiles data/cache/

export WF_MARTIN_2_IMAGE=$image
export WF_MACHINE="EC2 $instance_type"
for family in $families; do
  echo "== $family full $(date -u +%T)"
  bun run src/run.ts --family="$family" $smoke --output="results-$family-$suffix.json"
  echo "== $family catalog $(date -u +%T)"
  bun run src/catalog.ts --family="$family" $smoke --output="results-$family-catalog-$suffix.json"
done
if [ -z "$smoke" ] && [ "$families" = "postgis archive" ]; then
  echo "== verdict $(date -u +%T)"
  bun run src/analysis.ts --suffix="$suffix" > "verdict-$suffix.txt" 2>&1 || true
fi

for f in results-*-"$suffix".json verdict-"$suffix".txt; do
  [ -e "$f" ] && aws s3 cp "$f" "$s3/results/$run_id/$f" --only-show-errors
done
echo "DONE $(date -u +%FT%TZ)"
