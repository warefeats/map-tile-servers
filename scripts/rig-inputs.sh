#!/usr/bin/env bash
# Uploads the inputs scripts/rig-inputs.txt names (the helper images, the database volume, the two archives), each
# once, under a hash of its bytes; every run's bundle names them by those keys. Needs AWS credentials, like the stack.
# IMAGES and DBDATA name the saved helper images and database volume (default: the 2026-09-28 copies in .work/rig/c17/).
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
# shellcheck source=scripts/rig-lib.sh
. scripts/rig-lib.sh
bucket=$(stack_output RigBucketName)
local_copy() {
  case "$1" in
    images.tar.zst) echo "${IMAGES:-.work/rig/c17/images.tar.zst}" ;;
    dbdata.tar.zst) echo "${DBDATA:-.work/rig/c17/dbdata.tar.zst}" ;;
    *) echo "data/cache/$1" ;;
  esac
}
while read -r name key <&3; do
  file=$(local_copy "$name")
  [ -s "$file" ] || { echo "missing $file" >&2; exit 1; }
  [ "$(input_key "$name" "$file")" = "$key" ] || { echo "$file is not the $name scripts/rig-inputs.txt pins ($key)" >&2; exit 1; }
  if aws s3api head-object --bucket "$bucket" --key "$key" >/dev/null 2>&1; then echo "$name: already uploaded as $key"; else
    echo "$name: uploading $(du -h "$file" | cut -f1) as $key"
    aws s3 cp "$file" "s3://$bucket/$key" --only-show-errors
  fi
done 3< scripts/rig-inputs.txt
