import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	RunTaskRequestSchema,
	TaskResultSchema,
	TaskProgressSnapshotSchema,
	FetchTaskResultRequestSchema,
	VendorCallLogListResponseSchema,
	VendorCallLogStatusSchema,
	VendorCallLogSchema,
} from "./task.schemas";
import { upsertTaskResult } from "./task-result.repo";
import { getPrismaClient } from "../../platform/node/prisma";
import {
	fetchNewApiTaskResult,
	runGenericTaskForVendor,
} from "./task.service";
import { normalizeImageEditRequestKind, normalizeTaskAssetBackedVideoRequest } from "../apiKey/apiKey.routes";
import { getPendingTaskSnapshots } from "./task.progress";
import { listVendorCallLogs } from "./vendor-call-logs.repo";
import { fetchTaskResultForPolling } from "./task.polling";
import { maybeWrapSyncImageResultAsStoredTask } from "./task.task-store-wrap";

export const taskRouter = new Hono<AppEnv>();

const LOG_PREVIEW_MAX_DEPTH = 4;
const LOG_PREVIEW_MAX_KEYS = 24;
const LOG_PREVIEW_MAX_ARRAY = 12;
const LOG_PREVIEW_MAX_STRING = 400;

taskRouter.use("*", authMiddleware);

function buildLogPayloadPreview(raw: string | null | undefined): string | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;

	const sanitizeString = (value: string, keyPath: string[]): string => {
		const normalized = value.trim();
		const lastKey = keyPath[keyPath.length - 1]?.trim().toLowerCase() || "";
		if (/^(data|binary|bytes|base64)$/i.test(lastKey)) {
			return `[omitted-binary-string len=${normalized.length}]`;
		}
		if (/^data:[^,]+,/.test(normalized)) {
			return `[data-url len=${normalized.length}]`;
		}
		if (normalized.length <= LOG_PREVIEW_MAX_STRING) return normalized;
		return `${normalized.slice(0, LOG_PREVIEW_MAX_STRING)}…(truncated, len=${normalized.length})`;
	};

	const walk = (value: unknown, depth: number, keyPath: string[]): unknown => {
		if (value === null || value === undefined) return value;
		if (typeof value === "string") return sanitizeString(value, keyPath);
		if (
			typeof value === "number" ||
			typeof value === "boolean" ||
			typeof value === "bigint"
		) {
			return value;
		}
		if (typeof value !== "object") return String(value);
		if (depth >= LOG_PREVIEW_MAX_DEPTH) {
			return `[max-depth:${LOG_PREVIEW_MAX_DEPTH}]`;
		}
		if (Array.isArray(value)) {
			const items = value
				.slice(0, LOG_PREVIEW_MAX_ARRAY)
				.map((item, index) => walk(item, depth + 1, [...keyPath, String(index)]));
			if (value.length > LOG_PREVIEW_MAX_ARRAY) {
				items.push(`[...omitted ${value.length - LOG_PREVIEW_MAX_ARRAY} items]`);
			}
			return items;
		}

		const entries = Object.entries(value);
		const out: Record<string, unknown> = {};
		for (const [index, entry] of entries.entries()) {
			if (index >= LOG_PREVIEW_MAX_KEYS) break;
			const [key, child] = entry;
			out[key] = walk(child, depth + 1, [...keyPath, key]);
		}
		if (entries.length > LOG_PREVIEW_MAX_KEYS) {
			out.__omittedKeys = entries.length - LOG_PREVIEW_MAX_KEYS;
		}
		return out;
	};

	try {
		return JSON.stringify(walk(JSON.parse(trimmed), 0, []));
	} catch {
		return sanitizeString(trimmed, []);
	}
}

function isLocalDevRequest(c: any): boolean {
	try {
		const url = new URL(c.req.url);
		const host = url.hostname;
		return (
			host === "localhost" ||
			host === "127.0.0.1" ||
			host === "0.0.0.0" ||
			host === "::1"
		);
	} catch {
		return false;
	}
}

function isAdminRequest(c: any): boolean {
	if (isLocalDevRequest(c)) return true;
	const auth = c.get("auth") as { role?: string | null } | undefined;
	return auth?.role === "admin";
}

type FetchTaskResultRequestDto = ReturnType<
	typeof FetchTaskResultRequestSchema.parse
>;

async function parseFetchTaskResultBody(
	c: any,
): Promise<
	| { ok: true; data: FetchTaskResultRequestDto }
	| { ok: false; response: Response }
> {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = FetchTaskResultRequestSchema.safeParse(body);
	if (!parsed.success) {
		return {
			ok: false,
			response: c.json(
				{ error: "Invalid request body", issues: parsed.error.issues },
				400,
			),
		};
	}
	return { ok: true, data: parsed.data };
}

