#!/usr/bin/env bash
# Copies one OpenFreeMap planet file into the rig bucket (docs/adr/0011) as a multipart upload of ranged parts,
# each fetched and retried on its own: OpenFreeMap's CDN reset a single 100 GB stream 11 and 15 minutes in on
# 2026-10-29 (curl 92), and `aws s3 cp -` then completed the upload with the truncated stream. The parts pass
# through the runner's disk one at a time, in order, through one sha256, which must match the build's own
# SHA256SUMS; the object appears only when every part is in, and a failure aborts the upload.
#   scripts/rig-stage-planet.sh <bucket> <version> <format>
set -euo pipefail

bucket=$1 version=$2 format=$3
base="https://btrfs.openfreemap.com/areas/planet/$version"
url="$base/tiles.$format"
key="inputs/openfreemap-planet-$version.$format"
part_bytes=$((512 * 1024 * 1024))
work=${RUNNER_TEMP:-/tmp}/stage-$format
mkdir -p "$work"
export AWS_RETRY_MODE=standard AWS_MAX_ATTEMPTS=10

size=$(curl -fsSI "$url" | tr -d '\r' | awk 'tolower($1) == "content-length:" { print $2 }')
[ -n "$size" ] || { echo "::error::no size for $url"; exit 1; }
want=$(curl -fsS "$base/SHA256SUMS" | awk -v f="tiles.$format" '$2 == f { print $1 }')
[ -n "$want" ] || { echo "::error::the build's SHA256SUMS names no tiles.$format"; exit 1; }
if [ "$(aws s3api head-object --bucket "$bucket" --key "$key" --query ContentLength --output text 2>/dev/null || true)" = "$size" ] &&
  [ "$(aws s3 cp "s3://$bucket/$key.sha256" - 2>/dev/null | cut -d' ' -f1)" = "$want" ]; then
  echo "$key is already in the bucket ($size bytes, sha256 $want)"
  exit 0
fi
parts=$(((size + part_bytes - 1) / part_bytes))
echo "copying $url ($size bytes, $parts parts of $part_bytes) to s3://$bucket/$key"

upload=$(aws s3api create-multipart-upload --bucket "$bucket" --key "$key" --query UploadId --output text)
trap 'aws s3api abort-multipart-upload --bucket "$bucket" --key "$key" --upload-id "$upload" || true' EXIT
sum=$work/sha256
rm -f "$sum"
exec 3> >(sha256sum | cut -d' ' -f1 >"$sum")

# part n → $work/part.<n>, exactly its bytes; a server that ignored the range would send more than the limit
fetch() {
  local n=$1 first last bytes attempt
  first=$(((n - 1) * part_bytes))
  last=$((first + part_bytes - 1))
  ((last < size)) || last=$((size - 1))
  bytes=$((last - first + 1))
  for attempt in 1 2 3 4 5 6 7 8; do
    if curl -fsS --connect-timeout 30 --speed-limit 1000000 --speed-time 60 --max-filesize "$bytes" \
      -r "$first-$last" -o "$work/part.$n" "$url" && [ "$(stat -c %s "$work/part.$n")" = "$bytes" ]; then
      return 0
    fi
    echo "part $n: attempt $attempt failed"
    sleep $((attempt * 10))
  done
  echo "::error::part $n of $key failed eight times"
  return 1
}

# part n → its ETag in $work/etag.<n>
put() {
  aws s3api upload-part --bucket "$bucket" --key "$key" --upload-id "$upload" --part-number "$1" \
    --body "$work/part.$1" --query ETag --output text >"$work/etag.$1"
  rm -f "$work/part.$1"
}

# fetch part n while part n-1 uploads
pid=
start=$(date +%s)
for ((n = 1; n <= parts; n++)); do
  fetch "$n"
  cat "$work/part.$n" >&3
  [ -z "$pid" ] || wait "$pid"
  put "$n" &
  pid=$!
  ((n % 10)) || echo "part $n of $parts, $(((n * part_bytes) / ($(date +%s) - start + 1) / 1000000)) MB/s"
done
wait "$pid"
exec 3>&-

for ((n = 1; n <= parts; n++)); do
  jq -n --arg etag "$(cat "$work/etag.$n")" --argjson n "$n" '{ETag: $etag, PartNumber: $n}'
done | jq -s '{Parts: .}' >"$work/parts.json"
aws s3api complete-multipart-upload --bucket "$bucket" --key "$key" --upload-id "$upload" \
  --multipart-upload "file://$work/parts.json" >/dev/null
trap - EXIT

for _ in $(seq 1 60); do [ -s "$sum" ] && break; sleep 1; done
[ -s "$sum" ] || { echo "::error::no sha256 for $key"; exit 1; }
got=$(aws s3api head-object --bucket "$bucket" --key "$key" --query ContentLength --output text)
[ "$got" = "$size" ] || { echo "::error::$key has $got bytes, the source has $size"; exit 1; }
if [ "$(cat "$sum")" != "$want" ]; then
  aws s3 rm "s3://$bucket/$key" --only-show-errors
  echo "::error::$key had sha256 $(cat "$sum"), the build's SHA256SUMS says $want; removed"
  exit 1
fi
printf '%s  %s\n' "$(cat "$sum")" "$size" | aws s3 cp - "s3://$bucket/$key.sha256" --only-show-errors
echo "$key: sha256 $(cat "$sum"), $size bytes in $(($(date +%s) - start)) s"
