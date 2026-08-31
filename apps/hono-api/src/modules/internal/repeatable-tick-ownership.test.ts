import { describe, expect, it } from "vitest";

import {
  installExclusiveRepeatableTick,
  type RepeatableTickQueue,
} from "./repeatable-tick-ownership";

describe("installExclusiveRepeatableTick", () => {
  it("removes every durable historical schedule before installing one current tick", async () => {
    const events: string[] = [];
    const queue: RepeatableTickQueue = {
      getRepeatableJobs: async () => [{ key: "legacy-a" }, { key: "legacy-b" }],
      removeRepeatableByKey: async (key) => {
        events.push(`remove:${key}`);
        return true;
      },
      clean: async (graceMs, limit, type) => {
        events.push(`clean:${graceMs}:${limit}:${type}`);
        return ["old-completed-tick"];
      },
      add: async (name, data, options) => {
        events.push(`add:${name}:${options.repeat.every}:${options.jobId}`);
        expect(data).toEqual({});
        expect(options.removeOnFail).toEqual({ count: 100 });
        return { id: options.jobId };
      },
    };

    await installExclusiveRepeatableTick({
      queue,
      name: "tick",
      everyMs: 5_000,
      jobId: "video-drive",
    });

    expect(events).toEqual([
      "remove:legacy-a",
      "remove:legacy-b",
      "clean:0:10000:completed",
      "add:tick:5000:video-drive",
    ]);
  });

  it("propagates cleanup failure and does not install a competing schedule", async () => {
    let addCalled = false;
    const queue: RepeatableTickQueue = {
      getRepeatableJobs: async () => [{ key: "legacy" }],
      removeRepeatableByKey: async () => {
        throw new Error("redis write failed");
      },
      clean: async () => [],
      add: async () => {
        addCalled = true;
        return {};
      },
    };

    await expect(
      installExclusiveRepeatableTick({
        queue,
        name: "tick",
        everyMs: 60_000,
        jobId: "finalizer",
      }),
    ).rejects.toThrow("redis write failed");
    expect(addCalled).toBe(false);
  });

  it("removes historical completed receipts in bounded batches before installing the schedule", async () => {
    const cleanBatchSizes: number[] = [];
    const queue: RepeatableTickQueue = {
      getRepeatableJobs: async () => [],
      removeRepeatableByKey: async () => true,
      clean: async (_graceMs, limit) => {
        cleanBatchSizes.push(limit);
        return cleanBatchSizes.length === 1
          ? Array.from({ length: limit }, (_, index) => `completed-${index}`)
          : ["completed-final"];
      },
      add: async () => ({ id: "current" }),
    };

    await installExclusiveRepeatableTick({
      queue,
      name: "tick",
      everyMs: 60_000,
      jobId: "membership-reconciliation",
    });

    expect(cleanBatchSizes).toEqual([10_000, 10_000]);
  });
});