function registerVendorResultRoute(
	path: string,
	handler: (
		c: any,
		userId: string,
		body: FetchTaskResultRequestDto,
	) => Promise<unknown>,
) {
	taskRouter.post(path, async (c) => {
		const userId = c.get("userId");
		if (!userId) return c.json({ error: "Unauthorized" }, 401);
		const parsed = await parseFetchTaskResultBody(c);
		if (!parsed.ok) return parsed.response;
		const result = await handler(c, userId, parsed.data);
		return c.json(TaskResultSchema.parse(result));
	});
}

// POST /tasks - unified vendor-based tasks
taskRouter.post("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);

	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = RunTaskRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const payload = parsed.data;

	// profileId-based执行（按模型预设）暂未在 Worker 中实现
	if ("profileId" in payload) {
		return c.json(
			{
				error:
					"profile-based tasks are not yet supported in Worker backend",
				code: "profile_tasks_not_implemented",
			},
			400,
		);
	}

	const vendor = "newapi";
	const req = await normalizeTaskAssetBackedVideoRequest(
		c as any,
		userId,
		normalizeImageEditRequestKind(payload.request),
	) as typeof payload.request;

	let result = await runGenericTaskForVendor(c, userId, vendor, req);

	result = await maybeWrapSyncImageResultAsStoredTask(c as any, userId, {
		vendor,
		requestKind: req.kind,
		result: result as any,
	});

	// Persist final result so callers can safely poll /tasks/result even for sync vendors.
	try {
		const taskId =
			typeof result?.id === "string"
				? result.id.trim()
				: String(result?.id || "").trim();
		const status =
			typeof result?.status === "string" ? result.status.trim() : "";
		const kind =
			typeof result?.kind === "string"
				? result.kind.trim()
				: String(req.kind || "").trim();
		if (taskId && kind && (status === "succeeded" || status === "failed")) {
			const nowIso = new Date().toISOString();
			await upsertTaskResult(c.env.DB, {
				userId,
				taskId,
				vendor,
				kind,
				status,
				result,
				completedAt: nowIso,
				nowIso,
			});
		}
	} catch (err: any) {
		console.warn(
			"[task-store] persist task result failed",
			err?.message || err,
		);
	}

	return c.json(TaskResultSchema.parse(result));
});

// GET /tasks/pending - placeholder implementation for now
taskRouter.get("/pending", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const vendor = c.req.query("vendor") || undefined;
	const items = getPendingTaskSnapshots(userId, vendor);
	return c.json(
		items.map((x) => TaskProgressSnapshotSchema.parse(x)),
	);
});

// GET /tasks/logs - per-user generation logs (vendor_api_call_logs)
taskRouter.get("/logs", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const isAdmin = isAdminRequest(c);

	const limitRaw = c.req.query("limit");
	const parsedLimit = Number(limitRaw ?? 20);
	const maxLimit = isAdmin ? 100 : 20;
	const limit = Number.isFinite(parsedLimit)
		? Math.max(1, Math.min(maxLimit, Math.floor(parsedLimit)))
		: 20;

	const queryUserIdRaw = c.req.query("userId");
	const queryUserId =
		typeof queryUserIdRaw === "string" && queryUserIdRaw.trim()
			? queryUserIdRaw.trim()
			: null;
	if (!isAdmin && queryUserId && queryUserId !== userId) {
		return c.json({ error: "Forbidden" }, 403);
	}

	const before = c.req.query("before") || null;
	const vendor = c.req.query("vendor") || null;

	const statusRaw = c.req.query("status") || null;
	const statusParsed = (() => {
		if (!statusRaw) return null;
		const parsed = VendorCallLogStatusSchema.safeParse(statusRaw);
		return parsed.success ? parsed.data : null;
	})();

	const taskKind = c.req.query("taskKind") || null;

	const targetUserId = isAdmin ? queryUserId : userId;

	// Fetch one extra row to detect "hasMore"
	const rows = await listVendorCallLogs(c.env.DB, {
		userId: targetUserId,
		limit: limit + 1,
		before,
		vendor,
		status: statusParsed,
		taskKind,
	});

	const hasMore = rows.length > limit;
	const sliced = hasMore ? rows.slice(0, limit) : rows;
	const items = sliced.map((r) =>
		VendorCallLogSchema.parse({
			vendor: r.vendor,
			taskId:
				typeof r.task_id === "string" && r.task_id.trim()
					? r.task_id
					: typeof r.row_id === "number" && Number.isFinite(r.row_id)
					? `row_${r.row_id}`
					: `missing_${String(r.vendor || "unknown")}_${String(r.created_at || "")}`,
			userId: r.user_id,
			userLogin: r.user_login ?? null,
			userName: r.user_name ?? null,
			taskKind: r.task_kind ?? null,
			status: r.status,
			startedAt: r.started_at ?? null,
			finishedAt: r.finished_at ?? null,
			durationMs:
				typeof r.duration_ms === "number" && Number.isFinite(r.duration_ms)
					? Math.round(r.duration_ms)
					: null,
			errorMessage: r.error_message ?? null,
			requestPayload: buildLogPayloadPreview(r.request_json),
			upstreamResponse: buildLogPayloadPreview(r.response_json),
			createdAt: r.created_at,
			updatedAt: r.updated_at,
		}),
	);

	const nextBefore =
		items.length > 0 ? items[items.length - 1]!.createdAt : null;

	return c.json(
		VendorCallLogListResponseSchema.parse({
			items,
			hasMore,
			nextBefore,
		}),
	);
});

