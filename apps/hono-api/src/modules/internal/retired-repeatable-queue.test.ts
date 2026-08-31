import { describe, expect, it, vi } from "vitest";

import {
  retireRepeatableQueue,
  type RetiredRepeatableQueue,
} from "./retired-repeatable-queue";

function queueFixture(overrides: Partial<RetiredRepeatableQueue> = {}): RetiredRepeatableQueue {
  return {
    getWorkersCount: async () => 0,
    getRepeatableJobs: async () => [],
    removeRepeatableByKey: async () => true,
    getJobCounts: async () => ({ completed: 0, failed: 0 }),
    obliterate: async () => undefined,
    ...overrides,
  };
}

describe("retireRepeatableQueue", () => {
  it("removes schedules and completed wake-up receipts before obliterating an exact retired namespace", async () => {
    const events: string[] = [];
    const result = await retireRepeatableQueue({
      queueName: "tapcanvas-video-run-driver",
      queue: queueFixture({
        getRepeatableJobs: async () => [{ key: "repeat-a" }, { key: "repeat-b" }],
        removeRepeatableByKey: async (key) => {
          events.push(`remove:${key}`);
          return true;
        },
        getJobCounts: async () => ({ completed: 263_090, failed: 4 }),
        obliterate: async (options) => {
          events.push(`obliterate:${String(options.force)}:${options.count}`);
        },
      }),
    });

    expect(events).toEqual([
      "remove:repeat-a",
      "remove:repeat-b",
      "obliterate:false:10000",
    ]);
    expect(result).toEqual({
      queueName: "tapcanvas-video-run-driver",
      removedRepeatableSchedules: 2,
      completedJobs: 263_090,
      failedJobs: 4,
      obliterated: true,
    });
  });

  it("refuses cleanup while an old worker still owns the namespace", async () => {
    const removeRepeatableByKey = vi.fn(async () => true);
    const obliterate = vi.fn(async () => undefined);

    await expect(retireRepeatableQueue({
      queueName: "tapcanvas-credit-finalizer",
      queue: queueFixture({
        getWorkersCount: async () => 1,
        removeRepeatableByKey,
        obliterate,
      }),
    })).rejects.toThrow("still has 1 worker");

    expect(removeRepeatableByKey).not.toHaveBeenCalled();
    expect(obliterate).not.toHaveBeenCalled();
  });

  it("refuses cleanup when a delayed executable job survives repeat metadata removal", async () => {
    const obliterate = vi.fn(async () => undefined);

    await expect(retireRepeatableQueue({
      queueName: "tapcanvas-video-run-driver",
      queue: queueFixture({
        getRepeatableJobs: async () => [{ key: "repeat-current" }],
        getJobCounts: async () => ({ delayed: 1, completed: 10, failed: 0 }),
        obliterate,
      }),
    })).rejects.toThrow("delayed=1");

    expect(obliterate).not.toHaveBeenCalled();
  });
});
