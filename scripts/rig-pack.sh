#!/usr/bin/env bash
# Packs one run's inputs and uploads them: the committed tree, the locally built images, a consistent
# copy of the database volume, the two archives and remote.sh.   rig-pack.sh <run id> <martin 2.0.0 image>
set -euo pipefail
run_id=$1; image=$2
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
# shellcheck source=scripts/rig-lib.sh
. scripts/rig-lib.sh
[ -z "$(git status --porcelain)" ] || { echo "commit first: the rig runs the committed tree" >&2; exit 1; }
bucket=$(stack_output RigBucketName)
stage=.work/rig/$run_id
mkdir -p "$stage"
git archive --format=tar.gz -o "$stage/repo.tar.gz" HEAD
docker save wf-client:1 wf-bbox:0.6.2 wf-mbtileserver:0.11.0 "$image" | zstd -T0 -3 -q -f -o "$stage/images.tar.zst"
# the database stops for the copy, so its files are consistent, and starts again after
running=$(docker inspect -f '{{.State.Running}}' m2-db 2>/dev/null || echo false)
[ "$running" = true ] && docker stop m2-db >/dev/null
docker run --rm -v m2-dbdata:/v:ro --entrypoint tar imresamu/postgis:18-3.6 -C /v -cf - . | zstd -T0 -3 -q -f -o "$stage/dbdata.tar.zst"
[ "$running" = true ] && docker start m2-db >/dev/null
cp data/cache/berlin.mbtiles data/cache/berlin.pmtiles scripts/remote.sh "$stage/"
du -sh "$stage"/*
aws s3 cp "$stage/" "s3://$bucket/bundles/$run_id/" --recursive --only-show-errors
echo "packed $run_id at $(git rev-parse --short HEAD) with $image"
