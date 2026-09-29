import * as cdk from "aws-cdk-lib";
import { Martin2BenchStack } from "../lib/martin-2-bench-stack.js";

const app = new cdk.App();
new Martin2BenchStack(app, "WarefeatsMartin2Bench", {
  env: {
    account: process.env["CDK_DEFAULT_ACCOUNT"],
    region: process.env["CDK_DEFAULT_REGION"],
  },
});
