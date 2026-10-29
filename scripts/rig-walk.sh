#!/usr/bin/env bash
# Offline preflight before any dispatch: shellcheck every rig script and the synthesized user data, lint the
# workflow, render the SSM command a host gets, check that every image a compose file runs is one the rig loads
# or pulls, and check the inputs scripts/rig-inputs.txt pins against the local copies.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
echo "1. scripts and the workflow"
shellcheck -x -s bash scripts/rig-*.sh scripts/remote.sh scripts/build-martin-pgo.sh
actionlint .github/workflows/*.yml
echo "2. user data from the synthesized stack"
(cd infra && bun x cdk synth --quiet >/dev/null)
tmp=$(mktemp)
# every launch template shares one user data
jq -r '[.Resources[] | select(.Type == "AWS::EC2::LaunchTemplate") | .Properties.LaunchTemplateData.UserData["Fn::Base64"]] | first' infra/cdk.out/WarefeatsMartin2Bench.template.json > "$tmp"
head -1 "$tmp" | grep -q '^#!/bin/bash' || { echo "user data has no bash shebang" >&2; exit 1; }
shellcheck -s bash "$tmp"
grep -q 'shutdown -h +' "$tmp" || { echo "user data lost its safety shutdown" >&2; exit 1; }
grep -q 'martin-2-bench-ready' "$tmp" || { echo "user data lost its ready marker" >&2; exit 1; }
grep -q 'docker-buildx' "$tmp" || { echo "user data has no buildx: the Martin image build needs BuildKit for TARGETPLATFORM" >&2; exit 1; }
jq -e '[.Resources[] | select(.Type == "AWS::EC2::LaunchTemplate") | .Properties.LaunchTemplateData.InstanceInitiatedShutdownBehavior == "terminate"] | all' infra/cdk.out/WarefeatsMartin2Bench.template.json >/dev/null || { echo "a launch template's shutdown does not terminate" >&2; exit 1; }
grep -qF "awscli-exe-linux-\$(uname -m).zip" "$tmp" || { echo "user data installs the AWS CLI for one architecture only" >&2; exit 1; }
# the archive lane (docs/adr/0011): servers on c8g.xlarge and c8i.xlarge, the client on c8gn.xlarge, one placement group
jq -e '[.Resources[] | select(.Type == "AWS::EC2::LaunchTemplate") | .Properties.LaunchTemplateData | select(.Placement.GroupName) | .InstanceType] | sort == ["c8g.xlarge", "c8gn.xlarge", "c8i.xlarge"]' infra/cdk.out/WarefeatsMartin2Bench.template.json >/dev/null || { echo "the lane's launch templates are not c8g.xlarge, c8i.xlarge and c8gn.xlarge in a placement group" >&2; exit 1; }
jq -e '[.Resources[] | select(.Type == "AWS::S3::Bucket") | .Properties.LifecycleConfiguration.Rules[] | .Prefix] | sort == ["bundles/", "images/", "results/"]' infra/cdk.out/WarefeatsMartin2Bench.template.json >/dev/null || { echo "the bucket's lifecycle would expire the inputs" >&2; exit 1; }
echo "3. the SSM command a building PostGIS host gets"
# shellcheck source=scripts/rig-lib.sh
. scripts/rig-lib.sh
image=$(bun -e "import { MARTIN_2 } from './src/matrix'; console.log(MARTIN_2.image)")
cmd=$(ssm_command BUCKET RUN "$image" --families=postgis --build=SHA:1.99.1 --smoke)
# the command must wait for user data before its first aws call, and run under dash
jq -n --arg c "$cmd" '{commands: [$c], executionTimeout: ["36000"]}' | jq -e --arg i "$image" '.commands[0] | (index("martin-2-bench-ready") < index("aws s3 cp")) and contains("bash /root/remote.sh BUCKET RUN " + $i + " --families=postgis --build=SHA:1.99.1 --smoke")' >/dev/null
printf '%s\n' "$cmd" > "$tmp.cmd"
if command -v dash >/dev/null; then dash -n "$tmp.cmd"; else sh -n "$tmp.cmd"; fi
bash -n scripts/remote.sh
# the snippets the workflow and remote.sh evaluate, and an image tag that names the commit the rig builds
bun -e "import { DB_IMAGE } from './src/docker'; import { CANDIDATES, MARTIN_2, MARTIN_2_BUILD } from './src/matrix'; if (!DB_IMAGE.includes('@sha256:') || !MARTIN_2.version || CANDIDATES.length < 19 || !/^[0-9a-f]{40}$/.test(MARTIN_2_BUILD.commit) || !MARTIN_2_BUILD.rustc || !MARTIN_2.image.endsWith(MARTIN_2.version + '-' + MARTIN_2_BUILD.commit.slice(0, 7))) process.exit(1)"
echo "4. images"
# every image a compose file runs is either a local build the inputs carry, Martin 2.0, or a pull the justfile names
pulls=$(grep -oE 'docker pull [^ ]+' justfile | awk '{ print $3 }')
grep -rhoE '^\s+image: *[^ ]+' compose | awk '{ print $2 }' | sort -u | while read -r ref; do
  case "$ref" in
    wf-client:1 | wf-bbox:0.6.2 | wf-mbtileserver:0.11.0 | \$\{WF_MARTIN_2_IMAGE:*) ;;
    *) grep -qxF "$ref" <<< "$pulls" || { echo "compose runs $ref, which the rig neither loads nor pulls" >&2; exit 1; } ;;
  esac
done
grep -qxF "$(bun -e "import { FLOOR_IMAGE } from './src/matrix'; console.log(FLOOR_IMAGE)")" <<< "$pulls" || { echo "the floor image is not pulled" >&2; exit 1; }
echo "5. inputs"
[ "$(awk '{ print $1 }' scripts/rig-inputs.txt | sort | tr '\n' ' ')" = "berlin.mbtiles berlin.pmtiles dbdata.tar.zst images.tar.zst " ] || { echo "scripts/rig-inputs.txt must name the four inputs remote.sh reads" >&2; exit 1; }
images=${IMAGES:-.work/rig/c17/images.tar.zst}
dbdata=${DBDATA:-.work/rig/c17/dbdata.tar.zst}
while read -r name key <&3; do
  case "$name" in images.tar.zst) file=$images ;; dbdata.tar.zst) file=$dbdata ;; *) file=data/cache/$name ;; esac
  if [ -s "$file" ]; then
    [ "$(input_key "$name" "$file")" = "$key" ] || { echo "$file is not the $name scripts/rig-inputs.txt pins ($key)" >&2; exit 1; }
  else
    echo "  no local $name to check ($file); the workflow checks the bucket has $key"
  fi
done 3< scripts/rig-inputs.txt
if [ -s "$images" ]; then
  zstd -dc "$images" | tar -xOf - manifest.json | jq -e '[.[].RepoTags[]] | contains(["wf-client:1", "wf-bbox:0.6.2", "wf-mbtileserver:0.11.0"])' >/dev/null || { echo "$images lacks a helper image" >&2; exit 1; }
fi
echo "rig-walk: all good"
