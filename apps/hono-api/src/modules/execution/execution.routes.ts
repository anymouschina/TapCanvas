import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { AppContext, AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import { getFlowForOwner } from "../flow/flow.repo";
import {
	getExecutionSnapshotForOwner,
	getExecutionForOwner,
	getWorkflowExecutionMetricsForOwner,
	listExecutionEvents,
	listExecutionHistoryForOwnerFlow,
	listExecutionHistoryPageForOwner,
	listNodeRunHistoryForOwnerFlow,
	listNodeRunsForExecutionOwner,
	mapExecutionEventRow,
	mapExecutionHistoryRow,
	mapExecutionRow,
	mapExecutionSnapshotRow,
	mapNodeRunHistoryRow,
	mapNodeRunRow,
	updateNodeRun,
} from "./execution.repo";
import { RunFlowExecutionRequestSchema, WorkflowExecutionFamilySchema, WorkflowExecutionHistoryPageSchema, WorkflowExecutionResumeRequestSchema, WorkflowHumanApprovalResponseSchema, WorkflowNodeAttemptPageSchema } from "./execution.schemas";
import { getPrismaClient } from "../../platform/node/prisma";
import { parseWorkflowNodeOutputV1 } from "./execution.node-runtime";
import { isAdminRequest } from "../team/team.service";
import { parseWorkflowTriggerSpec } from "@tapcanvas/workflow-kernel-protocol";
import {
	startWorkflowExecution,
	WorkflowStartError,
} from "./execution.start-service";
import { previewWorkflowSchedule } from "./execution.schedule-runtime";
import { createWorkflowNodeJob } from "./execution.node-attempt";
import { cancelWorkflowExecutionForOwner } from "./execution.cancel-service";
import { deliverWorkflowEvent, deliverWorkflowWebhook } from "./execution.trigger-runtime";
import { projectWorkflowGraphForViewer } from "@tapcanvas/workflow-kernel-protocol";
import { prepareWorkflowExecutionSnapshotRerun } from "./execution.snapshot-runtime";
import { buildWorkflowProjectContextForRun } from "./execution.project-context-runtime";
import {
	getWorkflowExecutionFamilyPageForOwner,
	listWorkflowNodeAttemptsPageForExecutionOwner,
} from "./execution.family-store";
import { resumeWorkflowExecution, WorkflowResumeError } from "./execution.resume-service";

export const executionRouter = new Hono<AppEnv>();
export const workflowTriggerRouter = new Hono<AppEnv>();

function readCallerCanvasSnapshot(value: unknown): unknown | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const snapshot = (value as Record<string, unknown>).workflowCallerCanvasSnapshot;
	if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return undefined;
	const record = snapshot as Record<string, unknown>;
	return Array.isArray(record.nodes) && Array.isArray(record.edges) ? snapshot : undefined;
}

function omitCallerCanvasSnapshot(value: unknown): unknown {
	if (!value || typeof value !== "object" || Array.isArray(value)) return value;
	const {
		workflowCallerCanvasSnapshot: _callerCanvasSnapshot,
		...executionSnapshot
	} = value as Record<string, unknown>;
	return executionSnapshot;
}

