import { Hono } from "hono";
import {
	type CodexCanvasContextSnapshot,
	type CodexTask,
} from "@tapcanvas/codex-task-protocol";
import {
	CodexBridgeHeartbeatSchema,
	CodexBridgeListResponseSchema,
	CodexBridgeSummarySchema,
	CodexFallbackDecisionSchema,
	CodexPairingExchangeRequestSchema,
	CodexPairingExchangeResponseSchema,
	CodexPairingSessionSchema,
	CodexPreviewResolutionSchema,
	CodexRemoteBuildRequestSchema,
	CodexRemoteBuildResponseSchema,
	CodexSourceUploadRequestSchema,
	CodexSourceUploadResponseSchema,
	CodexSourceDiscardRequestSchema,
	CodexTaskMessageAckRequestSchema,
	CodexTaskMessageClaimRequestSchema,
	CodexTaskMessageClaimResponseSchema,
	CodexTaskMessageListResponseSchema,
	CodexTaskClaimRequestSchema,
	CodexTaskClaimResponseSchema,
	CodexTaskLeaseHeartbeatSchema,
	CodexTaskListResponseSchema,
	CodexTaskWorkerUpdateSchema,
	CreateCodexTaskRequestSchema,
	CreateCodexTaskResponseSchema,
	CreateCodexTaskMessageRequestSchema,
	CreateCodexTaskMessageResponseSchema,
} from "./codex.schemas";
import { AppError } from "../../middleware/error";
import type { AppContext, AppEnv, WorkerEnv } from "../../types";
import { apiKeyAuthMiddleware } from "../apiKey/apiKey.middleware";
import { getSharedRedis } from "../../platform/redis-shared";
import { getProjectForUserAccess } from "../project/project.repo";
import {
	CodexLeaseConflictError,
	CodexQueueUnavailableError,
	requireCodexQueueStore,
	type EnqueueCodexTaskMessageResult,
} from "./codex-queue-store";
import {
	CodexPairingRateLimitError,
	requireCodexPairingStore,
} from "./codex-pairing-store";
import { createApiKey } from "../apiKey/apiKey.service";
import { assertCodexRemoteBuilderConfigured } from "./codex-remote-builder-config";
import {
	assertCodexRemoteBuilderReady,
	CodexRemoteBuilderOfflineError,
} from "./codex-remote-builder-readiness";
import {
	codexSourceObjectKey,
	createCodexSourceUpload,
	deleteCodexSourceObject,
	verifyCodexSourceObject,
} from "./codex-source-storage";
import { enqueueCodexRemoteBuild } from "./codex-remote-build-queue";
import {
	CodexCanvasContextSnapshotError,
	createCodexCanvasContextSnapshot,
} from "./codex-context-snapshot";
import {
	CodexSessionTurnError,
	resolveCodexSessionTurn,
	type CodexSessionTurn,
} from "./codex-session-turn";

export const codexRouter = new Hono<AppEnv>();
export const codexPairingPublicRouter = new Hono<AppEnv>();
codexRouter.use("*", apiKeyAuthMiddleware);

function requireUserId(c: AppContext): string {
	const userId = String(c.get("userId") || "").trim();
	if (!userId) {
		throw new AppError("Unauthorized", {
			status: 401,
			code: "codex_auth_required",
		});
	}
	return userId;
}

function queueStoreOrThrow() {
	try {
		return requireCodexQueueStore();
	} catch (error: unknown) {
		if (error instanceof CodexQueueUnavailableError) {
			throw new AppError(error.message, {
				status: 503,
				code: "codex_queue_unavailable",
			});
		}
		throw error;
	}
}

function pairingStoreOrThrow() {
	try {
		return requireCodexPairingStore();
	} catch (error: unknown) {
		if (error instanceof CodexQueueUnavailableError) {
			throw new AppError(error.message, {
				status: 503,
				code: "codex_pairing_unavailable",
			});
		}
		throw error;
	}
}

