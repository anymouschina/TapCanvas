import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv, WorkerEnv } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { runCreditTaskFinalizer } from "../task/task.credit-finalizer";
import { processTeamSubscriptionRenewals } from "../team/team-subscription.service";
import { processMembershipCreditGrants } from "../commerce/membership-credit.service";
import { recoverOrphanVideoNodes } from "../task/video-orphan-recovery";
import { sweepRunningImageNodes } from "../task/image-orphan-recovery";
import { sweepReadyAsyncAgentContinuations } from "../task/public-agents-chat";
import { sweepStaleTaskResults } from "../task/task-result.repo";
import { recordInternalWorkerStageFailure } from "./internal-worker-diagnostics";
import { sweepStaleExecutionTraceRuns } from "../memory/execution-trace-events.repo";
import { broadcastWorkflowExecutionEvent } from "../chapter/canvas-sse.manager";

// 坏死任务清扫阈值：running/queued/claimed 超此龄直接判 failed。
// 治 legacy 直生 clip / 历史孤儿任务永久 running（不在 credit-finalizer 的「有积分预留」扫描集里）。
// 非视频默认 15min；视频类默认 25min（实测 seedance 合法出片可达 15-16min，避免误杀压线慢渲染）。
function readStaleTaskFailMs(env: AppEnv["Bindings"] | WorkerEnv): number {
	const raw = Number((env as Record<string, unknown>).STALE_TASK_FAIL_MS);
	return Number.isFinite(raw) && raw >= 60_000 ? Math.floor(raw) : 15 * 60_000;
}
function readStaleVideoTaskFailMs(env: AppEnv["Bindings"] | WorkerEnv): number {
	const raw = Number((env as Record<string, unknown>).STALE_VIDEO_TASK_FAIL_MS);
	return Number.isFinite(raw) && raw >= 60_000 ? Math.floor(raw) : 25 * 60_000;
}
function readStaleExecutionTraceMs(env: AppEnv["Bindings"] | WorkerEnv): number {
	const raw = Number((env as Record<string, unknown>).STALE_EXECUTION_TRACE_MS);
	return Number.isFinite(raw) && raw >= 5 * 60_000 ? Math.floor(raw) : 35 * 60_000;
}

export const internalRouter = new Hono<AppEnv>();

function readBearerToken(authorization: string | null): string | null {
	const raw = (authorization || "").trim();
	if (!raw) return null;
	const m = raw.match(/^bearer\s+(.+)$/i);
	const token = m && m[1] ? m[1].trim() : "";
	return token ? token : null;
}

internalRouter.use("*", async (c, next) => {
	const expected = String(c.env.INTERNAL_WORKER_TOKEN ?? "").trim();
	if (!expected) {
		return c.json({ error: "Not found" }, 404);
	}

		const authHeader = c.req.header("Authorization") ?? null;
		const provided =
			(c.req.header("X-Internal-Token") || "").trim() ||
			readBearerToken(authHeader) ||
			"";

	if (!provided || provided !== expected) {
		return c.json({ error: "Forbidden" }, 403);
	}

	await next();
});

const CreditFinalizerRunRequestSchema = z
	.object({
		limit: z.number().int().min(1).max(100).optional(),
		orphanReleaseMs: z.number().int().min(60_000).optional(),
	})
	.strict();

const PromptEvolutionRunRequestSchema = z
	.object({
		sinceHours: z.number().int().min(1).max(24 * 30).optional(),
		minSamples: z.number().int().min(1).max(10_000).optional(),
		dryRun: z.boolean().optional(),
	})
	.strict();

async function ensurePromptEvolutionSchema(): Promise<void> {}

