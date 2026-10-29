#!/usr/bin/env bash
# Offline preflight before any dispatch: shellcheck every script and the synthesized user data, render the SSM
# command a run would send, check that every image a compose file runs is one the rig loads or pulls, and
# confirm the inputs a pack would upload exist.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
echo "1. scripts"
shellcheck -x -s bash scripts/rig-*.sh scripts/remote.sh scripts/build-martin-pgo.sh
echo "2. user data from the synthesized stack"
(cd infra && bun x cdk synth --quiet >/dev/null)
tmp=$(mktemp)
jq -r '.Resources[] | select(.Type == "AWS::EC2::LaunchTemplate") | .Properties.LaunchTemplateData.UserData["Fn::Base64"]' infra/cdk.out/WarefeatsMartin2Bench.template.json > "$tmp"
head -1 "$tmp" | grep -q '^#!/bin/bash' || { echo "user data has no bash shebang" >&2; exit 1; }
shellcheck -s bash "$tmp"
grep -q 'shutdown -h +' "$tmp" || { echo "user data lost its safety shutdown" >&2; exit 1; }
grep -q 'martin-2-bench-ready' "$tmp" || { echo "user data lost its ready marker" >&2; exit 1; }
grep -q 'docker-buildx' "$tmp" || { echo "user data has no buildx: the Martin image build needs BuildKit for TARGETPLATFORM" >&2; exit 1; }
jq -e '.Resources[] | select(.Type == "AWS::EC2::LaunchTemplate") | .Properties.LaunchTemplateData.InstanceInitiatedShutdownBehavior == "terminate"' infra/cdk.out/WarefeatsMartin2Bench.template.json >/dev/null || { echo "shutdown does not terminate" >&2; exit 1; }
echo "3. the SSM command for a sample run"
# shellcheck source=scripts/rig-lib.sh
. scripts/rig-lib.sh
image=$(bun -e "import { MARTIN_2 } from './src/matrix'; console.log(MARTIN_2.image)")
cmd=$(ssm_command BUCKET RUN "$image" --families=postgis --build=SHA:1.99.1 --smoke-first)
# the command must wait for user data before its first aws call, and run under dash
jq -n --arg c "$cmd" '{commands: [$c], executionTimeout: ["36000"]}' | jq -e --arg i "$image" '.commands[0] | (index("martin-2-bench-ready") < index("aws s3 cp")) and contains("bash /root/remote.sh BUCKET RUN " + $i + " --families=postgis --build=SHA:1.99.1 --smoke-first")' >/dev/null
printf '%s\n' "$cmd" > "$tmp.cmd"
if command -v dash >/dev/null; then dash -n "$tmp.cmd"; else sh -n "$tmp.cmd"; fi
bash -n scripts/remote.sh
# the snippets remote.sh evaluates on the host
bun -e "import { DB_IMAGE } from './src/docker'; import { CANDIDATES, MARTIN_2 } from './src/matrix'; if (!DB_IMAGE.includes('@sha256:') || !MARTIN_2.version || CANDIDATES.length < 19) process.exit(1)"
echo "4. images"
# every image a compose file runs is either a local build the bundle carries, Martin 2.0, or a pull the justfile names
pulls=$(grep -oE 'docker pull [^ ]+' justfile | awk '{ print $3 }')
grep -rhoE '^\s+image: *[^ ]+' compose | awk '{ print $2 }' | sort -u | while read -r ref; do
  case "$ref" in
    wf-client:1 | wf-bbox:0.6.2 | wf-mbtileserver:0.11.0 | \$\{WF_MARTIN_2_IMAGE:*) ;;
    *) grep -qxF "$ref" <<< "$pulls" || { echo "compose runs $ref, which the rig neither loads nor pulls" >&2; exit 1; } ;;
  esac
done
grep -qxF "$(bun -e "import { FLOOR_IMAGE } from './src/matrix'; console.log(FLOOR_IMAGE)")" <<< "$pulls" || { echo "the floor image is not pulled" >&2; exit 1; }
if command -v docker >/dev/null; then
  for ref in wf-client:1 wf-bbox:0.6.2 wf-mbtileserver:0.11.0; do
    docker image inspect "$ref" --format '{{.Architecture}}' | grep -qx arm64 || { echo "$ref missing or not arm64" >&2; exit 1; }
  done
  docker volume inspect m2-dbdata >/dev/null || { echo "database volume missing" >&2; exit 1; }
else
  for f in "${IMAGES:?no Docker here: IMAGES names the saved helper images}" "${DBDATA:?no Docker here: DBDATA names the saved database volume}"; do
    [ -s "$f" ] || { echo "$f missing" >&2; exit 1; }
  done
  zstd -dc "$IMAGES" | tar -xOf - manifest.json | jq -e '[.[].RepoTags[]] | contains(["wf-client:1", "wf-bbox:0.6.2", "wf-mbtileserver:0.11.0"])' >/dev/null || { echo "$IMAGES lacks a helper image" >&2; exit 1; }
fi
[ -s data/cache/berlin.pmtiles ] && [ -s data/cache/berlin.mbtiles ] || { echo "archives missing" >&2; exit 1; }
echo "rig-walk: all good"
