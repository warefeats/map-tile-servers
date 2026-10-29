import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

/**
 * Dedicated Graviton hosts that each run whole families of the harness (database, engines and client on
 * one Docker network, as on the Mac), driven over SSM by the rig workflow (.github/workflows/rig.yml).
 * The bucket carries the bundle in (repo, images, database volume, archives), the Martin image from the
 * host that builds it to the others, and the results out. No VPC lookup: the instances launch into the
 * default VPC with its default security group, which only needs outbound traffic.
 */
export class Martin2BenchStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const instanceType = this.node.tryGetContext("instanceType") ?? "c7g.metal";

    const bucket = new s3.Bucket(this, "RigBucket", {
      // the inputs every run names (scripts/rig-inputs.txt) stay; a run's own objects expire
      lifecycleRules: [
        { prefix: "bundles/", expiration: cdk.Duration.days(30) },
        { prefix: "images/", expiration: cdk.Duration.days(30) },
        { prefix: "results/", expiration: cdk.Duration.days(90) },
      ],
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      enforceSSL: true,
    });

    const role = new iam.Role(this, "InstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")],
    });
    bucket.grantReadWrite(role);

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      "set -euxo pipefail",
      // the harness never needs more than a few hours; a forgotten instance terminates itself
      "shutdown -h +600",
      "export DEBIAN_FRONTEND=noninteractive",
      // unattended-upgrades runs at first boot and holds the dpkg lock for a while
      "while fuser /var/lib/dpkg/lock-frontend /var/lib/apt/lists/lock >/dev/null 2>&1; do sleep 5; done",
      "apt-get update -y",
      // buildx: the Martin image build needs BuildKit, which sets TARGETPLATFORM for its Dockerfile
      "apt-get install -y docker.io docker-compose-v2 docker-buildx git jq curl unzip zstd",
      "systemctl enable docker && systemctl start docker",
      // nothing but the benchmark runs on the host: no package updates in the middle of a measurement
      "systemctl disable --now unattended-upgrades.service apt-daily.timer apt-daily-upgrade.timer || true",
      // Ubuntu 24.04 has no awscli package; install v2 from Amazon, for this machine's architecture
      'curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o /tmp/awscliv2.zip',
      "unzip -q /tmp/awscliv2.zip -d /tmp",
      "/tmp/aws/install",
      "rm -rf /tmp/awscliv2.zip /tmp/aws",
      // the same bun as the laptop that produced every earlier run
      'curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash -s "bun-v1.4.0"',
      "touch /var/lib/martin-2-bench-ready",
    );

    const lt = new ec2.LaunchTemplate(this, "BenchLt", {
      instanceType: new ec2.InstanceType(instanceType),
      machineImage: ec2.MachineImage.fromSsmParameter(
        "/aws/service/canonical/ubuntu/server/24.04/stable/current/arm64/hvm/ebs-gp3/ami-id",
      ),
      role,
      userData,
      blockDevices: [
        {
          deviceName: "/dev/sda1",
          volume: ec2.BlockDeviceVolume.ebs(100, { volumeType: ec2.EbsDeviceVolumeType.GP3 }),
        },
      ],
      requireImdsv2: true,
    });
    (lt.node.defaultChild as ec2.CfnLaunchTemplate).addPropertyOverride(
      "LaunchTemplateData.InstanceInitiatedShutdownBehavior",
      "terminate",
    );

    // The archive lane of docs/adr/0011: each server alone on a 4-vCPU instance of either architecture,
    // the load generator on a network-optimized one, all in one cluster placement group, gp3 at its defaults.
    const lane = new ec2.CfnPlacementGroup(this, "LanePlacement", { strategy: "cluster" });
    const ubuntu = (arch: "arm64" | "amd64") =>
      ec2.MachineImage.fromSsmParameter(`/aws/service/canonical/ubuntu/server/24.04/stable/current/${arch}/hvm/ebs-gp3/ami-id`);
    const laneTemplate = (id: string, type: string, arch: "arm64" | "amd64", gb: number) => {
      const t = new ec2.LaunchTemplate(this, id, {
        instanceType: new ec2.InstanceType(type),
        machineImage: ubuntu(arch),
        role,
        userData,
        blockDevices: [{ deviceName: "/dev/sda1", volume: ec2.BlockDeviceVolume.ebs(gb, { volumeType: ec2.EbsDeviceVolumeType.GP3 }) }],
        requireImdsv2: true,
      });
      const cfn = t.node.defaultChild as ec2.CfnLaunchTemplate;
      cfn.addPropertyOverride("LaunchTemplateData.InstanceInitiatedShutdownBehavior", "terminate");
      cfn.addPropertyOverride("LaunchTemplateData.Placement.GroupName", lane.ref);
      new cdk.CfnOutput(this, `${id}Id`, { value: t.launchTemplateId! });
    };
    // a planet archive (MBTiles 103 GB, PMTiles 87 GB) and the system fit in 200 GB
    laneTemplate("LaneServerArm", "c8g.xlarge", "arm64", 200);
    laneTemplate("LaneServerX86", "c8i.xlarge", "amd64", 200);
    laneTemplate("LaneClient", "c8gn.xlarge", "arm64", 30);
    new cdk.CfnOutput(this, "LanePlacementGroup", { value: lane.ref });

    new cdk.CfnOutput(this, "LaunchTemplateId", { value: lt.launchTemplateId! });
    new cdk.CfnOutput(this, "RigBucketName", { value: bucket.bucketName });
    new cdk.CfnOutput(this, "InstanceType", { value: instanceType });
  }
}