internalRouter.post("/credit-finalizer/run", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreditFinalizerRunRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{
				error: "Invalid request body",
				issues: parsed.error.issues,
			},
			400,
		);
	}

	// 计费结算独立运行；Workflow IR 使用自己的持久执行队列，不再由此处驱动旧视频编排状态机。
	let result: Awaited<ReturnType<typeof runCreditTaskFinalizer>> | { error: string } = { error: "" };
	try {
		const FINALIZER_BUDGET_MS = 50_000;
		const timeoutPromise = new Promise<{ error: string }>((resolve) =>
			setTimeout(() => resolve({ error: "credit_finalizer_timeout" }), FINALIZER_BUDGET_MS),
		);
		result = await Promise.race([
			runCreditTaskFinalizer(c.env as WorkerEnv, parsed.data).catch((err) => ({
				error: err instanceof Error ? err.message : String(err),
			})),
			timeoutPromise,
		]);
	} catch (err) {
		result = { error: err instanceof Error ? err.message : String(err) };
	}

	// L3 · 坏死任务恢复（孤儿回收）：扫「有卡死视频节点、但已静置(无活 run 在写)」的章节画布，
	// reconcile 回收上游已完成/失败的结果。治「run 取消/删除/从未落库 → 在飞 clip 永卡生成中」。
	// flag VIDEO_ORPHAN_RECOVERY 默认 ON（幂等失败兜底，非硬闸）；best-effort，失败不影响 finalizer。
	let videoOrphanRecovery: unknown = undefined;
	try {
		const now = Date.now();
		videoOrphanRecovery = await recoverOrphanVideoNodes(c, {
			// 章节 updated_at 早于 3min 前 = 已静置、无活 run 在写 → 视为孤儿候选（不抢正在生成的活跃章节）。
			staleBeforeIso: new Date(now - 3 * 60 * 1000).toISOString(),
			limit: 8,
		});
	} catch {
		// ignore：孤儿回收不得影响计费结算
	}

	// L4 · 图片节点 reconcile sweep：统一扫描项目根 flow 与章节画布中已静置的 running 图片，
	// 回收上游结果；默认开启，只有显式关闭 IMAGE_NODE_RECONCILE_SWEEP 才停用。
	let imageNodeSweep: unknown = undefined;
	try {
		const now = Date.now();
		imageNodeSweep = await sweepRunningImageNodes(c, {
			// updated_at 早于 90s 前 = 已静置、无活 run/前端在写 → 纳入回收。
			staleBeforeIso: new Date(now - 90 * 1000).toISOString(),
			limit: 8,
		});
	} catch (error) {
		imageNodeSweep = recordInternalWorkerStageFailure("image_node_sweep", error);
	}

	let asyncAgentContinuationSweep: unknown = undefined;
	try {
		asyncAgentContinuationSweep = await sweepReadyAsyncAgentContinuations(c, { limit: 100 });
	} catch (error) {
		asyncAgentContinuationSweep = recordInternalWorkerStageFailure(
			"async_agent_continuation_sweep",
			error,
		);
	}

	// L5 · 坏死任务清扫：把 running/queued/claimed 且超 15min 的 task_results 标 failed。
	// credit-finalizer 只扫「有未结算积分预留」的任务，结算完/无预留的孤儿任务（legacy 直生 clip、
	// 历史积压）永不被终结 → 画布节点永卡生成中。这里按任务龄兜底终结。best-effort，不影响计费。
	let staleTaskSweep: unknown = undefined;
	try {
		staleTaskSweep = await sweepStaleTaskResults(getPrismaClient(), {
			staleMs: readStaleTaskFailMs(c.env),
			videoStaleMs: readStaleVideoTaskFailMs(c.env),
			nowMs: Date.now(),
			limit: 200,
			reason: "stale_timeout",
		});
	} catch {
		// ignore：坏死任务清扫不得影响计费结算
	}

	let executionTraceSweep: unknown = undefined;
	try {
		executionTraceSweep = await sweepStaleExecutionTraceRuns(getPrismaClient(), {
			staleMs: readStaleExecutionTraceMs(c.env),
			nowMs: Date.now(),
			limit: 200,
		});
	} catch (error) {
		executionTraceSweep = recordInternalWorkerStageFailure("execution_trace_sweep", error);
	}

	return c.json({
		ok: true,
		...result,
		...(videoOrphanRecovery ? { videoOrphanRecovery } : {}),
		...(imageNodeSweep ? { imageNodeSweep } : {}),
		...(asyncAgentContinuationSweep ? { asyncAgentContinuationSweep } : {}),
		...(staleTaskSweep ? { staleTaskSweep } : {}),
		...(executionTraceSweep ? { executionTraceSweep } : {}),
	});
});

// 媒体回收只对账已受理的供应商任务并保护现有资产；它不启动、恢复或推进任何创作编排。
internalRouter.post("/media-recovery/run", async (c) => {
	const now = Date.now();

	let videoOrphanRecovery: unknown = undefined;
	try {
		videoOrphanRecovery = await recoverOrphanVideoNodes(c, {
			staleBeforeIso: new Date(now - 3 * 60 * 1000).toISOString(),
			limit: 8,
		});
	} catch {
		// best-effort
	}

	let imageNodeSweep: unknown = undefined;
	try {
		imageNodeSweep = await sweepRunningImageNodes(c, {
			staleBeforeIso: new Date(now - 90 * 1000).toISOString(),
			limit: 8,
		});
	} catch (error) {
		imageNodeSweep = recordInternalWorkerStageFailure("image_node_sweep", error);
	}

	let asyncAgentContinuationSweep: unknown = undefined;
	try {
		asyncAgentContinuationSweep = await sweepReadyAsyncAgentContinuations(c, { limit: 100 });
	} catch (error) {
		asyncAgentContinuationSweep = recordInternalWorkerStageFailure(
			"async_agent_continuation_sweep",
			error,
		);
	}

	return c.json({
		ok: true,
		...(videoOrphanRecovery ? { videoOrphanRecovery } : {}),
		...(imageNodeSweep ? { imageNodeSweep } : {}),
		...(asyncAgentContinuationSweep ? { asyncAgentContinuationSweep } : {}),
	});
});

