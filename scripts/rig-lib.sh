# Shared by the rig scripts and the rig workflow: a working aws CLI, the stack's outputs, input keys and the SSM command.
export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-us-east-1}

# The first aws on PATH that runs: an old x86_64 install can shadow the native one on Apple silicon.
AWS_BIN=""
while read -r candidate; do
  if "$candidate" --version >/dev/null 2>&1; then AWS_BIN=$candidate; break; fi
done < <(which -a aws)
[ -n "$AWS_BIN" ] || { echo "no working aws CLI on PATH" >&2; exit 1; }
aws() { "$AWS_BIN" "$@"; }

stack_output() {
  aws cloudformation describe-stacks --stack-name WarefeatsMartin2Bench --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

# The bucket key of an input: a hash of its bytes, so scripts/rig-inputs.txt pins the corpus.
input_key() {
  local sum
  if command -v sha256sum >/dev/null; then sum=$(sha256sum "$2"); else sum=$(shasum -a 256 "$2"); fi
  echo "inputs/${sum:0:16}-$1"
}

# The command SSM runs on the instance. SSM is online before user data installs the AWS CLI, and runs
# this under dash with a minimal PATH, so it waits for the ready marker before the first aws call.
ssm_command() {
  local bucket=$1 run_id=$2 image=$3; shift 3
  printf '%s' "export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin; for i in \$(seq 1 240); do [ -e /var/lib/martin-2-bench-ready ] && break; sleep 5; done; aws s3 cp s3://$bucket/bundles/$run_id/remote.sh /root/remote.sh --only-show-errors && bash /root/remote.sh $bucket $run_id $image $*"
}
