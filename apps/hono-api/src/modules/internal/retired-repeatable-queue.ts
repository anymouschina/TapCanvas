type RepeatableJobDescriptor = Readonly<{ key: string }>;

type RetiredQueueCounts = Readonly<Record<string, number>>;

export type RetiredRepeatableQueue = Readonly<{
  getWorkersCount: () => Promise<number>;
  getRepeatableJobs: () => Promise<RepeatableJobDescriptor[]>;
  removeRepeatableByKey: (key: string) => Promise<boolean>;
  getJobCounts: (...types: string[]) => Promise<RetiredQueueCounts>;
  obliterate: (options: Readonly<{ force: false; count: number }>) => Promise<void>;
}>;

export type RetiredRepeatableQueueResult = Readonly<{
  queueName: string;
  removedRepeatableSchedules: number;
  completedJobs: number;
  failedJobs: number;
  obliterated: true;
}>;

const UNSAFE_JOB_STATES = [
  "active",
  "wait",
  "waiting",
  "waiting-children",
  "delayed",
  "paused",
  "prioritized",
  "repeat",
] as const;

const countFor = (counts: RetiredQueueCounts, state: string): number => {
  const value = counts[state];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

/**
 * Permanently retires one exact BullMQ queue namespace.
 *
 * Business execution evidence lives in PostgreSQL; these queues only contained
 * periodic wake-up receipts. A hard cutover must remove their completed job
 * hashes as well as repeat metadata, otherwise old 5-second ticks accumulate
 * hundreds of thousands of Redis keys and can stall the current runtime lease.
 *
 * The operation refuses to proceed while a worker or any executable job state
 * still exists. `force:false` is repeated at the BullMQ boundary so a race cannot
 * turn this administrative cleanup into an active-job deletion.
 */
export async function retireRepeatableQueue(input: Readonly<{
  queueName: string;
  queue: RetiredRepeatableQueue;
}>): Promise<RetiredRepeatableQueueResult> {
  const queueName = input.queueName.trim();
  if (!queueName) throw new Error("retired queue name is required");

  const workerCount = await input.queue.getWorkersCount();
  if (workerCount > 0) {
    throw new Error(`retired queue ${queueName} still has ${workerCount} worker(s)`);
  }

  const repeatables = await input.queue.getRepeatableJobs();
  for (const repeatable of repeatables) {
    await input.queue.removeRepeatableByKey(repeatable.key);
  }

  const counts = await input.queue.getJobCounts(
    ...UNSAFE_JOB_STATES,
    "completed",
    "failed",
  );
  const unsafeStates = UNSAFE_JOB_STATES.flatMap((state) => {
    const count = countFor(counts, state);
    return count > 0 ? [`${state}=${count}`] : [];
  });
  if (unsafeStates.length > 0) {
    throw new Error(`retired queue ${queueName} still has executable jobs: ${unsafeStates.join(", ")}`);
  }

  const completedJobs = countFor(counts, "completed");
  const failedJobs = countFor(counts, "failed");
  await input.queue.obliterate({ force: false, count: 10_000 });

  return {
    queueName,
    removedRepeatableSchedules: repeatables.length,
    completedJobs,
    failedJobs,
    obliterated: true,
  };
}
