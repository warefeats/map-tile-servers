/**
 * What the archive lane's orchestrator asks of AWS, behind an interface so the unit flow can be tested without
 * it. The implementation drives the AWS CLI. Two watchers poll for every unit at once, so the API calls a cycle
 * makes stay level however many units run: one DescribeInstanceInformation per 50 instances waiting for SSM, and
 * one ListCommands for every command still executing, with a GetCommandInvocation only for those that finished.
 */
import { basename } from "node:path";
import { q, waitReady } from "./shell";

export interface Host {
  id: string;
  ip: string;
  az: string;
  subnet: string;
}

export interface LaunchRequest {
  template: string;
  placementGroup: string;
  /** Tried in order until one has capacity. */
  subnets: readonly string[];
  tags: Record<string, string>;
}

export interface CommandResult {
  status: string;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  timeoutS: number;
  /** Where SSM writes the command's full output in the bucket. */
  outputPrefix: string;
  comment: string;
}

export interface Cloud {
  createPlacementGroup(name: string, tags: Record<string, string>): Promise<void>;
  launch(r: LaunchRequest): Promise<Host>;
  waitOnline(instanceId: string, timeoutMs: number): Promise<void>;
  /** Runs a script from the bucket on an instance and waits for it to end. */
  run(instanceId: string, scriptKey: string, opts: RunOptions): Promise<CommandResult>;
  terminate(instanceIds: readonly string[]): Promise<void>;
  putText(key: string, text: string): Promise<void>;
}

export class CapacityError extends Error {}

export class AwsError extends Error {
  constructor(
    readonly op: string,
    readonly stderr: string,
  ) {
    super(`aws ${op}: ${stderr.trim().split("\n").at(-1) ?? ""}`);
  }
}