workflowTriggerRouter.post("/webhooks/:webhookId", async (c) => {
	const webhookId = c.req.param("webhookId").trim();
	const deliveryId = (c.req.header("x-tapcanvas-delivery-id") || "").trim();
	const signature = (c.req.header("x-tapcanvas-signature") || "").trim();
	if (!webhookId || !deliveryId || !signature) {
		return c.json({ error: "Webhook id, delivery id, and signature are required", code: "workflow_webhook_headers_required" }, 400);
	}
	const rawBody = await c.req.text();
	if (new TextEncoder().encode(rawBody).byteLength > 1_000_000) {
		return c.json({ error: "Webhook body exceeds 1 MB", code: "workflow_webhook_body_too_large" }, 413);
	}
	let payload: unknown;
	try {
		payload = JSON.parse(rawBody) as unknown;
	} catch (error: unknown) {
		return c.json({ error: error instanceof Error ? error.message : "Webhook body must be JSON", code: "workflow_webhook_json_invalid" }, 400);
	}
	try {
		const result = await deliverWorkflowWebhook(c.env, { webhookId, deliveryId, signature, rawBody, payload });
		const status = result.failures.length > 0 ? (result.deliveries.length > 0 ? 207 : 500) : 202;
		return c.json({ accepted: result.deliveries.length, failed: result.failures.length, ...result }, status);
	} catch (error: unknown) {
		const code = error instanceof Error ? error.message : "workflow_webhook_failed";
		if (code === "workflow_webhook_not_found") return c.json({ error: "Webhook not found", code }, 404);
		if (code === "workflow_webhook_signature_invalid") return c.json({ error: "Webhook signature is invalid", code }, 401);
		if (code === "workflow_webhook_secret_unavailable") return c.json({ error: "Webhook secret binding is unavailable", code }, 503);
		return c.json({ error: code, code: "workflow_webhook_failed" }, 500);
	}
});

executionRouter.use("*", authMiddleware);

executionRouter.get("/", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const flowId = (c.req.query("flowId") || "").trim();
	if (!flowId) return c.json({ error: "flowId is required" }, 400);
	const limit = Number(c.req.query("limit") || 30) || 30;
	const activeOnly = c.req.query("activeOnly") === "true";
	const rows = await listExecutionHistoryForOwnerFlow(c.env.DB, {
		ownerId: userId,
		flowId,
		limit,
		activeOnly,
	});
	return c.json(rows.map(mapExecutionHistoryRow));
});

executionRouter.get("/metrics", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const flowId = (c.req.query("flowId") || "").trim();
	const limit = Number(c.req.query("limit") || 500) || 500;
	return c.json(await getWorkflowExecutionMetricsForOwner(c.env.DB, {
		ownerId: userId,
		...(flowId ? { flowId } : {}),
		limit,
	}));
});

executionRouter.get("/history", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const flowId = (c.req.query("flowId") || "").trim();
	const cursor = (c.req.query("cursor") || "").trim();
	const requestedLimit = Number(c.req.query("limit") || 40);
	const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(100, Math.floor(requestedLimit))) : 40;
	const page = await listExecutionHistoryPageForOwner(c.env.DB, {
		ownerId: userId,
		limit,
		...(flowId ? { flowId } : {}),
		...(cursor ? { cursor } : {}),
	});
	return c.json(WorkflowExecutionHistoryPageSchema.parse({
		items: page.items.map(mapExecutionHistoryRow),
		nextCursor: page.nextCursor,
	}));
});

executionRouter.post("/schedule/preview", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	if (!isAdminRequest(c)) {
		return c.json({ error: "Administrator workflow access required", code: "admin_required" }, 403);
	}
	const body = (await c.req.json().catch(() => null)) as unknown;
	const parsed = parseWorkflowTriggerSpec(body);
	if (!parsed.success || parsed.data.kind !== "schedule") {
		return c.json({
			error: parsed.success ? "Schedule trigger spec is required" : parsed.error.message,
			code: "schedule_contract_invalid",
		}, 400);
	}
	try {
		return c.json(previewWorkflowSchedule(parsed.data));
	} catch (error: unknown) {
		return c.json({
			error: error instanceof Error ? error.message : "Schedule expression is invalid",
			code: "schedule_expression_invalid",
		}, 400);
	}
});

