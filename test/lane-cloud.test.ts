import { describe, expect, test } from "bun:test";
import { AwsError, Pacer, whileThrottled } from "../src/lane/cloud";

// as run 40998162997 recorded it
const throttled = new AwsError("ec2 run-instances", "aws: [ERROR]: An error occurred (RequestLimitExceeded) when calling the RunInstances operation (reached max retries: 9): Request limit exceeded.");
const noCapacity = new AwsError("ec2 run-instances", "aws: [ERROR]: An error occurred (InsufficientInstanceCapacity) when calling the RunInstances operation: We currently do not have sufficient c8gn.xlarge capacity.");

describe("the lane's AWS calls", () => {
  test("a call the account's request rate refuses is made again after each wait", async () => {
    let calls = 0;
    const id = await whileThrottled(async () => {
      if (++calls < 3) throw throttled;
      return "i-1";
    }, [0, 0, 0]);
    expect(id).toBe("i-1");
    expect(calls).toBe(3);
  });

  test("gives up with the last refusal once the waits run out, and passes any other error straight through", async () => {
    let calls = 0;
    const always = (e: AwsError) => async () => {
      calls++;
      throw e;
    };
    await expect(whileThrottled(always(throttled), [0, 0])).rejects.toBe(throttled);
    expect(calls).toBe(3);
    calls = 0;
    await expect(whileThrottled(always(noCapacity), [0, 0])).rejects.toBe(noCapacity);
    expect(calls).toBe(1);
  });

  test("starts calls at least the spacing apart, however many ask at once", async () => {
    const pacer = new Pacer(40);
    const started: number[] = [];
    await Promise.all(
      [0, 1, 2].map(async () => {
        await pacer.wait();
        started.push(performance.now());
      }),
    );
    expect(started[1]! - started[0]!).toBeGreaterThanOrEqual(38);
    expect(started[2]! - started[1]!).toBeGreaterThanOrEqual(38);
  });
});