/** One AWS CLI call: JSON out, adaptive retries for throttling, the CLI's own message on failure. */
export async function aws<T = unknown>(args: readonly string[], stdin?: string): Promise<T> {
  const p = Bun.spawn(["aws", ...args, "--output", "json"], {
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, AWS_RETRY_MODE: "adaptive", AWS_MAX_ATTEMPTS: "10", AWS_PAGER: "" },
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new AwsError(args.slice(0, 2).join(" "), err);
  return (out.trim() ? JSON.parse(out) : null) as T;
}

const tagList = (tags: Record<string, string>) => Object.entries(tags).map(([Key, Value]) => ({ Key, Value }));

/** The command SSM runs: dash with a minimal PATH, so it waits for user data, then fetches the script and runs it in bash. */
export function ssmCommands(bucket: string, scriptKey: string): string[] {
  const local = `/opt/lane/${basename(scriptKey)}`;
  return ["export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin", ...waitReady, "mkdir -p /opt/lane", `aws s3 cp ${q(`s3://${bucket}/${scriptKey}`)} ${q(local)} --only-show-errors`, `bash ${q(local)}`];
}

/** Waiters on one kind of state, polled together. */
class Watcher<V> {
  private waiters = new Map<string, { resolve: (v: V) => void; reject: (e: Error) => void; deadline: number }>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly intervalMs: number,
    private readonly poll: (ids: string[]) => Promise<Map<string, V>>,
  ) {}

  wait(id: string, timeoutMs: number): Promise<V> {
    return new Promise((resolve, reject) => {
      this.waiters.set(id, { resolve, reject, deadline: Date.now() + timeoutMs });
      this.timer ??= setTimeout(() => this.tick(), this.intervalMs);
    });
  }

  private async tick(): Promise<void> {
    try {
      const done = await this.poll([...this.waiters.keys()]);
      for (const [id, v] of done) {
        this.waiters.get(id)?.resolve(v);
        this.waiters.delete(id);
      }
    } catch (e) {
      // a throttled or failed poll is retried on the next cycle
      console.warn(`poll failed: ${(e as Error).message}`);
    }
    const now = Date.now();
    for (const [id, w] of this.waiters) {
      if (now > w.deadline) {
        w.reject(new Error(`${id} timed out`));
        this.waiters.delete(id);
      }
    }
    this.timer = this.waiters.size ? setTimeout(() => this.tick(), this.intervalMs) : null;
  }
}

const TERMINAL = new Set(["Success", "Cancelled", "TimedOut", "Failed"]);

export class AwsCloud implements Cloud {
  private readonly online = new Watcher<true>(10_000, async (ids) => {
    const up = new Map<string, true>();
    for (let i = 0; i < ids.length; i += 50) {
      const list = await aws<[string, string][]>(["ssm", "describe-instance-information", "--filters", `Key=InstanceIds,Values=${ids.slice(i, i + 50).join(",")}`, "--query", "InstanceInformationList[].[InstanceId,PingStatus]"]);
      for (const [id, ping] of list ?? []) if (ping === "Online") up.set(id, true);
    }
    return up;
  });

  private readonly instanceOf = new Map<string, string>();

  private readonly commands = new Watcher<CommandResult>(15_000, async (ids) => {
    const executing = new Set(await aws<string[]>(["ssm", "list-commands", "--filters", `key=InvokedAfter,value=${this.since.toISOString()}`, "key=ExecutionStage,value=Executing", "--query", "Commands[].CommandId"]));
    const done = new Map<string, CommandResult>();
    for (const id of ids.filter((c) => !executing.has(c))) {
      try {
        const inv = await aws<{ Status: string; StandardOutputContent: string; StandardErrorContent: string }>(["ssm", "get-command-invocation", "--command-id", id, "--instance-id", this.instanceOf.get(id)!]);
        if (TERMINAL.has(inv.Status)) done.set(id, { status: inv.Status, stdout: inv.StandardOutputContent, stderr: inv.StandardErrorContent });
      } catch (e) {
        // just sent and not yet listed anywhere: still waiting
        if (!(e instanceof AwsError && e.stderr.includes("InvocationDoesNotExist"))) throw e;
      }
    }
    return done;
  });

  constructor(
    readonly bucket: string,
    /** When the run began: every command it sends is invoked after it. */
    readonly since: Date,
  ) {}

  async createPlacementGroup(name: string, tags: Record<string, string>): Promise<void> {
    await aws(["ec2", "create-placement-group", "--group-name", name, "--strategy", "cluster", "--tag-specifications", JSON.stringify([{ ResourceType: "placement-group", Tags: tagList(tags) }])]);
  }

  async launch(r: LaunchRequest): Promise<Host> {
    for (const subnet of r.subnets) {
      try {
        const [id, ip, az] = await aws<[string, string, string]>([
          "ec2", "run-instances",
          // CloudFormation never moves a template's default version
          "--launch-template", `LaunchTemplateId=${r.template},Version=$Latest`,
          "--subnet-id", subnet,
          "--placement", JSON.stringify({ GroupName: r.placementGroup }),
          "--tag-specifications", JSON.stringify(["instance", "volume"].map((ResourceType) => ({ ResourceType, Tags: tagList(r.tags) }))),
          "--query", "Instances[0].[InstanceId,PrivateIpAddress,Placement.AvailabilityZone]",
        ]);
        return { id, ip, az, subnet };
      } catch (e) {
        if (!(e instanceof AwsError && /InsufficientInstanceCapacity|Unsupported/.test(e.stderr))) throw e;
      }
    }
    throw new CapacityError(`no capacity for ${r.template} in ${r.subnets.join(", ")}`);
  }

  waitOnline(instanceId: string, timeoutMs: number): Promise<void> {
    return this.online.wait(instanceId, timeoutMs).then(() => undefined);
  }

  async run(instanceId: string, scriptKey: string, opts: RunOptions): Promise<CommandResult> {
    const id = await aws<string>([
      "ssm", "send-command",
      "--instance-ids", instanceId,
      "--document-name", "AWS-RunShellScript",
      "--comment", opts.comment.slice(0, 100),
      "--timeout-seconds", "600",
      "--parameters", JSON.stringify({ commands: ssmCommands(this.bucket, scriptKey), executionTimeout: [String(opts.timeoutS)] }),
      "--output-s3-bucket-name", this.bucket,
      "--output-s3-key-prefix", opts.outputPrefix,
      "--query", "Command.CommandId",
    ]);
    this.instanceOf.set(id, instanceId);
    // SSM's own timeout ends the command; the margin covers its delivery and the watcher's cycle
    return this.commands.wait(id, (opts.timeoutS + 900) * 1000);
  }

  async terminate(instanceIds: readonly string[]): Promise<void> {
    if (instanceIds.length) await aws(["ec2", "terminate-instances", "--instance-ids", ...instanceIds]);
  }

  async putText(key: string, text: string): Promise<void> {
    await aws(["s3", "cp", "-", `s3://${this.bucket}/${key}`, "--only-show-errors"], text);
  }
}