internalRouter.post("/subscription-renewals/run", async (c) => {
	const result = await processTeamSubscriptionRenewals(getPrismaClient());
	return c.json({ ok: true, ...result });
});

internalRouter.post("/membership-credit-grants/run", async (c) => {
	const body: unknown = await c.req.json().catch(() => ({}));
	const limit = body && typeof body === "object" && "limit" in body ? Number(body.limit) : undefined;
	const result = await processMembershipCreditGrants(getPrismaClient(), {
		...(Number.isFinite(limit) ? { limit } : {}),
	});
	return c.json({ ok: result.errors === 0, ...result }, result.errors === 0 ? 200 : 500);
});

internalRouter.post("/prompt-evolution/run", async (c) => {
	await ensurePromptEvolutionSchema();
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = PromptEvolutionRunRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{
				error: "Invalid request body",
				issues: parsed.error.issues,
			},
			400,
		);
	}

	const sinceHours =
		typeof parsed.data.sinceHours === "number" ? parsed.data.sinceHours : 24;
	const minSamples =
		typeof parsed.data.minSamples === "number" ? parsed.data.minSamples : 30;
	const dryRun = parsed.data.dryRun !== false;
	const sinceIso = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();

	const logs = await getPrismaClient().vendor_api_call_logs.findMany({
		where: {
			task_kind: { in: ["chat", "prompt_refine"] },
			created_at: { gte: sinceIso },
		},
		select: {
			status: true,
			duration_ms: true,
		},
	});

	const total = logs.length;
	const succeeded = logs.filter((l) => l.status === "succeeded").length;
	const failed = logs.filter((l) => l.status === "failed").length;
	const durationValues = logs
		.map((l) => l.duration_ms)
		.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
	const avgDurationMs =
		durationValues.length > 0
			? durationValues.reduce((sum, current) => sum + current, 0) /
				durationValues.length
			: 0;
	const successRate = total > 0 ? succeeded / total : 0;
	const hasEnoughSamples = total >= minSamples;
	const action = hasEnoughSamples && !dryRun ? "ready_for_optimizer" : "skip";
	const runId = crypto.randomUUID();
	const nowIso = new Date().toISOString();

	await getPrismaClient().prompt_evolution_runs.create({
		data: {
			id: runId,
			actor_user_id: "internal-worker",
			since_hours: sinceHours,
			min_samples: minSamples,
			dry_run: dryRun ? 1 : 0,
			action,
			metrics_json: JSON.stringify({
				total,
				succeeded,
				failed,
				successRate,
				avgDurationMs: Math.max(0, Math.round(avgDurationMs)),
			}),
			created_at: nowIso,
		},
	});

	return c.json({
		ok: true,
		runId,
		job: "prompt-evolution",
		sinceHours,
		sinceIso,
		dryRun,
		guardrail: {
			minSamples,
			hasEnoughSamples,
		},
		metrics: {
			total,
			succeeded,
			failed,
			successRate,
			avgDurationMs: Math.max(0, Math.round(avgDurationMs)),
		},
		action,
	});
});

const WorkflowExecutionEventBroadcastSchema = z.object({
	projectId: z.string().trim().min(1),
	executionId: z.string().trim().min(1),
	seq: z.number().int().min(0),
	eventType: z.string().trim().min(1),
	status: z.string().trim().optional(),
}).strict();

// 执行引擎（ExecutionDO，独立进程）在每次 committed 执行事件后调用本端点，
// 经 canvas-events SSE 把「执行进度 + 单调递增 seq」推给项目画布订阅者。
// 前端按 seq 水印增量拉取 node_runs 并折叠到画布（对齐 DeepSeek Harness 的
// 事件驱动投影，非轮询）。
internalRouter.post("/workflow-execution-event/broadcast", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = WorkflowExecutionEventBroadcastSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	broadcastWorkflowExecutionEvent(parsed.data.projectId, parsed.data);
	return c.json({ ok: true });
});
