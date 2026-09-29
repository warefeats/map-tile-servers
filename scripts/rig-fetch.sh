#!/usr/bin/env bash
# Copies one run's results into the repo (results-*-<run id>.json, verdict-<run id>.txt) and its log into .work/rig.
set -euo pipefail
run_id=$1
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
# shellcheck source=scripts/rig-lib.sh
. scripts/rig-lib.sh
bucket=$(stack_output RigBucketName)
mkdir -p ".work/rig/$run_id"
aws s3 cp "s3://$bucket/results/$run_id/run.log" ".work/rig/$run_id/run.log" --only-show-errors
aws s3 cp "s3://$bucket/results/$run_id/" . --recursive --exclude run.log --only-show-errors
ls results-*-"$run_id".json verdict-"$run_id".txt 2>/dev/null
