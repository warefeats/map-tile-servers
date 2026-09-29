#!/usr/bin/env bash
# Launches one rig instance and starts remote.sh on it over SSM.
#   rig-run.sh <run id> <martin 2.0.0 image> [--smoke] [--families=postgis,archive]
# INSTANCE_TYPE overrides the launch template's type.
set -euo pipefail
run_id=$1; image=$2; shift 2
root=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=scripts/rig-lib.sh
. "$root/scripts/rig-lib.sh"
bucket=$(stack_output RigBucketName)
lt=$(stack_output LaunchTemplateId)
aws s3 ls "s3://$bucket/bundles/$run_id/remote.sh" >/dev/null || { echo "no bundle for $run_id: rig-pack it first" >&2; exit 1; }
type_args=()
[ -n "${INSTANCE_TYPE:-}" ] && type_args=(--instance-type "$INSTANCE_TYPE")
tags="ResourceType=instance,Tags=[{Key=Project,Value=martin-2-bench},{Key=RunId,Value=$run_id}]"
err=$(mktemp)
instance=""
# metal capacity differs by zone, so try each default subnet until one launches
for subnet in $(aws ec2 describe-subnets --filters Name=default-for-az,Values=true --query 'Subnets[].SubnetId' --output text); do
  if instance=$(aws ec2 run-instances --launch-template "LaunchTemplateId=$lt,Version=\$Latest" "${type_args[@]}" --subnet-id "$subnet" --tag-specifications "$tags" --query 'Instances[0].InstanceId' --output text 2>"$err"); then
    break
  fi
  instance=""
  grep -q -E "InsufficientInstanceCapacity|Unsupported" "$err" || { cat "$err" >&2; exit 1; }
  echo "no capacity in $subnet, trying the next zone"
done
[ -n "$instance" ] || { echo "no zone had capacity" >&2; exit 1; }
echo "instance $instance"
# SSM comes up before user data finishes; remote.sh waits for user data itself
for _ in $(seq 1 120); do
  ping=$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$instance" --query 'InstanceInformationList[0].PingStatus' --output text 2>/dev/null || true)
  [ "$ping" = Online ] && break
  sleep 10
done
[ "$ping" = Online ] || { echo "SSM never came online on $instance" >&2; exit 1; }
cmd="aws s3 cp s3://$bucket/bundles/$run_id/remote.sh /root/remote.sh --only-show-errors && bash /root/remote.sh $bucket $run_id $image $*"
params=$(jq -n --arg c "$cmd" '{commands: [$c], executionTimeout: ["36000"]}')
command=$(aws ssm send-command --instance-ids "$instance" --document-name AWS-RunShellScript --parameters "$params" --query 'Command.CommandId' --output text)
echo "command $command"
echo "follow with: just rig-log $run_id"