async function requireCodexRemoteBuilderReady(
	env: WorkerEnv,
): Promise<void> {
	try {
		assertCodexRemoteBuilderConfigured(env);
	} catch (error: unknown) {
		throw new AppError(
			`远程 Sandbox 构建服务配置无效：${
				error instanceof Error ? error.message : String(error)
			}`,
			{
				status: 503,
				code: "codex_remote_builder_unavailable",
			},
		);
	}
	const redis = getSharedRedis();
	if (!redis) {
		throw new AppError(
			"远程 Sandbox 构建服务无法检查就绪状态：REDIS_URL 未配置",
			{
				status: 503,
				code: "codex_remote_builder_readiness_unavailable",
			},
		);
	}
	try {
		await assertCodexRemoteBuilderReady({ redis, env });
	} catch (error: unknown) {
		if (error instanceof CodexRemoteBuilderOfflineError) {
			throw new AppError(
				"远程 Sandbox 构建 worker 当前不在线；未创建任务，也未写入构建队列",
				{
					status: 503,
					code: "codex_remote_builder_offline",
				},
			);
		}
		throw new AppError(
			`远程 Sandbox 构建服务就绪检查失败：${
				error instanceof Error ? error.message : String(error)
			}`,
			{
				status: 503,
				code: "codex_remote_builder_readiness_unavailable",
			},
		);
	}
}

async function parseJsonBody(c: AppContext): Promise<unknown> {
	try {
		return await c.req.json();
	} catch {
		throw new AppError("请求体不是合法 JSON", {
			status: 400,
			code: "codex_invalid_json",
		});
	}
}

function throwLeaseError(error: unknown): never {
	if (error instanceof CodexLeaseConflictError) {
		throw new AppError(error.message, {
			status: 409,
			code: "codex_lease_conflict",
		});
	}
	throw error;
}

function throwContextSnapshotError(error: unknown): never {
	if (error instanceof CodexCanvasContextSnapshotError) {
		throw new AppError(error.message, {
			status: error.status,
			code: error.code,
			details: error.details ?? undefined,
		});
	}
	throw error;
}

codexRouter.get("/bridges", async (c) => {
	const userId = requireUserId(c);
	const items = await queueStoreOrThrow().listBridges(userId);
	return c.json(CodexBridgeListResponseSchema.parse({ items }));
});

codexRouter.post("/pairings", async (c) => {
	const userId = requireUserId(c);
	try {
		const session = await pairingStoreOrThrow().create(userId, new Date());
		return c.json(CodexPairingSessionSchema.parse(session), 201);
	} catch (error: unknown) {
		if (error instanceof CodexPairingRateLimitError) {
			c.header("Retry-After", "2");
			throw new AppError(error.message, {
				status: 429,
				code: "codex_pairing_rate_limited",
			});
		}
		throw error;
	}
});

codexRouter.get("/tasks", async (c) => {
	const userId = requireUserId(c);
	const rawLimit = Number(c.req.query("limit") || "20");
	const limit = Number.isFinite(rawLimit)
		? Math.min(Math.max(1, Math.trunc(rawLimit)), 50)
		: 20;
	const items = await queueStoreOrThrow().listRecentTasks(userId, limit);
	return c.json(CodexTaskListResponseSchema.parse({ items }));
});