executionRouter.post("/run", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	if (!isAdminRequest(c)) {
		return c.json({ error: "Administrator workflow access required", code: "admin_required" }, 403);
	}
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = RunFlowExecutionRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json(
			{ error: "Invalid request body", issues: parsed.error.issues },
			400,
		);
	}

	const flowId = parsed.data.flowId;
	const flow = await getFlowForOwner(c.env.DB, flowId, userId);
	if (!flow) return c.json({ error: "Flow not found" }, 404);
	try {
		const runContext = flow.project_id
			? await buildWorkflowProjectContextForRun({
				c: c as unknown as AppContext,
				ownerId: userId,
				projectId: flow.project_id,
				canvasId: flow.id,
			})
			: undefined;
		const result = await startWorkflowExecution(c.env, {
			flow,
			ownerId: userId,
			triggerNodeId: parsed.data.triggerNodeId,
			...(parsed.data.stopAfterNodeId ? { stopAfterNodeId: parsed.data.stopAfterNodeId } : {}),
			...(parsed.data.replayFromExecutionId && parsed.data.startFromNodeId
				? {
					replay: {
						sourceExecutionId: parsed.data.replayFromExecutionId,
						startFromNodeId: parsed.data.startFromNodeId,
					},
				}
				: {}),
			trigger: parsed.data.trigger ?? "manual",
			concurrency: parsed.data.concurrency,
			...(runContext ? {
				projectContext: runContext.projectContext,
				callerCanvasSnapshot: runContext.callerCanvasSnapshot,
			} : {}),
		});
		return c.json(result.execution);
	} catch (error: unknown) {
		if (error instanceof WorkflowStartError) {
			return c.json(
				{
					error: error.message,
					code: error.code,
					...(error.details ? { details: error.details } : {}),
				},
				error.status,
			);
		}
		return c.json(
			{
				error: error instanceof Error ? error.message : "Failed to create workflow execution",
				code: "workflow_start_failed",
			},
			500,
		);
	}
});

executionRouter.post("/events/deliver", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	if (!isAdminRequest(c)) return c.json({ error: "Administrator workflow access required", code: "admin_required" }, 403);
	const body = (await c.req.json().catch(() => null)) as unknown;
	if (!body || typeof body !== "object" || Array.isArray(body)) {
		return c.json({ error: "Event delivery body must be an object", code: "workflow_event_invalid" }, 400);
	}
	const record = body as Record<string, unknown>;
	const topic = typeof record.topic === "string" ? record.topic.trim() : "";
	const eventId = typeof record.eventId === "string" ? record.eventId.trim() : "";
	if (!topic || !eventId || !Object.prototype.hasOwnProperty.call(record, "payload")) {
		return c.json({ error: "topic, eventId, and payload are required", code: "workflow_event_invalid" }, 400);
	}
	try {
		const result = await deliverWorkflowEvent(c.env, { ownerId: userId, topic, eventId, payload: record.payload });
		const status = result.failures.length > 0 ? (result.deliveries.length > 0 ? 207 : 500) : 202;
		return c.json({ accepted: result.deliveries.length, failed: result.failures.length, ...result }, status);
	} catch (error: unknown) {
		return c.json({ error: error instanceof Error ? error.message : "Event delivery failed", code: "workflow_event_failed" }, 500);
	}
});

executionRouter.get("/node-history", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	if (!isAdminRequest(c)) {
		return c.json(
			{
				error: "Administrator workflow access required",
				code: "admin_required",
			},
			403,
		);
	}
	const flowId = (c.req.query("flowId") || "").trim();
	const nodeId = (c.req.query("nodeId") || "").trim();
	if (!flowId) return c.json({ error: "flowId is required" }, 400);
	if (!nodeId) return c.json({ error: "nodeId is required" }, 400);
	const limit = Number(c.req.query("limit") || 20) || 20;
	const rows = await listNodeRunHistoryForOwnerFlow(c.env.DB, {
		ownerId: userId,
		flowId,
		nodeId,
		limit,
	});
	return c.json(rows.map(mapNodeRunHistoryRow));
});

