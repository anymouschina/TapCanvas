import type { AppContext, WorkerEnv } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { runCreditTaskFinalizer } from "../task/task.credit-finalizer";
import { recoverOrphanVideoNodes } from "../task/video-orphan-recovery";
import { sweepRunningImageNodes } from "../task/image-orphan-recovery";
import { sweepReadyAsyncAgentContinuations } from "../task/public-agents-chat";
import { sweepStaleTaskResults } from "../task/task-result.repo";
import {
  recordInternalWorkerStageFailure,
  type InternalWorkerStageFailure,
  type InternalWorkerTickResult,
} from "./internal-worker-diagnostics";
import { sweepStaleExecutionTraceRuns } from "../memory/execution-trace-events.repo";

/**
 * In-process worker ticks (root fix ③).
 *
 * These execute the same domain operations as the historical internal HTTP routes, but
 * split them into one credit/task lifecycle lane and one media-recovery lane. They are
 * invoked directly by the worker's own process, so finalization and recovery run in the
 * worker container's heap instead of being HTTP-called back into the user-facing api
 * container (where they currently contend for the 4g api heap and cause peak OOM).
 *
 * Workflow IR progression is owned by the execution queue and is intentionally absent here.
 */

function readStaleTaskFailMs(env: WorkerEnv): number {
  const raw = Number((env as Record<string, unknown>).STALE_TASK_FAIL_MS);
  return Number.isFinite(raw) && raw >= 60_000 ? Math.floor(raw) : 15 * 60_000;
}
function readStaleVideoTaskFailMs(env: WorkerEnv): number {
  const raw = Number((env as Record<string, unknown>).STALE_VIDEO_TASK_FAIL_MS);
  return Number.isFinite(raw) && raw >= 60_000 ? Math.floor(raw) : 25 * 60_000;
}
function readStaleExecutionTraceMs(env: WorkerEnv): number {
  const raw = Number((env as Record<string, unknown>).STALE_EXECUTION_TRACE_MS);
  return Number.isFinite(raw) && raw >= 5 * 60_000 ? Math.floor(raw) : 35 * 60_000;
}

/** Minimal AppContext over a WorkerEnv (same shape the finalizer route relies on). */
export function buildInternalContext(env: WorkerEnv): AppContext {
  const store = new Map<string, unknown>();
  const c = {
    env,
    req: {
      url: "https://internal.inprocess-worker.local/",
      raw: new Request("https://internal.inprocess-worker.local/"),
      header: (_name?: string) => undefined,
    },
    get: (key: string) => store.get(key),
    set: (key: string, value: unknown) => store.set(key, value),
  };
  return c as unknown as AppContext;
}

function captureStageFailure(
  failures: InternalWorkerStageFailure[],
  stage: string,
  error: unknown,
): InternalWorkerStageFailure {
  const failure = recordInternalWorkerStageFailure(stage, error);
  failures.push(failure);
  return failure;
}

/**
 * Credit/task lifecycle lane. Media orphan recovery belongs exclusively to
 * runMediaRecoveryTick so two repeat queues in the same process cannot scan
 * and claim the same database frontier concurrently.
 */
export async function runFinalizerTick(
  env: WorkerEnv,
  options?: { limit?: number; orphanReleaseMs?: number },
): Promise<InternalWorkerTickResult> {
  const failures: InternalWorkerStageFailure[] = [];
  let result: Record<string, unknown> = {};
  try {
    const finalizerResult = await runCreditTaskFinalizer(env, options);
    result = finalizerResult;
    if (finalizerResult.errors > 0) {
      captureStageFailure(
        failures,
        "credit_finalizer",
        new Error(`credit finalizer reported ${finalizerResult.errors} row error(s)`),
      );
    }
  } catch (error) {
    result = captureStageFailure(failures, "credit_finalizer", error);
  }

  let staleTaskSweep: unknown;
  try {
    staleTaskSweep = await sweepStaleTaskResults(getPrismaClient(), {
      staleMs: readStaleTaskFailMs(env),
      videoStaleMs: readStaleVideoTaskFailMs(env),
      nowMs: Date.now(),
      limit: 200,
      reason: "stale_timeout",
    });
  } catch (error) {
    staleTaskSweep = captureStageFailure(failures, "stale_task_sweep", error);
  }

  let executionTraceSweep: unknown;
  try {
    executionTraceSweep = await sweepStaleExecutionTraceRuns(getPrismaClient(), {
      staleMs: readStaleExecutionTraceMs(env),
      nowMs: Date.now(),
      limit: 200,
    });
  } catch (error) {
    executionTraceSweep = captureStageFailure(failures, "execution_trace_sweep", error);
  }

  return {
    ok: failures.length === 0,
    failures,
    ...result,
    ...(staleTaskSweep ? { staleTaskSweep } : {}),
    ...(executionTraceSweep ? { executionTraceSweep } : {}),
  };
}

/**
 * Lightweight delivery-continuation lane.
 *
 * Provider media completion is already persisted in task_results. Closing the
 * logical user task must not wait behind the minute-scale video/authoring drive
 * tick, so this lane only reconciles the durable continuation frontier and
 * schedules contracts whose exact dependencies are now terminal.
 */
export async function runAsyncAgentContinuationSweepTick(
  env: WorkerEnv,
): Promise<InternalWorkerTickResult> {
  const failures: InternalWorkerStageFailure[] = [];
  let asyncAgentContinuationSweep: unknown;
  try {
    asyncAgentContinuationSweep = await sweepReadyAsyncAgentContinuations(
      buildInternalContext(env),
      { limit: 100 },
    );
  } catch (error) {
    asyncAgentContinuationSweep = captureStageFailure(
      failures,
      "async_agent_continuation_sweep",
      error,
    );
  }
  return {
    ok: failures.length === 0,
    failures,
    asyncAgentContinuationSweep,
  };
}

/** Reconcile accepted media tasks without owning creative workflow progression. */
export async function runMediaRecoveryTick(env: WorkerEnv): Promise<InternalWorkerTickResult> {
  const c = buildInternalContext(env);
  const now = Date.now();
  const failures: InternalWorkerStageFailure[] = [];

  let videoOrphanRecovery: unknown;
  try {
    videoOrphanRecovery = await recoverOrphanVideoNodes(c, {
      staleBeforeIso: new Date(now - 3 * 60 * 1000).toISOString(),
      limit: 8,
    });
  } catch (error) {
    videoOrphanRecovery = captureStageFailure(failures, "video_orphan_recovery", error);
  }

  let imageNodeSweep: unknown;
  try {
    imageNodeSweep = await sweepRunningImageNodes(c, {
      staleBeforeIso: new Date(now - 90 * 1000).toISOString(),
      limit: 8,
    });
  } catch (error) {
    imageNodeSweep = captureStageFailure(failures, "image_node_sweep", error);
  }

  return {
    ok: failures.length === 0,
    failures,
    ...(videoOrphanRecovery ? { videoOrphanRecovery } : {}),
    ...(imageNodeSweep ? { imageNodeSweep } : {}),
  };
}