codexRouter.post("/tasks", async (c) => {
	const userId = requireUserId(c);
	const parsed = CreateCodexTaskRequestSchema.safeParse(await parseJsonBody(c));
	if (!parsed.success) {
		throw new AppError("Codex 任务参数不合法", {
			status: 400,
			code: "codex_task_invalid",
			details: { issues: parsed.error.issues },
		});
	}
	const store = queueStoreOrThrow();
	await requireCodexRemoteBuilderReady(c.env);
	const bridge = await store.getOnlineBridge(userId, parsed.data.bridgeId);
	if (!bridge) {
		throw new AppError("指定的宿主机 Codex Bridge 当前不在线", {
			status: 409,
			code: "codex_bridge_offline",
		});
	}
	const workspace = bridge.workspaces.find(
		(item) => item.id === parsed.data.workspaceId,
	);
	if (!workspace) {
		throw new AppError("Bridge 未授权该 workspaceId", {
			status: 403,
			code: "codex_workspace_not_authorized",
		});
	}
	if (!workspace.remoteBuildConfigured) {
		throw new AppError("该 workspace 未配置远程 Sandbox 构建", {
			status: 409,
			code: "codex_remote_build_not_configured",
		});
	}
	if (
		parsed.data.fallbackPolicy === "ask" &&
		!workspace.localDockerConfigured
	) {
		throw new AppError(
			"任务要求可申请本机 Docker fallback，但该 workspace 未配置本机隔离构建",
			{
				status: 409,
				code: "codex_local_fallback_not_configured",
			},
		);
	}
	const project = await getProjectForUserAccess(
		c.env.DB,
		parsed.data.context.projectId,
		userId,
	);
	if (!project) {
		throw new AppError("无权访问任务指定的画布项目", {
			status: 403,
			code: "codex_canvas_project_forbidden",
		});
	}
	const now = new Date();
	let sessionTurn: CodexSessionTurn;
	try {
		sessionTurn = await resolveCodexSessionTurn({
			getTask: (sessionUserId, taskId) =>
				store.getTask(sessionUserId, taskId),
			userId,
			bridgeId: parsed.data.bridgeId,
			workspaceId: parsed.data.workspaceId,
			sessionId: parsed.data.sessionId,
			parentTaskId: parsed.data.parentTaskId,
			context: parsed.data.context,
		});
	} catch (error: unknown) {
		if (error instanceof CodexSessionTurnError) {
			throw new AppError(error.message, {
				status: error.status,
				code: error.code,
				details: error.details ?? undefined,
			});
		}
		throw error;
	}
	let contextSnapshot: CodexCanvasContextSnapshot;
	try {
		contextSnapshot = await createCodexCanvasContextSnapshot({
			c: c as AppContext,
			userId,
			project: { id: project.id, name: project.name },
			scope: parsed.data.context,
			nowIso: now.toISOString(),
		});
	} catch (error: unknown) {
		throwContextSnapshotError(error);
	}
	const result = await store.enqueueTask({
		userId,
		request: parsed.data,
		...sessionTurn,
		contextSnapshot,
		workspaceConfigFingerprint: workspace.configFingerprint,
		nowIso: now.toISOString(),
		nowMs: now.getTime(),
	});
	if (result.kind === "rate_limited") {
		c.header("Retry-After", String(result.retryAfterSeconds));
		throw new AppError("Codex 任务派发超过 QPS 限制", {
			status: 429,
			code: "codex_enqueue_rate_limited",
			details: { retryAfterSeconds: result.retryAfterSeconds },
		});
	}
	if (result.kind === "user_queue_full") {
		throw new AppError("当前用户的 Codex 持久队列已满", {
			status: 429,
			code: "codex_user_queue_full",
		});
	}
	if (result.kind === "global_queue_full") {
		throw new AppError("Codex 全局持久队列已满", {
			status: 503,
			code: "codex_global_queue_full",
		});
	}
	if (result.kind === "session_conflict") {
		throw new AppError("Codex 会话已出现更新的回合，请刷新后再发送", {
			status: 409,
			code: "codex_session_turn_conflict",
			details: { latestTaskId: result.latestTaskId },
		});
	}
	const response = CreateCodexTaskResponseSchema.parse({
		task: result.task,
		deduplicated: result.kind === "deduplicated",
		queuePosition:
			result.kind === "created" ? result.queuePosition : null,
	});
	return c.json(response, result.kind === "created" ? 202 : 200);
});

codexRouter.get("/tasks/:taskId", async (c) => {
	const userId = requireUserId(c);
	const task = await queueStoreOrThrow().getTask(
		userId,
		c.req.param("taskId"),
	);
	if (!task) {
		throw new AppError("Codex task not found", {
			status: 404,
			code: "codex_task_not_found",
		});
	}
	return c.json(task);
});

codexRouter.get("/tasks/:taskId/events", async (c) => {
	const userId = requireUserId(c);
	const taskId = c.req.param("taskId");
	const store = queueStoreOrThrow();
	const task = await store.getTask(userId, taskId);
	if (!task) {
		throw new AppError("Codex task not found", {
			status: 404,
			code: "codex_task_not_found",
		});
	}
	const items = await store.listTaskEvents(userId, taskId);
	return c.json({ items });
});

codexRouter.post("/tasks/:taskId/messages", async (c) => {
	const userId = requireUserId(c);
	const parsed = CreateCodexTaskMessageRequestSchema.safeParse(
		await parseJsonBody(c),
	);
	if (!parsed.success) {
		throw new AppError("Codex 补充消息参数不合法", {
			status: 400,
			code: "codex_task_message_invalid",
			details: { issues: parsed.error.issues },
		});
	}
	let result: EnqueueCodexTaskMessageResult | null;
	try {
		result = await queueStoreOrThrow().enqueueTaskMessage({
			userId,
			taskId: c.req.param("taskId"),
			request: parsed.data,
			nowIso: new Date().toISOString(),
		});
	} catch (error: unknown) {
		if (error instanceof CodexLeaseConflictError) {
			throw new AppError(error.message, {
				status: 409,
				code: "codex_task_message_closed",
			});
		}
		throw error;
	}
	if (!result) {
		throw new AppError("Codex task not found", {
			status: 404,
			code: "codex_task_not_found",
		});
	}
	return c.json(
		CreateCodexTaskMessageResponseSchema.parse(result),
		result.deduplicated ? 200 : 202,
	);
});

