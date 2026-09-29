# Shared by the rig scripts: the stack's outputs.
stack_output() {
  aws cloudformation describe-stacks --stack-name WarefeatsMartin2Bench --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