executionRouter.get("/:id/snapshot", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const row = await getExecutionSnapshotForOwner(c.env.DB, {
		ownerId: userId,
		executionId: c.req.param("id"),
	});
	if (!row) return c.json({ error: "Execution not found" }, 404);
	try {
		const snapshot = mapExecutionSnapshotRow(row);
		const canViewAdminWorkflow = isAdminRequest(c);
		const callerCanvasSnapshot = readCallerCanvasSnapshot(snapshot.data);
		return c.json({
			...snapshot,
			data: projectWorkflowGraphForViewer(omitCallerCanvasSnapshot(snapshot.data), canViewAdminWorkflow),
			...(callerCanvasSnapshot
				? { canvasData: projectWorkflowGraphForViewer(callerCanvasSnapshot, canViewAdminWorkflow) }
				: {}),
		});
	} catch (error: unknown) {
		return c.json({
			error: error instanceof Error ? error.message : "Immutable workflow snapshot is invalid",
			code: "workflow_execution_snapshot_invalid",
		}, 500);
	}
});

executionRouter.get("/:id/context", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const row = await getExecutionForOwner(c.env.DB, c.req.param("id"), userId);
	if (!row) return c.json({ error: "Execution not found" }, 404);
	const execution = mapExecutionRow(row);
	return c.json({
		executionId: execution.id,
		projectId: execution.projectId ?? null,
		canvasId: execution.canvasId ?? null,
		projectContext: execution.projectContext ?? null,
		assetSnapshot: execution.assetSnapshot ?? [],
		usesProjectAssets: execution.usesProjectAssets === true,
	});
});

executionRouter.get("/:id/attempts", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const executionId = c.req.param("id").trim();
	const execution = await getExecutionForOwner(c.env.DB, executionId, userId);
	if (!execution) return c.json({ error: "Execution not found" }, 404);
	const cursor = (c.req.query("cursor") || "").trim();
	const requestedLimit = Number(c.req.query("limit") || 50);
	const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(200, Math.floor(requestedLimit))) : 50;
	try {
		const page = await listWorkflowNodeAttemptsPageForExecutionOwner(c.env.DB, {
			ownerId: userId,
			executionId,
			limit,
			...(cursor ? { cursor } : {}),
		});
		return c.json(WorkflowNodeAttemptPageSchema.parse(page));
	} catch (error: unknown) {
		if (error instanceof Error && error.message === "workflow_node_attempt_cursor_invalid") {
			return c.json({ error: "Attempt cursor is invalid for this execution", code: error.message }, 400);
		}
		throw error;
	}
});

executionRouter.get("/:id/family", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const cursor = (c.req.query("cursor") || "").trim();
	const requestedLimit = Number(c.req.query("limit") || 50);
	const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(200, Math.floor(requestedLimit))) : 50;
	try {
		const family = await getWorkflowExecutionFamilyPageForOwner(c.env.DB, {
			ownerId: userId,
			executionId: c.req.param("id").trim(),
			limit,
			...(cursor ? { cursor } : {}),
		});
		if (!family) return c.json({ error: "Execution not found" }, 404);
		return c.json(WorkflowExecutionFamilySchema.parse(family));
	} catch (error: unknown) {
		if (error instanceof Error && error.message === "workflow_execution_family_cursor_invalid") {
			return c.json({ error: "Family cursor is invalid for this execution family", code: error.message }, 400);
		}
		throw error;
	}
});