// POST /tasks/result - unified task polling endpoint (prefers stored results)
taskRouter.post("/result", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const parsed = await parseFetchTaskResultBody(c);
	if (!parsed.ok) return parsed.response;

	const outcome = await fetchTaskResultForPolling(c as any, userId, {
		taskId: parsed.data.taskId,
		taskKind: parsed.data.taskKind ?? null,
		prompt: typeof parsed.data.prompt === "string" ? parsed.data.prompt : null,
		mode: "internal",
	});
	if (outcome.ok) return c.json(outcome.result);
	return c.json((outcome as any).body, (outcome as any).status);
});

registerVendorResultRoute("/veo/result", async (c, userId, body) => {
	const result = await fetchNewApiTaskResult(c, userId, body.taskId, {
		taskKind: (body.taskKind as any) ?? null,
		vendor: "newapi",
		promptFromClient: body.prompt ?? null,
	});
	return result;
});

registerVendorResultRoute("/apimart/result", (c, userId, body) =>
	fetchNewApiTaskResult(c, userId, body.taskId, {
		taskKind: (body.taskKind as any) ?? null,
		vendor: "newapi",
		promptFromClient: body.prompt ?? null,
	}),
);

registerVendorResultRoute("/grsai/result", (c, userId, body) =>
	fetchNewApiTaskResult(c, userId, body.taskId, {
		taskKind: (body.taskKind as any) ?? null,
		vendor: "newapi",
		promptFromClient: body.prompt ?? null,
	}),
);

taskRouter.get("/:taskId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const taskId = c.req.param("taskId");

	const prisma = getPrismaClient();
	const row = await prisma.task_results.findUnique({
		where: { user_id_task_id: { user_id: userId, task_id: taskId } },
	});
	if (!row) return c.json({ error: "not_found" }, 404);

	const assetUri =
		row.status === "done" || row.status === "completed" ? `tapcanvas://image/${taskId}` : null;

	return c.json({
		taskId,
		status: row.status,
		assetUri,
		chapterId: row.chapter_id ?? null,
		nodeId: row.node_id ?? null,
	});
});

taskRouter.post("/:taskId/link", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const taskId = c.req.param("taskId");
	const body = await c.req.json().catch(() => ({}));
	const chapterId = typeof body.chapterId === "string" ? body.chapterId.trim() : null;
	const nodeId = typeof body.nodeId === "string" ? body.nodeId.trim() : null;
	if (!chapterId || !nodeId) return c.json({ error: "chapterId and nodeId required" }, 400);

	await upsertTaskResult(c.env.DB, {
		userId,
		taskId,
		vendor: "n/a",
		kind: "n/a",
		status: "linked",
		result: null,
		nowIso: new Date().toISOString(),
		chapterId,
		nodeId,
	});
	return c.json({ ok: true });
});

// POST /tasks/gemini/result - legacy endpoint path; polling is handled by new-api.
taskRouter.post("/gemini/result", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const parsed = await parseFetchTaskResultBody(c);
	if (!parsed.ok) return parsed.response;

	const taskKind = parsed.data.taskKind ?? null;
	if (taskKind && taskKind !== "text_to_image" && taskKind !== "image_edit") {
		return c.json(
			{
				error: "gemini result endpoint only supports text_to_image/image_edit polling",
				code: "invalid_task_kind",
			},
			400,
		);
	}

	const result = await fetchNewApiTaskResult(c, userId, parsed.data.taskId, {
		taskKind: (taskKind as any) ?? null,
		vendor: "newapi",
		promptFromClient: parsed.data.prompt ?? null,
	});
	return c.json(TaskResultSchema.parse(result));
});
