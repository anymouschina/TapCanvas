import { Hono } from "hono";

import type { AppEnv, WorkerEnv } from "../../types";
import { runGenericTaskForVendor } from "./task.service";
import {
	createTaskResultWithDurableDispatch,
	failTaskResultIfNonTerminal,
	getTaskResultByTaskId,
	tryClaimTaskResult,
	upsertTaskResult,
} from "./task-result.repo";
import {
	listTaskStatusesByProvider,
	requeueStaleClaimedTaskStatuses,
	tryClaimTaskStatus,
	upsertTaskStatus,
} from "./task-status.repo";
import {
	TaskRequestSchema,
	TaskResultSchema,
	type TaskResultDto,
} from "./task.schemas";
import {
	enqueueAsyncImageTask,
	type AsyncImageQueueJob,
} from "./async-image.queue";
import { QUEUE_NAMES } from "./queues";
import { readGenerationAssetContextFromRaw } from "./generation-asset-context";

const ASYNC_IMAGE_VENDOR = "newapi";
export const ASYNC_IMAGE_DISPATCH_PROVIDER = "async_image_dispatch";
const ASYNC_IMAGE_DISPATCH_LEASE_MS = 60_000;
const ASYNC_IMAGE_DISPATCH_MAX_ATTEMPTS = 10;

export type AsyncImageDispatchContractV1 = Readonly<{
	version: 1;
	job: AsyncImageQueueJob;
	attempt: number;
	lastError: string | null;
	createdAt: string;
}>;

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim()) return error.message.trim();
	return "图像任务执行失败";
}

function readRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function readRequiredString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readOptionalString(value: unknown): string | null | undefined {
	if (value === null) return null;
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildGenerationContextRaw(job: AsyncImageQueueJob): Record<string, unknown> {
	const extras = readRecord(job.request.extras);
	const generationContext = readGenerationAssetContextFromRaw({
		generationContext: extras?.generationContext,
	});
	return generationContext ? { generationContext } : {};
}

export function parseAsyncImageDispatchContractV1(
	value: unknown,
): AsyncImageDispatchContractV1 | null {
	let parsed: unknown = value;
	if (typeof value === "string") {
		try {
			parsed = JSON.parse(value) as unknown;
		} catch {
			return null;
		}
	}
	const record = readRecord(parsed);
	const jobRecord = readRecord(record?.job);
	const taskId = readRequiredString(jobRecord?.taskId);
	const userId = readRequiredString(jobRecord?.userId);
	const request = TaskRequestSchema.safeParse(jobRecord?.request);
	const activeTeamId = readOptionalString(jobRecord?.activeTeamId);
	const apiKeyBillingTeamId = readOptionalString(jobRecord?.apiKeyBillingTeamId);
	const apiKeyId = readOptionalString(jobRecord?.apiKeyId);
	const enqueuedAt = readRequiredString(jobRecord?.enqueuedAt);
	const attempt = typeof record?.attempt === "number" &&
		Number.isInteger(record.attempt) && record.attempt >= 0
		? record.attempt
		: null;
	const lastError = record?.lastError === null
		? null
		: readRequiredString(record?.lastError)?.slice(0, 1_000) ?? null;
	const createdAt = readRequiredString(record?.createdAt);
	if (
		record?.version !== 1 || !taskId || !userId || !request.success ||
		activeTeamId === undefined || apiKeyBillingTeamId === undefined || apiKeyId === undefined ||
		!enqueuedAt || attempt === null || !createdAt
	) return null;
	return {
		version: 1,
		job: {
			taskId,
			userId,
			request: request.data,
			activeTeamId,
			apiKeyBillingTeamId,
			apiKeyId,
			enqueuedAt,
		},
		attempt,
		lastError,
		createdAt,
	};
}

export function buildAsyncImageDispatchContract(
	job: AsyncImageQueueJob,
): AsyncImageDispatchContractV1 {
	const contract: AsyncImageDispatchContractV1 = {
		version: 1,
		job,
		attempt: 0,
		lastError: null,
		createdAt: job.enqueuedAt,
	};
	const parsed = parseAsyncImageDispatchContractV1(contract);
	if (!parsed) throw new Error("async_image_dispatch_contract_invalid");
	return parsed;
}

function readUpstreamTaskId(result: TaskResultDto): string | null {
	const raw = readRecord(result.raw);
	for (const candidate of [raw?.upstreamTaskId, raw?.vendorTaskId]) {
		if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
	}
	return null;
}

export function buildAsyncImageQueuedResult(job: AsyncImageQueueJob): TaskResultDto {
	return TaskResultSchema.parse({
		id: job.taskId,
		kind: job.request.kind,
		status: "queued",
		assets: [],
		raw: {
			provider: "task_store",
			queueName: QUEUE_NAMES.asyncImage,
			enqueuedAt: job.enqueuedAt,
			...buildGenerationContextRaw(job),
		},
	});
}

export function buildAsyncImageRunningResult(
	job: AsyncImageQueueJob,
	startedAt: string,
): TaskResultDto {
	return TaskResultSchema.parse({
		id: job.taskId,
		kind: job.request.kind,
		status: "running",
		assets: [],
		raw: {
			provider: "task_store",
			queueName: QUEUE_NAMES.asyncImage,
			enqueuedAt: job.enqueuedAt,
			startedAt,
			...buildGenerationContextRaw(job),
		},
	});
}

export function buildAsyncImageSucceededResult(
	job: AsyncImageQueueJob,
	providerResult: TaskResultDto,
	completedAt: string,
): TaskResultDto {
	if (providerResult.status !== "succeeded" || providerResult.assets.length === 0) {
		throw new Error(
			`async image provider returned ${providerResult.status} without deliverable assets`,
		);
	}
	return TaskResultSchema.parse({
		id: job.taskId,
		kind: job.request.kind,
		status: "succeeded",
		assets: providerResult.assets,
		raw: {
			provider: "task_store",
			vendor: ASYNC_IMAGE_VENDOR,
			queueName: QUEUE_NAMES.asyncImage,
			upstreamTaskId: readUpstreamTaskId(providerResult),
			storedAt: completedAt,
			...buildGenerationContextRaw(job),
		},
	});
}

export function buildAsyncImageFailedResult(
	job: AsyncImageQueueJob,
	error: unknown,
	completedAt: string,
): TaskResultDto {
	const record = readRecord(error);
	return TaskResultSchema.parse({
		id: job.taskId,
		kind: job.request.kind,
		status: "failed",
		assets: [],
		raw: {
			provider: "task_store",
			vendor: ASYNC_IMAGE_VENDOR,
			queueName: QUEUE_NAMES.asyncImage,
			failureReason: errorMessage(error),
			code: typeof record?.code === "string" ? record.code : null,
			failedAt: completedAt,
			...buildGenerationContextRaw(job),
		},
	});
}

export async function registerAsyncImageTask(
	env: WorkerEnv,
	job: AsyncImageQueueJob,
): Promise<Readonly<{
	result: TaskResultDto;
	contract: AsyncImageDispatchContractV1;
}>> {
	const result = buildAsyncImageQueuedResult(job);
	const contract = buildAsyncImageDispatchContract(job);
	await createTaskResultWithDurableDispatch(env.DB, {
		result: {
			userId: job.userId,
			taskId: job.taskId,
			vendor: ASYNC_IMAGE_VENDOR,
			kind: job.request.kind,
			status: "queued",
			result,
			nowIso: job.enqueuedAt,
		},
		dispatch: {
			provider: ASYNC_IMAGE_DISPATCH_PROVIDER,
			status: "waiting",
			data: contract,
		},
	});
	return { result, contract };
}

async function failAsyncImageTaskByIdentity(input: {
	env: WorkerEnv;
	userId: string;
	taskId: string;
	error: unknown;
}): Promise<void> {
	const row = await getTaskResultByTaskId(input.env.DB, input.userId, input.taskId);
	if (!row) return;
	let raw: unknown = null;
	try {
		const current = TaskResultSchema.parse(JSON.parse(row.result) as unknown);
		raw = current.raw;
	} catch {
		raw = null;
	}
	const completedAt = new Date().toISOString();
	const failedResult = TaskResultSchema.parse({
		id: input.taskId,
		kind: row.kind,
		status: "failed",
		assets: [],
		raw: {
			...(readRecord(raw) ?? {}),
			provider: "task_store",
			vendor: ASYNC_IMAGE_VENDOR,
			queueName: QUEUE_NAMES.asyncImage,
			failureReason: errorMessage(input.error),
			failedAt: completedAt,
		},
	});
	await failTaskResultIfNonTerminal(input.env.DB, {
		userId: input.userId,
		taskId: input.taskId,
		result: failedResult,
		nowIso: completedAt,
	});
}

async function deferOrFailAsyncImageDispatch(
	env: WorkerEnv,
	contract: AsyncImageDispatchContractV1,
	error: unknown,
): Promise<"waiting" | "failed"> {
	const attempt = contract.attempt + 1;
	const nowIso = new Date().toISOString();
	const next: AsyncImageDispatchContractV1 = {
		...contract,
		attempt,
		lastError: errorMessage(error).slice(0, 1_000),
	};
	const failed = attempt >= ASYNC_IMAGE_DISPATCH_MAX_ATTEMPTS;
	await upsertTaskStatus(env.DB, {
		taskId: contract.job.taskId,
		provider: ASYNC_IMAGE_DISPATCH_PROVIDER,
		userId: contract.job.userId,
		status: failed ? "failed" : "waiting",
		data: next,
		...(failed ? { completedAt: nowIso } : {}),
		nowIso,
	});
	if (failed) {
		await failAsyncImageTaskByIdentity({
			env,
			userId: contract.job.userId,
			taskId: contract.job.taskId,
			error,
		});
	}
	return failed ? "failed" : "waiting";
}

export async function dispatchAsyncImageTask(
	env: WorkerEnv,
	contract: AsyncImageDispatchContractV1,
): Promise<"dispatched" | "already_claimed" | "waiting" | "failed"> {
	const claimed = await tryClaimTaskStatus(env.DB, {
		taskId: contract.job.taskId,
		provider: ASYNC_IMAGE_DISPATCH_PROVIDER,
		nowIso: new Date().toISOString(),
	});
	if (!claimed) return "already_claimed";
	try {
		await enqueueAsyncImageTask(contract.job);
		const completedAt = new Date().toISOString();
		await upsertTaskStatus(env.DB, {
			taskId: contract.job.taskId,
			provider: ASYNC_IMAGE_DISPATCH_PROVIDER,
			userId: contract.job.userId,
			status: "completed",
			data: contract,
			completedAt,
			nowIso: completedAt,
		});
		return "dispatched";
	} catch (error: unknown) {
		return deferOrFailAsyncImageDispatch(env, contract, error);
	}
}

export async function sweepAsyncImageDispatches(input: {
	env: WorkerEnv;
	limit?: number;
}): Promise<Readonly<{
	scanned: number;
	dispatched: number;
	waiting: number;
	failed: number;
	invalid: number;
	recoveredClaims: number;
}>> {
	const nowMs = Date.now();
	const recoveredClaims = await requeueStaleClaimedTaskStatuses(input.env.DB, {
		provider: ASYNC_IMAGE_DISPATCH_PROVIDER,
		staleBeforeIso: new Date(nowMs - ASYNC_IMAGE_DISPATCH_LEASE_MS).toISOString(),
		nowIso: new Date(nowMs).toISOString(),
	});
	const rows = await listTaskStatusesByProvider(input.env.DB, {
		provider: ASYNC_IMAGE_DISPATCH_PROVIDER,
		status: "waiting",
		limit: input.limit ?? 100,
	});
	let dispatched = 0;
	let waiting = 0;
	let failed = 0;
	let invalid = 0;
	for (const row of rows) {
		const contract = parseAsyncImageDispatchContractV1(row.data);
		if (!contract || contract.job.taskId !== row.task_id || contract.job.userId !== row.user_id) {
			invalid += 1;
			const completedAt = new Date().toISOString();
			await upsertTaskStatus(input.env.DB, {
				taskId: row.task_id,
				provider: ASYNC_IMAGE_DISPATCH_PROVIDER,
				userId: row.user_id,
				status: "failed",
				data: { version: 1, invalid: true, reason: "async_image_dispatch_contract_invalid" },
				completedAt,
				nowIso: completedAt,
			});
			if (row.user_id) {
				await failAsyncImageTaskByIdentity({
					env: input.env,
					userId: row.user_id,
					taskId: row.task_id,
					error: new Error("async_image_dispatch_contract_invalid"),
				});
			}
			continue;
		}
		const outcome = await dispatchAsyncImageTask(input.env, contract);
		if (outcome === "dispatched") dispatched += 1;
		else if (outcome === "waiting") waiting += 1;
		else if (outcome === "failed") failed += 1;
	}
	return { scanned: rows.length, dispatched, waiting, failed, invalid, recoveredClaims };
}

async function executeTaskWithWorkerContext(
	env: WorkerEnv,
	job: AsyncImageQueueJob,
): Promise<TaskResultDto> {
	let taskResult: unknown = null;
	let executionError: unknown = null;
	const app = new Hono<AppEnv>();
	app.post("/execute", async (c) => {
		c.set("userId", job.userId);
		c.set("activeTeamId", job.activeTeamId);
		c.set("apiKeyBillingTeamId", job.apiKeyBillingTeamId);
		if (job.apiKeyId) c.set("apiKeyId", job.apiKeyId);
		c.set("publicApi", true);
		c.set("routingTaskKind", job.request.kind);
		c.set("requestId", `async-image:${job.taskId}`);
		try {
			taskResult = await runGenericTaskForVendor(
				c,
				job.userId,
				ASYNC_IMAGE_VENDOR,
				job.request,
				{ forceTaskId: job.taskId },
			);
			return c.body(null, 204);
		} catch (error) {
			executionError = error;
			return c.body(null, 500);
		}
	});

	await app.request(
		"http://async-image-worker/execute",
		{ method: "POST" },
		env,
	);
	if (executionError) throw executionError;
	return TaskResultSchema.parse(taskResult);
}

export async function markAsyncImageQueueJobFailed(
	env: WorkerEnv,
	job: AsyncImageQueueJob,
	error: unknown,
): Promise<boolean> {
	const failedAt = new Date().toISOString();
	const failedResult = buildAsyncImageFailedResult(job, error, failedAt);
	return await failTaskResultIfNonTerminal(env.DB, {
		userId: job.userId,
		taskId: job.taskId,
		result: failedResult,
		nowIso: failedAt,
	});
}

export async function processAsyncImageTask(
	env: WorkerEnv,
	job: AsyncImageQueueJob,
): Promise<TaskResultDto> {
	const current = await getTaskResultByTaskId(env.DB, job.userId, job.taskId);
	if (!current) {
		throw new Error(`async image task row is missing: ${job.taskId}`);
	}
	if (current.status === "succeeded" || current.status === "failed") {
		return TaskResultSchema.parse(JSON.parse(current.result) as unknown);
	}

	const startedAt = new Date().toISOString();
	const runningResult = buildAsyncImageRunningResult(job, startedAt);
	const claimed = await tryClaimTaskResult(env.DB, {
		userId: job.userId,
		taskId: job.taskId,
		result: runningResult,
		nowIso: startedAt,
	});
	if (!claimed) {
		const latest = await getTaskResultByTaskId(env.DB, job.userId, job.taskId);
		if (latest?.status === "succeeded" || latest?.status === "failed") {
			return TaskResultSchema.parse(JSON.parse(latest.result) as unknown);
		}
		throw new Error(
			`async image task cannot be claimed from status ${latest?.status ?? "missing"}: ${job.taskId}`,
		);
	}

	try {
		const providerResult = await executeTaskWithWorkerContext(env, job);
		const completedAt = new Date().toISOString();
		const succeededResult = buildAsyncImageSucceededResult(
			job,
			providerResult,
			completedAt,
		);
		await upsertTaskResult(env.DB, {
			userId: job.userId,
			taskId: job.taskId,
			vendor: ASYNC_IMAGE_VENDOR,
			kind: job.request.kind,
			status: "succeeded",
			result: succeededResult,
			completedAt,
			nowIso: completedAt,
		});
		return succeededResult;
	} catch (error) {
		await markAsyncImageQueueJobFailed(env, job, error);
		throw error;
	}
}