codexRouter.get("/tasks/:taskId/messages", async (c) => {
	const userId = requireUserId(c);
	const items = await queueStoreOrThrow().listTaskMessages(
		userId,
		c.req.param("taskId"),
	);
	if (!items) {
		throw new AppError("Codex task not found", {
			status: 404,
			code: "codex_task_not_found",
		});
	}
	return c.json(CodexTaskMessageListResponseSchema.parse({ items }));
});

codexRouter.post("/tasks/:taskId/fallback", async (c) => {
	const userId = requireUserId(c);
	const parsed = CodexFallbackDecisionSchema.safeParse(await parseJsonBody(c));
	if (!parsed.success) {
		throw new AppError("Fallback 决策参数不合法", {
			status: 400,
			code: "codex_fallback_decision_invalid",
			details: { issues: parsed.error.issues },
		});
	}
	const task = await queueStoreOrThrow().decideFallback({
		userId,
		taskId: c.req.param("taskId"),
		decision: parsed.data.decision,
		nowIso: new Date().toISOString(),
	});
	if (!task) {
		throw new AppError("Codex task not found", {
			status: 404,
			code: "codex_task_not_found",
		});
	}
	return c.json(task);
});

codexRouter.get("/previews/:previewId", async (c) => {
	const userId = requireUserId(c);
	const previewId = c.req.param("previewId");
	const task = await queueStoreOrThrow().getTaskByPreviewId(userId, previewId);
	if (!task || task.state !== "succeeded" || !task.deliveryEvidence.preview) {
		throw new AppError("可用的 Codex 预览不存在", {
			status: 404,
			code: "codex_preview_not_found",
		});
	}
	const preview = task.deliveryEvidence.preview;
	if (Date.parse(preview.expiresAt) <= Date.now()) {
		throw new AppError("Codex 预览已过期", {
			status: 410,
			code: "codex_preview_expired",
		});
	}
	return c.json(
		CodexPreviewResolutionSchema.parse({
			previewId,
			taskId: task.id,
			url: preview.url,
			expiresAt: preview.expiresAt,
			isolatedOrigin: true,
		}),
	);
});

/**
 * 首次配对还没有 API Key，因此这个单一端点独立于 publicApiRouter 的
 * API Key middleware。高熵配对码仅保留十分钟并在 Redis 中原子单次消费。
 */
codexPairingPublicRouter.post("/exchange", async (c) => {
	const parsed = CodexPairingExchangeRequestSchema.safeParse(
		await parseJsonBody(c as AppContext),
	);
	if (!parsed.success) {
		throw new AppError("Codex pairing exchange 参数不合法", {
			status: 400,
			code: "codex_pairing_exchange_invalid",
			details: { issues: parsed.error.issues },
		});
	}
	const pairing = await pairingStoreOrThrow().consume(
		parsed.data.pairingCode,
	);
	if (!pairing || Date.parse(pairing.expiresAt) <= Date.now()) {
		throw new AppError("Codex pairing code 不存在、已使用或已过期", {
			status: 410,
			code: "codex_pairing_expired",
		});
	}
	const pairedAt = new Date().toISOString();
	const created = await createApiKey(c as AppContext, pairing.userId, {
		label: `Codex Bridge · ${parsed.data.deviceName}`,
		allowedOrigins: ["*"],
		enabled: true,
		scopes: ["public:read", "public:write", "agent:execute"],
		expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
	});
	return c.json(
		CodexPairingExchangeResponseSchema.parse({
			apiKey: created.key,
			pairedAt,
		}),
	);
});

/**
 * 宿主机 Worker 只通过 /public/codex/* 反向长轮询；TapCanvas 服务端不连接
 * 用户 localhost，也不执行 Codex/安装/测试/构建命令。
 */
