import type { AppContext } from "../../types";
import {
	TaskResultSchema,
	type TaskRequestDto,
} from "./task.schemas";
import { upsertTaskResult } from "./task-result.repo";
import { upsertVendorTaskRef } from "./vendor-task-refs.repo";

type TaskResult = ReturnType<typeof TaskResultSchema.parse>;

export type StoredTaskRefKind = "video" | "image";
type VendorTaskRefKind = "video" | "image";

export function resolveStoredTaskId(options?: { taskId?: string | null }): string {
	const taskIdFromClient =
		typeof options?.taskId === "string" && options.taskId.trim()
			? options.taskId.trim()
			: "";
	return taskIdFromClient || `task_${crypto.randomUUID()}`;
}

export function resolveStoredTaskRefKind(
	kind: TaskRequestDto["kind"],
): StoredTaskRefKind | null {
	if (kind === "text_to_video" || kind === "image_to_video") return "video";
	if (kind === "text_to_image" || kind === "image_edit") return "image";
	return null;
}

function resolveTaskErrorMessage(err: unknown, fallback = "任务执行失败"): string {
	const message = (err as any)?.message;
	return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

export function buildStoredQueuedTaskResult(input: {
	taskId: string;
	kind: TaskRequestDto["kind"];
	vendor: string;
	enqueuedAt: string;
	rawExtra?: Record<string, unknown>;
}): TaskResult {
	return TaskResultSchema.parse({
		id: input.taskId,
		kind: input.kind,
		status: "queued",
		assets: [],
		raw: {
			provider: "task_store",
			vendor: input.vendor,
			mode: "async",
			enqueuedAt: input.enqueuedAt,
			...(input.rawExtra || {}),
		},
	});
}

export function buildStoredRunningTaskResult(input: {
	initial: TaskResult;
	startedAt: string;
	rawExtra?: Record<string, unknown>;
}): TaskResult {
	return TaskResultSchema.parse({
		...input.initial,
		status: "running",
		raw: {
			...(typeof input.initial.raw === "object" && input.initial.raw
				? (input.initial.raw as any)
				: {}),
			startedAt: input.startedAt,
			...(input.rawExtra || {}),
		},
	});
}

export function buildStoredFailedTaskResult(input: {
	taskId: string;
	kind: TaskRequestDto["kind"];
	vendor: string;
	err: unknown;
	rawExtra?: Record<string, unknown>;
}): TaskResult {
	return TaskResultSchema.parse({
		id: input.taskId,
		kind: input.kind,
		status: "failed",
		assets: [],
		raw: {
			provider: "task_store",
			vendor: input.vendor,
			mode: "async",
			error: resolveTaskErrorMessage(input.err),
			stack:
				typeof (input.err as any)?.stack === "string"
					? (input.err as any).stack
					: undefined,
			...(input.rawExtra || {}),
		},
	});
}

export async function persistStoredTaskResult(
	c: AppContext,
	input: {
		userId: string;
		taskId: string;
		vendor: string;
		kind: TaskRequestDto["kind"];
		result: TaskResult;
		completedAt?: string | null;
		nowIso?: string;
	},
): Promise<void> {
	const completedAt = input.completedAt ?? null;
	const nowIso = input.nowIso ?? completedAt ?? new Date().toISOString();
	await upsertTaskResult(c.env.DB, {
		userId: input.userId,
		taskId: input.taskId,
		vendor: input.vendor,
		kind: input.kind,
		status: input.result.status,
		result: input.result,
		completedAt,
		nowIso,
	});
}

export async function upsertStoredTaskRefSafely(
	c: AppContext,
	input: {
		userId: string;
		refKind: StoredTaskRefKind | null;
		taskId: string;
		vendor: string;
		nowIso: string;
		warnTag: string;
	},
): Promise<void> {
	if (!input.refKind) return;
	try {
		await upsertVendorTaskRef(
			c.env.DB,
			input.userId,
			{ kind: input.refKind as any, taskId: input.taskId, vendor: input.vendor },
			input.nowIso,
		);
	} catch (err: any) {
		console.warn(
			`[vendor-task-refs] ${input.warnTag}`,
			err?.message || err,
		);
	}
}

export async function upsertVendorTaskRefWithWarn(
	c: AppContext,
	input: {
		userId: string;
		kind: VendorTaskRefKind;
		taskId: string;
		vendor: string;
		pid?: string;
		nowIso?: string;
		warnTag: string;
	},
): Promise<void> {
	const taskId = (input.taskId || "").trim();
	if (!taskId) return;
	const nowIso = input.nowIso || new Date().toISOString();
	try {
		await upsertVendorTaskRef(
			c.env.DB,
			input.userId,
			{
				kind: input.kind,
				taskId,
				vendor: input.vendor,
				...(typeof input.pid === "string" && input.pid.trim()
					? { pid: input.pid.trim() }
					: {}),
			},
			nowIso,
		);
	} catch (err: any) {
		console.warn(
			`[vendor-task-refs] ${input.warnTag}`,
			err?.message || err,
		);
	}
}

export function resolveImageVendorApiKeyMissingMessage(input: {
	isApimartBase: boolean;
	isYunwuBase: boolean;
}): string {
	if (input.isApimartBase) return "未配置 apimart API Key";
	if (input.isYunwuBase) return "未配置 yunwu API Key";
	return "未配置上游厂商 API Key";
}