executionRouter.post("/:id/resume", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const parsed = WorkflowExecutionResumeRequestSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json({
			error: "Workflow resume requires an explicit JSON contract",
			code: "workflow_resume_request_invalid",
			details: parsed.error.flatten(),
		}, 400);
	}
	if (!isAdminRequest(c)
		&& parsed.data.providerBalanceRestored !== true
		&& parsed.data.cancellationRevoked !== true) {
		return c.json({ error: "Administrator workflow access required", code: "admin_required" }, 403);
	}
	try {
		return c.json(await resumeWorkflowExecution({
			context: c as unknown as AppContext,
			env: c.env,
			ownerId: userId,
			sourceExecutionId: c.req.param("id").trim(),
			trigger: "manual",
			...(parsed.data.providerBalanceRestored ? { providerBalanceRestored: true as const } : {}),
			...(parsed.data.cancellationRevoked ? { cancellationRevoked: true as const } : {}),
			...(parsed.data.agentModelCutover ? {
				agentModelCutover: {
					...parsed.data.agentModelCutover,
					authorizationSource: "admin" as const,
				},
			} : {}),
			...(parsed.data.definitionCutover ? { definitionCutover: parsed.data.definitionCutover } : {}),
		}));
	} catch (error: unknown) {
		if (error instanceof WorkflowResumeError) {
			return c.json({
				error: error.message,
				code: error.code,
				...(error.details ? { details: error.details } : {}),
			}, error.status);
		}
		return c.json({
			error: error instanceof Error ? error.message : "Failed to resume workflow",
			code: "workflow_resume_failed",
		}, 500);
	}
});

executionRouter.post("/:id/rerun", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	if (!isAdminRequest(c)) {
		return c.json({ error: "Administrator workflow access required", code: "admin_required" }, 403);
	}
	const source = await getExecutionSnapshotForOwner(c.env.DB, {
		ownerId: userId,
		executionId: c.req.param("id"),
	});
	if (!source) return c.json({ error: "Execution not found" }, 404);
	try {
		const frozen = mapExecutionSnapshotRow(source);
		const rerun = prepareWorkflowExecutionSnapshotRerun(frozen.data);
		const result = await startWorkflowExecution(c.env, {
			flow: {
				id: frozen.flowId,
				name: frozen.name,
				data: JSON.stringify(rerun.data),
				owner_id: userId,
				project_id: null,
				created_at: frozen.createdAt,
				updated_at: frozen.createdAt,
			},
			ownerId: userId,
			triggerNodeId: rerun.triggerNodeId,
			...(rerun.stopAfterNodeId ? { stopAfterNodeId: rerun.stopAfterNodeId } : {}),
			trigger: "manual",
		});
		return c.json(result.execution);
	} catch (error: unknown) {
		if (error instanceof WorkflowStartError) {
			return c.json({
				error: error.message,
				code: error.code,
				...(error.details ? { details: error.details } : {}),
			}, error.status);
		}
		return c.json({
			error: error instanceof Error ? error.message : "Failed to rerun immutable workflow snapshot",
			code: "workflow_snapshot_rerun_failed",
		}, 500);
	}
});

executionRouter.get("/:id", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const row = await getExecutionForOwner(c.env.DB, id, userId);
	if (!row) return c.json({ error: "Execution not found" }, 404);
	return c.json(mapExecutionRow(row));
});

executionRouter.post("/:id/cancel", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	if (!isAdminRequest(c)) {
		return c.json({ error: "Administrator workflow access required", code: "admin_required" }, 403);
	}
	const executionId = c.req.param("id").trim();
	try {
		const result = await cancelWorkflowExecutionForOwner({
			context: c,
			userId,
			executionId,
			actor: { reasonCode: "user_requested", actorType: "owner_admin", actorId: userId },
		});
		return result
			? c.json(result)
			: c.json({ error: "Execution not found" }, 404);
	} catch (error: unknown) {
		return c.json({
			error: error instanceof Error ? error.message : "Workflow cancellation failed",
			code: "workflow_cancel_failed",
		}, 500);
	}
});