export function registerPublicCodexWorkerRoutes(
	router: Hono<AppEnv>,
): void {
	router.get("/codex/bridges/self", async (c) => {
		const userId = requireUserId(c);
		const bridgeId = String(c.req.query("bridgeId") || "").trim();
		if (bridgeId.length < 8 || bridgeId.length > 120) {
			throw new AppError("bridgeId 参数不合法", {
				status: 400,
				code: "codex_bridge_id_invalid",
			});
		}
		const bridge = await queueStoreOrThrow().getOnlineBridge(
			userId,
			bridgeId,
		);
		if (!bridge) {
			throw new AppError("Codex Bridge 当前不在线", {
				status: 404,
				code: "codex_bridge_offline",
			});
		}
		const activeTaskId =
			(await queueStoreOrThrow().getBridgeActiveTaskId(
				userId,
				bridgeId,
			)) || null;
		return c.json(
			CodexBridgeSummarySchema.parse({
				...bridge,
				status: "online",
				activeTaskId,
			}),
		);
	});

	router.post("/codex/bridges/heartbeat", async (c) => {
		const userId = requireUserId(c);
		const parsed = CodexBridgeHeartbeatSchema.safeParse(await parseJsonBody(c));
		if (!parsed.success) {
			throw new AppError("Codex Bridge heartbeat 参数不合法", {
				status: 400,
				code: "codex_bridge_heartbeat_invalid",
				details: { issues: parsed.error.issues },
			});
		}
		const bridge = await queueStoreOrThrow().registerBridge(
			userId,
			parsed.data,
			new Date().toISOString(),
		);
		return c.json(bridge);
	});

	router.post("/codex/tasks/claim", async (c) => {
		const userId = requireUserId(c);
		const parsed = CodexTaskClaimRequestSchema.safeParse(
			await parseJsonBody(c),
		);
		if (!parsed.success) {
			throw new AppError("Codex claim 参数不合法", {
				status: 400,
				code: "codex_claim_invalid",
				details: { issues: parsed.error.issues },
			});
		}
		const store = queueStoreOrThrow();
		const bridge = await store.getOnlineBridge(userId, parsed.data.bridgeId);
		if (
			!bridge ||
			bridge.workerInstanceId !== parsed.data.workerInstanceId
		) {
			throw new AppError("Codex Bridge 实例未注册或心跳已失效", {
				status: 409,
				code: "codex_bridge_registration_stale",
			});
		}
		const now = new Date();
		const claimed = await store.claimTask({
			userId,
			bridgeId: parsed.data.bridgeId,
			workerInstanceId: parsed.data.workerInstanceId,
			nowIso: now.toISOString(),
			nowMs: now.getTime(),
		});
		return c.json(
			CodexTaskClaimResponseSchema.parse({
				task: claimed?.task ?? null,
				contextSnapshot: claimed?.contextSnapshot ?? null,
				leaseId: claimed?.leaseId ?? null,
				leaseExpiresAt: claimed?.leaseExpiresAt ?? null,
			}),
		);
	});

	router.get("/codex/tasks/:taskId", async (c) => {
		const userId = requireUserId(c);
		const task = await queueStoreOrThrow().getTask(
			userId,
			c.req.param("taskId"),
		);
		if (!task) {
			throw new AppError("Codex task not found", {
				status: 404,
				code: "codex_task_not_found",
			});
		}
		return c.json(task);
	});

	router.post("/codex/tasks/:taskId/lease", async (c) => {
		const userId = requireUserId(c);
		const parsed = CodexTaskLeaseHeartbeatSchema.safeParse(
			await parseJsonBody(c),
		);
		if (!parsed.success) {
			throw new AppError("Codex lease heartbeat 参数不合法", {
				status: 400,
				code: "codex_lease_heartbeat_invalid",
				details: { issues: parsed.error.issues },
			});
		}
		try {
			await queueStoreOrThrow().heartbeatLease({
				userId,
				taskId: c.req.param("taskId"),
				bridgeId: parsed.data.bridgeId,
				workerInstanceId: parsed.data.workerInstanceId,
				leaseId: parsed.data.leaseId,
				nowIso: new Date().toISOString(),
			});
		} catch (error: unknown) {
			throwLeaseError(error);
		}
		return c.json({ ok: true });
	});

	router.post("/codex/tasks/:taskId/messages/claim", async (c) => {
		const userId = requireUserId(c);
		const parsed = CodexTaskMessageClaimRequestSchema.safeParse(
			await parseJsonBody(c),
		);
		if (!parsed.success) {
			throw new AppError("Codex steering claim 参数不合法", {
				status: 400,
				code: "codex_task_message_claim_invalid",
				details: { issues: parsed.error.issues },
			});
		}
		try {
			const items = await queueStoreOrThrow().claimTaskMessages({
				userId,
				taskId: c.req.param("taskId"),
				...parsed.data,
			});
			return c.json(
				CodexTaskMessageClaimResponseSchema.parse({ items }),
			);
		} catch (error: unknown) {
			throwLeaseError(error);
		}
	});

	router.post("/codex/tasks/:taskId/messages/ack", async (c) => {
		const userId = requireUserId(c);
		const parsed = CodexTaskMessageAckRequestSchema.safeParse(
			await parseJsonBody(c),
		);
		if (!parsed.success) {
			throw new AppError("Codex steering ack 参数不合法", {
				status: 400,
				code: "codex_task_message_ack_invalid",
				details: { issues: parsed.error.issues },
			});
		}
		try {
			const message = await queueStoreOrThrow().acknowledgeTaskMessage({
				userId,
				taskId: c.req.param("taskId"),
				...parsed.data,
				nowIso: new Date().toISOString(),
			});
			if (!message) {
				throw new AppError("Codex steering message not found", {
					status: 404,
					code: "codex_task_message_not_found",
				});
			}
			return c.json(message);
		} catch (error: unknown) {
			if (error instanceof AppError) throw error;
			throwLeaseError(error);
		}
	});

	router.post("/codex/tasks/:taskId/source-upload", async (c) => {
		const userId = requireUserId(c);
		const parsed = CodexSourceUploadRequestSchema.safeParse(
			await parseJsonBody(c),
		);
		if (!parsed.success) {
			throw new AppError("Codex source upload 参数不合法", {
				status: 400,
				code: "codex_source_upload_invalid",
				details: { issues: parsed.error.issues },
			});
		}
		const store = queueStoreOrThrow();
		const taskId = c.req.param("taskId");
		const task = await store.getTask(userId, taskId);
		if (!task || task.bridgeId !== parsed.data.bridgeId) {
			throw new AppError("Codex task not found", {
				status: 404,
				code: "codex_task_not_found",
			});
		}
		if (task.state !== "remote_build_queued") {
			throw new AppError(
				`Codex source upload requires remote_build_queued, got ${task.state}`,
				{
					status: 409,
					code: "codex_source_upload_state_conflict",
				},
			);
		}
		await requireCodexRemoteBuilderReady(c.env);
		try {
			await store.heartbeatLease({
				userId,
				taskId,
				bridgeId: parsed.data.bridgeId,
				workerInstanceId: parsed.data.workerInstanceId,
				leaseId: parsed.data.leaseId,
				nowIso: new Date().toISOString(),
			});
		} catch (error: unknown) {
			if (error instanceof CodexLeaseConflictError) throwLeaseError(error);
			throw new AppError(
				error instanceof Error ? error.message : String(error),
				{
					status: 503,
					code: "codex_remote_builder_unavailable",
				},
			);
		}
		const upload = await createCodexSourceUpload({
			env: c.env,
			userId,
			taskId,
			sourceSha256: parsed.data.sourceSha256,
		});
		return c.json(CodexSourceUploadResponseSchema.parse(upload));
	});

	router.post("/codex/tasks/:taskId/remote-build", async (c) => {
		const userId = requireUserId(c);
		const parsed = CodexRemoteBuildRequestSchema.safeParse(
			await parseJsonBody(c),
		);
		if (!parsed.success) {
			throw new AppError("Codex remote build 参数不合法", {
				status: 400,
				code: "codex_remote_build_invalid",
				details: { issues: parsed.error.issues },
			});
		}
		const store = queueStoreOrThrow();
		const taskId = c.req.param("taskId");
		const task = await store.getTask(userId, taskId);
		if (!task || task.bridgeId !== parsed.data.bridgeId) {
			throw new AppError("Codex task not found", {
				status: 404,
				code: "codex_task_not_found",
			});
		}
		if (task.state !== "remote_build_queued") {
			throw new AppError(
				`Codex remote build requires remote_build_queued, got ${task.state}`,
				{
					status: 409,
					code: "codex_remote_build_state_conflict",
				},
			);
		}
		if (
			task.workspaceConfigFingerprint !==
			parsed.data.spec.configFingerprint
		) {
			throw new AppError(
				"workspace 配置在任务派发后发生变化，请重新派发任务",
				{
					status: 409,
					code: "codex_workspace_config_changed",
				},
			);
		}
		const expectedObjectKey = codexSourceObjectKey({
			userId,
			taskId,
			sourceSha256: parsed.data.sourceSha256,
		});
		if (parsed.data.objectKey !== expectedObjectKey) {
			throw new AppError("Codex source object 不属于当前任务", {
				status: 403,
				code: "codex_source_scope_invalid",
			});
		}
		await requireCodexRemoteBuilderReady(c.env);
		try {
			await store.heartbeatLease({
				userId,
				taskId,
				bridgeId: parsed.data.bridgeId,
				workerInstanceId: parsed.data.workerInstanceId,
				leaseId: parsed.data.leaseId,
				nowIso: new Date().toISOString(),
			});
			await verifyCodexSourceObject({
				env: c.env,
				objectKey: parsed.data.objectKey,
				sourceSha256: parsed.data.sourceSha256,
				archiveBytes: parsed.data.archiveBytes,
			});
		} catch (error: unknown) {
			if (error instanceof CodexLeaseConflictError) throwLeaseError(error);
			throw new AppError(
				error instanceof Error ? error.message : String(error),
				{
					status: 503,
					code: "codex_remote_build_enqueue_failed",
				},
			);
		}
		const queued = await enqueueCodexRemoteBuild({
			env: c.env,
			taskId,
			userId,
			bridgeId: parsed.data.bridgeId,
			workerInstanceId: parsed.data.workerInstanceId,
			leaseId: parsed.data.leaseId,
			sourceSha256: parsed.data.sourceSha256,
			archiveBytes: parsed.data.archiveBytes,
			objectKey: parsed.data.objectKey,
			spec: parsed.data.spec,
		});
		return c.json(
			CodexRemoteBuildResponseSchema.parse({
				buildId: queued.buildId,
				state: "queued",
			}),
			202,
		);
	});

	router.post("/codex/tasks/:taskId/source-discard", async (c) => {
		const userId = requireUserId(c);
		const parsed = CodexSourceDiscardRequestSchema.safeParse(
			await parseJsonBody(c),
		);
		if (!parsed.success) {
			throw new AppError("Codex source discard 参数不合法", {
				status: 400,
				code: "codex_source_discard_invalid",
				details: { issues: parsed.error.issues },
			});
		}
		const taskId = c.req.param("taskId");
		const store = queueStoreOrThrow();
		const task = await store.getTask(userId, taskId);
		if (!task || task.bridgeId !== parsed.data.bridgeId) {
			throw new AppError("Codex task not found", {
				status: 404,
				code: "codex_task_not_found",
			});
		}
		const expectedObjectKey = codexSourceObjectKey({
			userId,
			taskId,
			sourceSha256: parsed.data.sourceSha256,
		});
		if (parsed.data.objectKey !== expectedObjectKey) {
			throw new AppError("Codex source object 不属于当前任务", {
				status: 403,
				code: "codex_source_scope_invalid",
			});
		}
		try {
			await store.heartbeatLease({
				userId,
				taskId,
				bridgeId: parsed.data.bridgeId,
				workerInstanceId: parsed.data.workerInstanceId,
				leaseId: parsed.data.leaseId,
				nowIso: new Date().toISOString(),
			});
			await deleteCodexSourceObject({
				env: c.env,
				objectKey: parsed.data.objectKey,
			});
		} catch (error: unknown) {
			if (error instanceof CodexLeaseConflictError) throwLeaseError(error);
			throw new AppError(
				error instanceof Error ? error.message : String(error),
				{
					status: 503,
					code: "codex_source_discard_failed",
				},
			);
		}
		return c.json({ deleted: true });
	});

	router.post("/codex/tasks/:taskId/events", async (c) => {
		const userId = requireUserId(c);
		const parsed = CodexTaskWorkerUpdateSchema.safeParse(
			await parseJsonBody(c),
		);
		if (!parsed.success) {
			throw new AppError("Codex Worker 状态事件参数不合法", {
				status: 400,
				code: "codex_worker_event_invalid",
				details: { issues: parsed.error.issues },
			});
		}
		let task: CodexTask;
		try {
			task = await queueStoreOrThrow().updateTaskFromWorker({
				userId,
				taskId: c.req.param("taskId"),
				...parsed.data,
				nowIso: new Date().toISOString(),
			});
		} catch (error: unknown) {
			throwLeaseError(error);
		}
		return c.json(task);
	});
}
