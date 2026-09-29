#!/usr/bin/env bash
# Offline preflight before any dispatch: shellcheck every script and the synthesized user data,
# render the SSM command a run would send, and confirm every image a run needs exists locally.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
echo "1. scripts"
shellcheck -x -s bash scripts/*.sh
echo "2. user data from the synthesized stack"
(cd infra && bun x cdk synth --quiet >/dev/null)
tmp=$(mktemp)
jq -r '.Resources[] | select(.Type == "AWS::EC2::LaunchTemplate") | .Properties.LaunchTemplateData.UserData["Fn::Base64"]' infra/cdk.out/WarefeatsMartin2Bench.template.json > "$tmp"
head -1 "$tmp" | grep -q '^#!/bin/bash' || { echo "user data has no bash shebang" >&2; exit 1; }
shellcheck -s bash "$tmp"
grep -q 'shutdown -h +' "$tmp" || { echo "user data lost its safety shutdown" >&2; exit 1; }
grep -q 'martin-2-bench-ready' "$tmp" || { echo "user data lost its ready marker" >&2; exit 1; }
jq -e '.Resources[] | select(.Type == "AWS::EC2::LaunchTemplate") | .Properties.LaunchTemplateData.InstanceInitiatedShutdownBehavior == "terminate"' infra/cdk.out/WarefeatsMartin2Bench.template.json >/dev/null || { echo "shutdown does not terminate" >&2; exit 1; }
echo "3. the SSM command for a sample run"
cmd="aws s3 cp s3://BUCKET/bundles/RUN/remote.sh /root/remote.sh --only-show-errors && bash /root/remote.sh BUCKET RUN wf-martin:2.0.0-int17 --smoke"
jq -n --arg c "$cmd" '{commands: [$c], executionTimeout: ["36000"]}' | jq -e '.commands[0] | startswith("aws s3 cp")' >/dev/null
bash -n scripts/remote.sh
echo "4. images a run needs"
for image in wf-client:1 wf-bbox:0.6.2 wf-mbtileserver:0.11.0 "${WF_MARTIN_2_IMAGE:-wf-martin:2.0.0-int17}"; do
  docker image inspect "$image" --format '{{.Architecture}}' | grep -qx arm64 || { echo "$image missing or not arm64" >&2; exit 1; }
done
grep -oE 'docker pull [^ ]+' justfile | awk '{ print $3 }' | grep -q . || { echo "the justfile names no published images" >&2; exit 1; }
[ -s data/cache/berlin.pmtiles ] && [ -s data/cache/berlin.mbtiles ] || { echo "archives missing" >&2; exit 1; }
docker volume inspect m2-dbdata >/dev/null || { echo "database volume missing" >&2; exit 1; }
echo "rig-walk: all good"
