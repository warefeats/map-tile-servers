# Shared by the rig scripts: a working aws CLI and the stack's outputs.
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
