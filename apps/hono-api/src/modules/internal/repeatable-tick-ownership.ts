type TickData = Record<string, never>;

type RepeatableTickJobOptions = {
  repeat: { every: number };
  jobId: string;
  removeOnComplete: true;
  removeOnFail: { count: number };
};

export type RepeatableTickQueue = {
  getRepeatableJobs: () => Promise<Array<{ key: string }>>;
  removeRepeatableByKey: (key: string) => Promise<boolean>;
  clean: (graceMs: number, limit: number, type: "completed") => Promise<string[]>;
  add: (
    name: string,
    data: TickData,
    options: RepeatableTickJobOptions,
  ) => Promise<unknown>;
};

const COMPLETED_TICK_CLEAN_BATCH_SIZE = 10_000;

async function removeHistoricalCompletedTicks(queue: RepeatableTickQueue): Promise<void> {
  while (true) {
    const removedJobIds = await queue.clean(
      0,
      COMPLETED_TICK_CLEAN_BATCH_SIZE,
      "completed",
    );
    if (removedJobIds.length < COMPLETED_TICK_CLEAN_BATCH_SIZE) return;
  }
}

export async function installExclusiveRepeatableTick(input: {
  queue: RepeatableTickQueue;
  name: string;
  everyMs: number;
  jobId: string;
}): Promise<void> {
  // A queue owned by this worker has exactly one periodic job. BullMQ stores repeat
  // metadata in Redis beyond container lifetime, so replace all historical schedules
  // before installing the current cadence. Failures propagate and keep health false.
  const existing = await input.queue.getRepeatableJobs();
  for (const repeatable of existing) {
    await input.queue.removeRepeatableByKey(repeatable.key);
  }
  // Current ticks use removeOnComplete, but hashes written by older deployments do
  // not disappear when repeat metadata is replaced. Remove only successful wake-up
  // receipts here; failed jobs stay available under the bounded removeOnFail policy.
  await removeHistoricalCompletedTicks(input.queue);
  await input.queue.add(
    input.name,
    {},
    {
      repeat: { every: input.everyMs },
      jobId: input.jobId,
      removeOnComplete: true,
      removeOnFail: { count: 100 },
    },
  );
}
