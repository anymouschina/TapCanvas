import type { PrismaClient } from "../../types";
import { AppError } from "../../middleware/error";
import {
	TaskAssetSchema,
	TaskInboxResponseSchema,
	TaskKindSchema,
	type TaskInboxResponseDto,
	type TaskProgressSnapshotDto,
} from "./task.schemas";
import { taskResultNotificationId } from "./task-result.repo";
import { normalizeVendorCallLogKey } from "./vendor-call-logs.repo";

const TASK_INBOX_STATUSES = ["queued", "claimed", "running", "succeeded", "failed"] as const;
const ACTIVE_TASK_STATUSES = ["queued", "claimed", "running"] as const;
const CREATIVE_TASK_KINDS = [
	"chat",
	"prompt_refine",
	"text_to_image",
	"image_to_prompt",
	"image_to_video",
	"text_to_video",
	"image_edit",
	"image_to_3d",
	"video_enhance",
	"video_edit",
	"image_remove_bg",
] as const;
const MAX_PENDING_TASKS = 500;

type PersistedTaskPayload = Readonly<{
	raw: Record<string, unknown>;
	assets: ReturnType<typeof TaskAssetSchema.parse>[];
}>;

function parsePersistedTaskPayload(rawResult: string, taskId: string): PersistedTaskPayload {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawResult);
	} catch (error: unknown) {
		throw new AppError("任务结果 JSON 已损坏", {
			status: 500,
			code: "task_result_invalid_json",
			details: { taskId, reason: error instanceof Error ? error.message : String(error) },
		});
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new AppError("任务结果必须是对象", {
			status: 500,
			code: "task_result_invalid_shape",
			details: { taskId },
		});
	}
	const record = parsed as Record<string, unknown>;
	if (!("assets" in record)) return { raw: record, assets: [] };
	const assets = TaskAssetSchema.array().safeParse(record.assets);
	if (!assets.success) {
		throw new AppError("任务资产记录已损坏", {
			status: 500,
			code: "task_result_assets_invalid",
			details: { taskId, issues: assets.error.issues },
		});
	}
	return { raw: record, assets: assets.data };
}

function normalizeTaskStatus(status: string): "queued" | "running" | "succeeded" | "failed" {
	if (status === "queued") return "queued";
	if (status === "claimed" || status === "running") return "running";
	if (status === "succeeded") return "succeeded";
	if (status === "failed") return "failed";
	throw new AppError("该任务状态无法显示在创作动态中", {
		status: 500,
		code: "task_inbox_status_invalid",
		details: { status },
	});
}

function parseJsonObject(raw: string | null, taskId: string, source: "request" | "result"): Record<string, unknown> | null {
	if (!raw) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error: unknown) {
		throw new AppError(`任务${source === "request" ? "请求" : "结果"} JSON 已损坏`, {
			status: 500,
			code: source === "request" ? "task_request_invalid_json" : "task_result_invalid_json",
			details: { taskId, reason: error instanceof Error ? error.message : String(error) },
		});
	}
	return parsed && typeof parsed === "object" && !Array.isArray(parsed)
		? parsed as Record<string, unknown>
		: null;
}

