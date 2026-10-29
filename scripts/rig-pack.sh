#!/usr/bin/env bash
# Packs one run and uploads it: the committed tree, remote.sh and the inputs the run names (the locally built
# helper images, a consistent copy of the database volume, the two archives). Each input uploads once, under a
# hash of its bytes, and later runs name it again.   rig-pack.sh <run id>
# Martin 2.0 is not packed: the rig builds it (docs/adr/0010). On a host without Docker, IMAGES and DBDATA name
# saved copies, e.g. IMAGES=.work/rig/c17/images.tar.zst DBDATA=.work/rig/c17/dbdata.tar.zst.
set -euo pipefail
run_id=$1
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
# shellcheck source=scripts/rig-lib.sh
. scripts/rig-lib.sh
[ -z "$(git status --porcelain)" ] || { echo "commit first: the rig runs the committed tree" >&2; exit 1; }
bucket=$(stack_output RigBucketName)
stage=.work/rig/$run_id
mkdir -p "$stage"
git archive --format=tar.gz -o "$stage/repo.tar.gz" HEAD
cp scripts/remote.sh "$stage/"
images=${IMAGES:-}
if [ -z "$images" ]; then
  images=$stage/images.tar.zst
  docker save wf-client:1 wf-bbox:0.6.2 wf-mbtileserver:0.11.0 | zstd -T0 -3 -q -f -o "$images"
fi
dbdata=${DBDATA:-}
if [ -z "$dbdata" ]; then
  dbdata=$stage/dbdata.tar.zst
  # the database stops for the copy, so its files are consistent, and starts again after
  db_image=$(bun -e "import { DB_IMAGE } from './src/docker'; console.log(DB_IMAGE)")
  running=$(docker inspect -f '{{.State.Running}}' m2-db 2>/dev/null || echo false)
  [ "$running" = true ] && docker stop m2-db >/dev/null
  docker run --rm -v m2-dbdata:/v:ro --entrypoint tar "$db_image" -C /v -cf - . | zstd -T0 -3 -q -f -o "$dbdata"
  [ "$running" = true ] && docker start m2-db >/dev/null
fi
digest() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -c1-16; }
: > "$stage/inputs.txt"
for pair in "images.tar.zst=$images" "dbdata.tar.zst=$dbdata" "berlin.mbtiles=data/cache/berlin.mbtiles" "berlin.pmtiles=data/cache/berlin.pmtiles"; do
  name=${pair%%=*}; file=${pair#*=}
  [ -s "$file" ] || { echo "missing $file" >&2; exit 1; }
  key=inputs/$(digest "$file")-$name
  if aws s3 ls "s3://$bucket/$key" >/dev/null 2>&1; then echo "$name: already uploaded as $key"; else
    echo "$name: uploading $(du -h "$file" | cut -f1) as $key"
    aws s3 cp "$file" "s3://$bucket/$key" --only-show-errors
  fi
  echo "$name $key" >> "$stage/inputs.txt"
done
for f in repo.tar.gz remote.sh inputs.txt; do aws s3 cp "$stage/$f" "s3://$bucket/bundles/$run_id/$f" --only-show-errors; done
echo "packed $run_id at $(git rev-parse --short HEAD)"