executionRouter.post("/:id/human-response", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	if (!isAdminRequest(c)) return c.json({ error: "Administrator workflow access required", code: "admin_required" }, 403);
	const executionId = c.req.param("id").trim();
	const execution = await getExecutionForOwner(c.env.DB, executionId, userId);
	if (!execution) return c.json({ error: "Execution not found" }, 404);
	const parsed = WorkflowHumanApprovalResponseSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) return c.json({ error: "Invalid human response", issues: parsed.error.issues }, 400);
	const nodeRun = await getPrismaClient().workflow_node_runs.findUnique({
		where: { execution_id_node_id: { execution_id: executionId, node_id: parsed.data.nodeId } },
		select: { status: true, output_refs: true },
	});
	if (!nodeRun) return c.json({ error: "Workflow node run not found" }, 404);
	if (nodeRun.status !== "waiting_external") {
		return c.json({ error: `Workflow node is ${nodeRun.status}, not waiting for human input`, code: "workflow_human_response_not_waiting" }, 409);
	}
	let outputRefs;
	try {
		outputRefs = parseWorkflowNodeOutputV1(nodeRun.output_refs);
	} catch (error: unknown) {
		return c.json({ error: error instanceof Error ? error.message : String(error), code: "workflow_human_response_receipt_invalid" }, 409);
	}
	if (!outputRefs || outputRefs.executorRef !== "workflow.human.approval/v1") {
		return c.json({ error: "Workflow node is not a Human Approval node", code: "workflow_human_response_node_mismatch" }, 409);
	}
	const respondedAt = new Date().toISOString();
	const nextOutputRefs = {
		...outputRefs,
		evidence: {
			...outputRefs.evidence,
			humanResponse: parsed.data.response,
			humanRespondedAt: respondedAt,
			humanRespondedBy: userId,
		},
	};
	await updateNodeRun(c.env.DB, {
		executionId,
		nodeId: parsed.data.nodeId,
		status: "waiting_external",
		outputRefs: nextOutputRefs,
	});
	if (!c.env.WORKFLOW_NODE_QUEUE) return c.json({ error: "Workflow queue unavailable", code: "workflow_runtime_unavailable" }, 503);
	await c.env.WORKFLOW_NODE_QUEUE.send(await createWorkflowNodeJob(c.env.DB, {
		executionId,
		nodeId: parsed.data.nodeId,
		phase: "await_external",
	}));
	return c.json({ accepted: true, executionId, nodeId: parsed.data.nodeId, response: parsed.data.response, respondedAt });
});

executionRouter.get("/:id/node-runs", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const id = c.req.param("id");
	const rows = await listNodeRunsForExecutionOwner(c.env.DB, {
		ownerId: userId,
		executionId: id,
	});
	return c.json(rows.map(mapNodeRunRow));
});

// SSE stream for execution logs (DB-backed; resumable via `?after=<seq>`)
executionRouter.get("/:id/events", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const executionId = c.req.param("id");
	const row = await getExecutionForOwner(c.env.DB, executionId, userId);
	if (!row) return c.json({ error: "Execution not found" }, 404);

	const after = Number(c.req.query("after") || 0) || 0;
	let cursor = Math.max(0, Math.floor(after));

	return streamSSE(c, async (stream) => {
		const HEARTBEAT_MS = 15_000;
		let closed = false;
		const abortSignal = c.req.raw.signal as AbortSignal;
		abortSignal.addEventListener("abort", () => {
			closed = true;
		});

		const sleep = (ms: number) =>
			new Promise<void>((resolve) => setTimeout(resolve, ms));

		try {
			await stream.writeSSE({
				event: "init",
				data: JSON.stringify({
					executionId,
					after: cursor,
					status: row.status,
				}),
			});

			let lastPingAt = Date.now();
			while (!closed) {
				const rows = await listExecutionEvents(c.env.DB, {
					executionId,
					afterSeq: cursor,
					limit: 50,
				});
				if (rows.length) {
					for (const r of rows) {
						const dto = mapExecutionEventRow(r);
						cursor = Math.max(cursor, dto.seq);
						await stream.writeSSE({
							event: dto.eventType,
							data: JSON.stringify(dto),
						});
					}
					lastPingAt = Date.now();
					continue;
				}
				if (Date.now() - lastPingAt > HEARTBEAT_MS) {
					await stream.writeSSE({
						event: "ping",
						data: JSON.stringify({ type: "ping", t: Date.now() }),
					});
					lastPingAt = Date.now();
				}
				await sleep(800);
			}
		} finally {
			closed = true;
		}
	});
});