function readObjectPath(record: Record<string, unknown>, path: readonly string[]): unknown {
	let current: unknown = record;
	for (const segment of path) {
		if (!current || typeof current !== "object" || Array.isArray(current)) return null;
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

function readFirstText(record: Record<string, unknown> | null, paths: readonly (readonly string[])[]): string | null {
	if (!record) return null;
	for (const path of paths) {
		const value = readObjectPath(record, path);
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return null;
}

const PROMPT_PATHS = [
	["prompt"],
	["request", "prompt"],
	["request", "request", "prompt"],
	["upstreamBody", "prompt"],
	["request", "upstreamBody", "prompt"],
] as const;

const ERROR_PATHS = [
	["error"],
	["failureReason"],
	["message"],
	["raw", "error"],
	["raw", "failureReason"],
	["raw", "message"],
] as const;

export async function listTaskInbox(
	db: PrismaClient,
	input: { userId: string; cursor?: string; limit: number },
): Promise<TaskInboxResponseDto> {
	const userId = input.userId.trim();
	if (!userId) throw new AppError("缺少创作动态用户标识", { status: 401, code: "unauthorized" });

	const rows = await db.task_results.findMany({
		where: {
			user_id: userId,
			status: { in: [...TASK_INBOX_STATUSES] },
			kind: { in: [...CREATIVE_TASK_KINDS] },
		},
		orderBy: [{ updated_at: "desc" }, { task_id: "desc" }],
		take: input.limit + 1,
		...(input.cursor
			? { cursor: { user_id_task_id: { user_id: userId, task_id: input.cursor } }, skip: 1 }
			: {}),
	});

	const hasMore = rows.length > input.limit;
	const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
	const notificationIds = pageRows.map((row) => taskResultNotificationId(userId, row.task_id));
	const taskIds = pageRows.map((row) => row.task_id);
	const [notifications, callLogs] = await Promise.all([
		notificationIds.length > 0 ? db.user_notifications.findMany({
			where: { user_id: userId, id: { in: notificationIds } },
			select: { id: true, read_at: true },
		}) : [],
		taskIds.length > 0 ? db.vendor_api_call_logs.findMany({
			where: { user_id: userId, task_id: { in: taskIds } },
			select: {
				vendor: true,
				task_id: true,
				request_json: true,
				error_message: true,
				updated_at: true,
			},
			orderBy: { updated_at: "desc" },
		}) : [],
	]);
	const notificationsById = new Map(notifications.map((item) => [item.id, item]));
	const callLogsByTaskId = new Map<string, typeof callLogs[number]>();
	for (const row of pageRows) {
		const candidates = callLogs.filter((log) => log.task_id === row.task_id);
		const matched = candidates.find(
			(log) => normalizeVendorCallLogKey(row.vendor) === normalizeVendorCallLogKey(log.vendor),
		) ?? candidates[0];
		if (matched) callLogsByTaskId.set(row.task_id, matched);
	}

	return TaskInboxResponseSchema.parse({
		items: pageRows.map((row) => {
			const payload = parsePersistedTaskPayload(row.result, row.task_id);
			const resultRecord = parseJsonObject(row.result, row.task_id, "result");
			const callLog = callLogsByTaskId.get(row.task_id) ?? null;
			const requestRecord = parseJsonObject(callLog?.request_json ?? null, row.task_id, "request");
			const notification = notificationsById.get(taskResultNotificationId(userId, row.task_id));
			return {
				taskId: row.task_id,
				vendor: row.vendor,
				kind: row.kind,
				status: normalizeTaskStatus(row.status),
				assetCount: payload.assets.length,
				assets: payload.assets,
				prompt: readFirstText(requestRecord, PROMPT_PATHS) ?? readFirstText(resultRecord, PROMPT_PATHS),
				errorMessage: callLog?.error_message?.trim() || readFirstText(resultRecord, ERROR_PATHS),
				nodeId: row.node_id,
				chapterId: row.chapter_id,
				createdAt: row.created_at,
				updatedAt: row.updated_at,
				completedAt: row.completed_at,
				notificationId: notification?.id ?? null,
				readAt: notification?.read_at ?? null,
			};
		}),
		nextCursor: hasMore && pageRows.length > 0 ? pageRows[pageRows.length - 1].task_id : null,
		unreadCount: notifications.filter((notification) => notification.read_at === null).length,
	});
}

export async function listDurablePendingTaskSnapshots(
	db: PrismaClient,
	input: { userId: string; vendor?: string },
): Promise<TaskProgressSnapshotDto[]> {
	const rows = await db.task_results.findMany({
		where: {
			user_id: input.userId,
			status: { in: [...ACTIVE_TASK_STATUSES] },
			...(input.vendor ? { vendor: input.vendor } : {}),
		},
		orderBy: [{ updated_at: "desc" }, { task_id: "desc" }],
		take: MAX_PENDING_TASKS + 1,
	});
	if (rows.length > MAX_PENDING_TASKS) {
		throw new AppError("待处理任务超过单次恢复上限", {
			status: 409,
			code: "pending_task_restore_limit_exceeded",
			details: { limit: MAX_PENDING_TASKS },
		});
	}
	return rows.map((row) => {
		const payload = parsePersistedTaskPayload(row.result, row.task_id);
		const parsedKind = TaskKindSchema.safeParse(row.kind);
		const timestamp = Date.parse(row.updated_at);
		if (!Number.isFinite(timestamp)) {
			throw new AppError("任务更新时间不是有效时间", {
				status: 500,
				code: "task_result_timestamp_invalid",
				details: { taskId: row.task_id, updatedAt: row.updated_at },
			});
		}
		return {
			taskId: row.task_id,
			nodeId: row.node_id ?? undefined,
			taskKind: parsedKind.success ? parsedKind.data : undefined,
			vendor: row.vendor,
			status: normalizeTaskStatus(row.status),
			assets: payload.assets,
			raw: payload.raw,
			timestamp,
		};
	});
}
