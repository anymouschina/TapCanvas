import type { DurableObjectState } from "@cloudflare/workers-types";
import type { PrismaClient, WorkerEnv } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { stripWorkflowFanoutNodes } from "./execution.flow-cleanup";
import {
	claimQueuedExecutionStart,
	ensureNodeRuns,
	incrementNodeRunAttempt,
	insertExecutionEvent,
	updateExecutionStatus,
	updateNodeRun,
	updateNodeRuns,
} from "./execution.repo";
import {
	compileWorkflowGraph,
	rebuildWorkflowExecutionGraph,
	resolveWorkflowGraphNode,
	resolveWorkflowNodeRestartPolicy,
	resolveWorkflowNodeRetryPolicy,
	workflowGraphHasCycle,
	type ReactFlowLike,
	type WorkflowExecutionGraphState as GraphState,
} from "./execution.recovery";
import { parseWorkflowNodeOutputV1 } from "./execution.node-runtime";
import {
	readResolvedWorkflowOutputReuses,
	readResolvedWorkflowReplayCheckpoints,
} from "./execution.output-reuse";
import {
	createWorkflowNodeJob,
	parseWorkflowNodeAttemptIdentity,
	workflowNodeAttemptMatches,
	type WorkflowNodeAttemptIdentity,
} from "./execution.node-attempt";
import { readWorkflowDurableRetryDirective } from "./execution.durable-retry";
import { readDatabaseWithTransientRetry } from "../../platform/node/database-read-retry";

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseStoredJson(value: unknown): unknown {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return undefined;
	}
}

function parseNodeIdList(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
	const nodeIds = value.map((nodeId, index) => {
		if (typeof nodeId !== "string" || !nodeId.trim()) {
			throw new Error(`${field}[${index}] must be a non-empty string`);
		}
		return nodeId.trim();
	});
	if (new Set(nodeIds).size !== nodeIds.length) {
		throw new Error(`${field} must not contain duplicate node ids`);
	}
	return nodeIds;
}

type WorkflowExecutionCancellationReason =
	| "user_requested"
	| "provider_balance_recovery"
	| "agent_model_cutover"
	| "video_production_start_deadline_exceeded";

type WorkflowExecutionCancellationRequest = Readonly<{
	reasonCode: WorkflowExecutionCancellationReason;
	actorType: "owner_admin" | "owner_eval" | "owning_chat_turn" | "workflow_recovery" | "deadline_enforcer";
	actorId: string;
}>;

function parseWorkflowExecutionCancellationRequest(
	body: Record<string, unknown>,
): WorkflowExecutionCancellationRequest {
	const reasonCode = body.reasonCode;
	if (reasonCode !== "user_requested"
		&& reasonCode !== "provider_balance_recovery"
		&& reasonCode !== "agent_model_cutover"
		&& reasonCode !== "video_production_start_deadline_exceeded") {
		throw new Error("reasonCode must be user_requested, provider_balance_recovery, agent_model_cutover, or video_production_start_deadline_exceeded");
	}
	const actorType = body.actorType;
	if (actorType !== "owner_admin" && actorType !== "owner_eval" && actorType !== "owning_chat_turn" && actorType !== "workflow_recovery" && actorType !== "deadline_enforcer") {
		throw new Error("actorType must be owner_admin, owner_eval, owning_chat_turn, workflow_recovery, or deadline_enforcer");
	}
	const isUserActor = actorType === "owner_admin" || actorType === "owner_eval" || actorType === "owning_chat_turn";
	const isRecoveryReason = reasonCode === "provider_balance_recovery" || reasonCode === "agent_model_cutover";
	const isDeadlineReason = reasonCode === "video_production_start_deadline_exceeded";
	if ((reasonCode === "user_requested" && !isUserActor)
		|| (reasonCode !== "user_requested" && isUserActor)
		|| (isRecoveryReason && actorType !== "workflow_recovery")
		|| (isDeadlineReason && actorType !== "deadline_enforcer")) {
		throw new Error("cancellation reason and actor type do not match");
	}
	const actorId = typeof body.actorId === "string" ? body.actorId.trim() : "";
	if (!actorId) throw new Error("actorId must be a non-empty string");
	return { reasonCode, actorType, actorId };
}

function workflowCancellationCopy(reasonCode: WorkflowExecutionCancellationReason): Readonly<{
	nodeErrorMessage: string;
	eventMessage: string;
}> {
	if (reasonCode === "provider_balance_recovery") {
		return {
			nodeErrorMessage: "Canceled for provider-balance recovery",
			eventMessage: "Workflow execution fenced for provider-balance recovery",
		};
	}
	if (reasonCode === "agent_model_cutover") {
		return {
			nodeErrorMessage: "Canceled for Agent model cutover",
			eventMessage: "Workflow execution fenced for Agent model cutover",
		};
	}
	if (reasonCode === "video_production_start_deadline_exceeded") {
		return {
			nodeErrorMessage: "Canceled because video production did not start before the deadline",
			eventMessage: "Workflow execution canceled by video production start deadline",
		};
	}
	return {
		nodeErrorMessage: "Canceled by user",
		eventMessage: "Workflow execution canceled by user",
	};
}

async function parseRequestBody(request: Request): Promise<Record<string, unknown>> {
	const body = await request.json().catch(() => null);
	if (!isRecord(body)) {
		throw new Error("Request body must be a JSON object");
	}
	return body;
}

async function loadFlowVersionData(db: PrismaClient, flowVersionId: string): Promise<ReactFlowLike | null> {
	void db;
	const row = await readDatabaseWithTransientRetry(
		() => getPrismaClient().flow_versions.findUnique({
			where: { id: flowVersionId },
			select: { data: true },
		}),
		{
			operation: "workflow_flow_version_snapshot",
			onRetry: (diagnostic) => console.warn(JSON.stringify({
				message: "workflow_database_read_transient_retry",
				flowVersionId,
				...diagnostic,
			})),
		},
	);
	if (!row?.data) return null;
	try {
		return JSON.parse(row.data) as ReactFlowLike;
	} catch {
		return null;
	}
}

function internalBaseUrl(env: WorkerEnv): string {
	const value = String(env.TAPCANVAS_API_INTERNAL_BASE ?? env.TAPCANVAS_API_BASE_URL ?? "").trim().replace(/\/+$/u, "");
	if (!value) throw new Error("Workflow Execution Event Broadcast requires TAPCANVAS_API_INTERNAL_BASE");
	return value;
}

export class ExecutionDO {
	private state: DurableObjectState;
	private env: WorkerEnv;
	private eventAppendTail: Promise<void> = Promise.resolve();
	private scheduleTail: Promise<void> = Promise.resolve();
	private lifecycleTail: Promise<void> = Promise.resolve();

	constructor(state: DurableObjectState, env: WorkerEnv) {
		this.state = state;
		this.env = env;
	}

	private get executionId() {
		return this.state.id.toString();
	}

	private async stripFanoutNodesAfterTerminal(nowIso: string): Promise<void> {
		try {
			const execution = await getPrismaClient().workflow_executions.findUnique({
				where: { id: this.executionId },
				select: { flow_id: true, owner_id: true },
			});
			if (!execution) return;
			const result = await stripWorkflowFanoutNodes({
				executionId: this.executionId,
				flowId: execution.flow_id,
				ownerId: execution.owner_id,
				nowIso,
			});
			if (result.strippedNodes > 0) {
				await this.appendEvent({
					eventType: "execution_fanout_nodes_stripped",
					level: "info",
					message: `stripped ${result.strippedNodes} fanout nodes, ${result.strippedEdges} edges`,
				});
			}
		} catch {
			// 清理失败不阻塞执行终态；污染由幂等重试或人工回滚兜底。
		}
	}

	private async loadGraphState(): Promise<GraphState | null> {
		const stored = await this.state.storage.get<GraphState>("graph");
		return stored || null;
	}

	private async saveGraphState(next: GraphState): Promise<void> {
		await this.state.storage.put("graph", next);
	}

	/**
	 * Durable Object requests can interleave whenever a handler awaits an external
	 * database call.  Every node transition therefore shares one execution-local
	 * lifecycle lane.  Without this lane, two deliveries of the same queue job can
	 * both observe `running`, both publish `node_succeeded`, and resolve the same DAG
	 * edge twice.  The database attempt fence still rejects obsolete attempts; this
	 * lane makes transitions for the current attempt linearizable as well.
	 */
	private runLifecycleTransition<T>(transition: () => Promise<T>): Promise<T> {
		const current = this.lifecycleTail.then(transition);
		this.lifecycleTail = current.then(() => undefined, () => undefined);
		return current;
	}

	/**
	 * Restart recovery may race a still-draining process on the same PostgreSQL
	 * rows. Retry only the exact side-effect-free read that lost the database
	 * deadlock/serialization arbitration; workflow mutations and media calls are
	 * deliberately outside this boundary and are never replayed by it.
	 */
	private readRecoveryDatabase<T>(operation: string, read: () => Promise<T>): Promise<T> {
		return readDatabaseWithTransientRetry(read, {
			operation,
			onRetry: (diagnostic) => console.warn(JSON.stringify({
				message: "workflow_recovery_database_read_transient_retry",
				executionId: this.executionId,
				...diagnostic,
			})),
		});
	}

	/**
	 * Node's Durable Object adapter keeps graph state in process memory. Startup
	 * recovery normally rehydrates it before waiting jobs are dispatched, but an
	 * already-enqueued external-check delivery can race that hydration. Rebuild
	 * only the deterministic scheduler projection from immutable flow + persisted
	 * node facts; do not change attempts or execute a node here.
	 */
	private async loadOrRehydrateGraphState(nodeId: string): Promise<GraphState | Response> {
		const current = await this.loadGraphState();
		if (current && nodeId in current.indeg) return current;
		const prisma = getPrismaClient();
		const execution = await this.readRecoveryDatabase(
			"workflow_graph_rehydration_execution_snapshot",
			() => prisma.workflow_executions.findUnique({
				where: { id: this.executionId },
				select: { flow_version_id: true, status: true, concurrency: true },
			}),
		);
		if (!execution) return new Response("Execution not found", { status: 404 });
		if (execution.status !== "running" && execution.status !== "failed") {
			return new Response(`already ${execution.status}`, { status: 208 });
		}
		const flowData = await loadFlowVersionData(this.env.DB, execution.flow_version_id);
		if (!flowData) return new Response("Invalid flow version data", { status: 409 });
		let compiledNodeIds: readonly string[];
		try {
			const compiled = compileWorkflowGraph(flowData);
			if (workflowGraphHasCycle(compiled)) return new Response("Cycle detected in workflow graph", { status: 409 });
			compiledNodeIds = compiled.nodeIds;
		} catch (error: unknown) {
			return new Response(error instanceof Error ? error.message : "Invalid workflow graph", { status: 409 });
		}
		if (!compiledNodeIds.includes(nodeId)) {
			return new Response("Node is outside the immutable execution graph", { status: 409 });
		}
		const [nodeRuns, latestEvent] = await Promise.all([
			this.readRecoveryDatabase(
				"workflow_graph_rehydration_node_runs_snapshot",
				() => prisma.workflow_node_runs.findMany({
					where: { execution_id: this.executionId },
					select: { node_id: true, status: true, output_refs: true },
				}),
			),
			this.readRecoveryDatabase(
				"workflow_graph_rehydration_latest_event_snapshot",
				() => prisma.workflow_execution_events.findFirst({
					where: { execution_id: this.executionId },
					orderBy: { seq: "desc" },
					select: { seq: true },
				}),
			),
		]);
		let rehydrated: GraphState;
		try {
			rehydrated = rebuildWorkflowExecutionGraph({
				flowData,
				executionStatus: execution.status,
				concurrency: execution.concurrency,
				latestEventSeq: latestEvent?.seq ?? 0,
				nodeRuns: nodeRuns.map((run) => ({
					nodeId: run.node_id,
					status: run.status,
					...(run.output_refs != null ? { outputRefs: parseStoredJson(run.output_refs) } : {}),
				})),
			});
		} catch (error: unknown) {
			return new Response(error instanceof Error ? error.message : "Workflow graph rehydration failed", { status: 409 });
		}
		await this.saveGraphState(rehydrated);
		console.info(JSON.stringify({
			message: "workflow_graph_state_rehydrated_for_external_check",
			executionId: this.executionId,
			nodeId,
			executionStatus: execution.status,
		}));
		return rehydrated;
	}

	private appendEvent(params: {
		eventType: string;
		level?: string;
		nodeId?: string | null;
		message?: string | null;
		data?: unknown;
	}): Promise<void> {
		const append = this.eventAppendTail.then(async () => {
			const nowIso = new Date().toISOString();
			const inserted = await insertExecutionEvent(this.env.DB, {
				id: crypto.randomUUID(),
				executionId: this.executionId,
				eventType: params.eventType,
				level: params.level,
				nodeId: params.nodeId ?? null,
				message: params.message ?? null,
				data: params.data,
				nowIso,
			});
			// 事件驱动投影（对齐 DeepSeek Harness）：每次 committed 执行事件实时推给
			// 项目画布 SSE 订阅者，前端按 seq 增量折叠节点状态与资产回填。小T 触发的
			// 执行（equipped_workflow_run）不经前端手动运行路径，全靠本推送回显。
			if (params.eventType !== "node_heartbeat") {
				void this.broadcastExecutionEvent(params.eventType, inserted).catch(() => undefined);
			}
		});
		this.eventAppendTail = append.catch(() => undefined);
		return append;
	}

	/** 查询执行归属 projectId（缓存到 graph 态）并经内部端点广播执行事件。 */
	private async broadcastExecutionEvent(eventType: string, seqValue: number): Promise<void> {
		const env = this.env;
		const internalWorkerToken = String(env.INTERNAL_WORKER_TOKEN ?? "").trim();
		if (!internalWorkerToken) return;
		const seq = Number.isInteger(seqValue) ? seqValue : 0;
		if (!eventType) return;
		const execution = await getPrismaClient().workflow_executions.findUnique({
			where: { id: this.executionId },
			select: { project_id: true },
		});
		if (!execution) return;
		const projectId = String(execution.project_id ?? "").trim();
		if (!projectId) return;
		await fetch(`${internalBaseUrl(env)}/internal/workflow-execution-event/broadcast`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				// 内部路由同时接受 X-Internal-Token（原始 worker token）或 Bearer；
				// 用 X-Internal-Token 直连避免 API-key 派生差异。
				"X-Internal-Token": internalWorkerToken,
			},
			body: JSON.stringify({
				projectId,
				executionId: this.executionId,
				seq,
				eventType,
			}),
		});
	}

	private async requireCurrentNodeAttempt(
		body: Readonly<Record<string, unknown>>,
		nodeId: string,
	): Promise<Readonly<{ id: string; attempt: number; status: string }> | Response> {
		let expected: WorkflowNodeAttemptIdentity;
		try {
			expected = parseWorkflowNodeAttemptIdentity(body);
		} catch (error: unknown) {
			return new Response(error instanceof Error ? error.message : "Invalid node attempt identity", { status: 400 });
		}
		const nodeRun = await this.env.DB.workflow_node_runs.findUnique({
			where: {
				execution_id_node_id: {
					execution_id: this.executionId,
					node_id: nodeId,
				},
			},
			select: { id: true, attempt: true, status: true },
		});
		if (!nodeRun) return new Response("Node run not found", { status: 404 });
		if (workflowNodeAttemptMatches(
			{ nodeRunId: nodeRun.id, attempt: nodeRun.attempt },
			expected,
		)) {
			return nodeRun;
		}
		await this.appendEvent({
			eventType: "node_stale_attempt_ignored",
			level: "warn",
			nodeId,
			message: "A stale workflow node attempt was ignored without changing the current run",
			data: {
				reportedNodeRunId: expected.nodeRunId,
				reportedAttempt: expected.attempt,
				currentNodeRunId: nodeRun.id,
				currentAttempt: nodeRun.attempt,
				...(body.outputRefs !== undefined ? { lateOutputRefs: body.outputRefs } : {}),
			},
		});
		return new Response("stale node attempt ignored", { status: 208 });
	}

	private async persistNotSelectedNodeRuns(nodeIds: readonly string[], nowIso: string): Promise<void> {
		for (const nodeId of [...new Set(nodeIds)]) {
			await updateNodeRun(this.env.DB, {
				executionId: this.executionId,
				nodeId,
				status: "not_selected",
				finishedAt: nowIso,
			});
			await this.appendEvent({
				eventType: "node_not_selected",
				level: "info",
				nodeId,
				message: "No active incoming workflow branch selected this node",
			});
		}
	}

	private async schedule(
		recoveringNodeIds: ReadonlySet<string> = new Set<string>(),
	): Promise<void> {
		const scheduled = this.scheduleTail.then(() => this.scheduleReleased(recoveringNodeIds));
		this.scheduleTail = scheduled.catch(() => undefined);
		return scheduled;
	}

	private async scheduleReleased(
		recoveringNodeIds: ReadonlySet<string>,
	): Promise<void> {
		const graph = await this.loadGraphState();
		if (!graph) return;
		if (graph.status !== "running") return;

		while (graph.running < graph.concurrency && graph.ready.length) {
			const nodeId = graph.ready[0]!;
			// Persist the exact dispatch intent first. If the process stops before the
			// graph reservation is stored, the reconciler can redeliver this attempt and
			// handleNodeStarted will finish the reservation idempotently.
			await updateNodeRun(this.env.DB, {
				executionId: this.executionId,
				nodeId,
				status: "queued",
			});
			const job = await createWorkflowNodeJob(this.env.DB, {
				executionId: this.executionId,
				nodeId,
				...(recoveringNodeIds.has(nodeId) ? { phase: "recover" as const } : {}),
			});
			graph.ready.shift();
			graph.running += 1;
			await this.saveGraphState(graph);
			await this.appendEvent({
				eventType: "node_queued",
				nodeId,
				data: { nodeRunId: job.nodeRunId, attempt: job.attempt, phase: job.phase ?? "execute" },
			});
			const workflowNodeQueue = this.env.WORKFLOW_NODE_QUEUE;
			if (!workflowNodeQueue) {
				throw new Error("WORKFLOW_NODE_QUEUE binding missing");
			}
			await workflowNodeQueue.send(job);
		}
		await this.saveGraphState(graph);
	}

	private async redispatchPersistedQueuedNodes(
		recoveringNodeIds: ReadonlySet<string> = new Set<string>(),
	): Promise<number> {
		const queue = this.env.WORKFLOW_NODE_QUEUE;
		if (!queue) throw new Error("WORKFLOW_NODE_QUEUE binding missing");
		const queuedRuns = await this.env.DB.workflow_node_runs.findMany({
			where: { execution_id: this.executionId, status: "queued" },
			select: { id: true, node_id: true, attempt: true },
		});
		for (const run of queuedRuns) {
			await queue.send({
				executionId: this.executionId,
				nodeId: run.node_id,
				nodeRunId: run.id,
				attempt: run.attempt,
				...((recoveringNodeIds.has(run.node_id) || run.attempt > 1)
					? { phase: "recover" as const }
					: {}),
			});
		}
		return queuedRuns.length;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		if (request.method === "POST" && path === "/start") {
			return this.runLifecycleTransition(() => this.handleStart());
		}
		if (request.method === "POST" && path === "/recoverAfterRestart") {
			return this.runLifecycleTransition(() => this.handleRecoverAfterRestart(request));
		}
		if (request.method === "POST" && path === "/nodeStarted") {
			return this.runLifecycleTransition(() => this.handleNodeStarted(request));
		}
		if (request.method === "POST" && path === "/nodeHeartbeat") {
			return this.runLifecycleTransition(() => this.handleNodeHeartbeat(request));
		}
		if (request.method === "POST" && path === "/nodeRecoveryStarted") {
			return this.runLifecycleTransition(() => this.handleNodeRecoveryStarted(request));
		}
		if (request.method === "POST" && path === "/nodeExternalCheckStarted") {
			return this.runLifecycleTransition(() => this.handleNodeExternalCheckStarted(request));
		}
		if (request.method === "POST" && path === "/nodeWaiting") {
			return this.runLifecycleTransition(() => this.handleNodeWaiting(request));
		}
		if (request.method === "POST" && path === "/nodeProgress") {
			return this.runLifecycleTransition(() => this.handleNodeProgress(request));
		}
		if (request.method === "POST" && path === "/nodeComplete") {
			return this.runLifecycleTransition(() => this.handleNodeComplete(request));
		}
		if (request.method === "POST" && path === "/cancel") {
			return this.runLifecycleTransition(() => this.handleCancel(request));
		}
		return new Response("Not found", { status: 404 });
	}

	private async handleCancel(request: Request): Promise<Response> {
		const cancellation = parseWorkflowExecutionCancellationRequest(await parseRequestBody(request));
		const copy = workflowCancellationCopy(cancellation.reasonCode);
		const prisma = getPrismaClient();
		const execution = await prisma.workflow_executions.findUnique({
			where: { id: this.executionId },
			select: { status: true },
		});
		if (!execution) return new Response("Execution not found", { status: 404 });
		if (execution.status === "success" || execution.status === "failed" || execution.status === "canceled") {
			return Response.json({ canceled: false, status: execution.status, activeNodeIds: [] });
		}

		const activeRuns = await prisma.workflow_node_runs.findMany({
			where: {
				execution_id: this.executionId,
				status: { in: ["pending", "queued", "running", "waiting_external"] },
			},
			select: { node_id: true },
		});
		const activeNodeIds = activeRuns.map((run) => run.node_id);
		const nowIso = new Date().toISOString();
		const graph = await this.loadGraphState();
		if (graph) {
			graph.status = "canceled";
			graph.running = 0;
			graph.ready = [];
			await this.saveGraphState(graph);
		}
		await updateNodeRuns(this.env.DB, {
			executionId: this.executionId,
			nodeIds: activeNodeIds,
			update: { status: "canceled", errorMessage: copy.nodeErrorMessage, finishedAt: nowIso },
		});
		await updateExecutionStatus(this.env.DB, {
			executionId: this.executionId,
			status: "canceled",
			finishedAt: nowIso,
		});
		await this.appendEvent({
			eventType: "execution_canceled",
			level: "warn",
			message: copy.eventMessage,
			data: { activeNodeIds, ...cancellation },
		});
		return Response.json({ canceled: true, status: "canceled", activeNodeIds });
	}

	private async handleRecoverAfterRestart(request: Request): Promise<Response> {
		let body: Record<string, unknown>;
		let recoverableNodeIds: string[];
		let unsafeNodeIds: string[];
		let recoveryReason: "process_startup" | "local_abandonment";
		let ownershipStaleBefore: string | null;
		try {
			body = await parseRequestBody(request);
			recoverableNodeIds = parseNodeIdList(body.recoverableNodeIds, "recoverableNodeIds");
			unsafeNodeIds = parseNodeIdList(body.unsafeNodeIds, "unsafeNodeIds");
			if (body.recoveryReason !== "process_startup" && body.recoveryReason !== "local_abandonment") {
				throw new Error("recoveryReason must be process_startup or local_abandonment");
			}
			recoveryReason = body.recoveryReason;
			ownershipStaleBefore = recoveryReason === "local_abandonment"
				? (typeof body.ownershipStaleBefore === "string" ? body.ownershipStaleBefore.trim() : "")
				: null;
			if (recoveryReason === "local_abandonment") {
				const cutoffMs = Date.parse(ownershipStaleBefore ?? "");
				if (!ownershipStaleBefore || !Number.isFinite(cutoffMs)) {
					throw new Error("local_abandonment requires a valid ownershipStaleBefore timestamp");
				}
			}
		} catch (error: unknown) {
			return new Response(error instanceof Error ? error.message : "Invalid recovery request", { status: 400 });
		}
		const overlap = recoverableNodeIds.find((nodeId) => unsafeNodeIds.includes(nodeId));
		if (overlap) return new Response(`Recovery node ${overlap} has conflicting policies`, { status: 400 });

		const prisma = getPrismaClient();
		const execution = await this.readRecoveryDatabase(
			"workflow_execution_snapshot",
			() => prisma.workflow_executions.findUnique({
				where: { id: this.executionId },
				select: { flow_version_id: true, status: true, concurrency: true },
			}),
		);
		if (!execution) return new Response("Execution not found", { status: 404 });
		if (execution.status !== "running" && execution.status !== "failed") {
			return new Response(`Execution is ${execution.status}`, { status: 409 });
		}
		const flowData = await loadFlowVersionData(this.env.DB, execution.flow_version_id);
		if (!flowData) return new Response("Invalid flow version data", { status: 400 });
		let compiledNodeIds: readonly string[];
		try {
			const compiled = compileWorkflowGraph(flowData);
			if (workflowGraphHasCycle(compiled)) return new Response("Cycle detected in workflow graph", { status: 400 });
			compiledNodeIds = compiled.nodeIds;
		} catch (error: unknown) {
			return new Response(error instanceof Error ? error.message : "Invalid workflow graph", { status: 400 });
		}
		const nowIso = new Date().toISOString();
		await ensureNodeRuns(this.env.DB, {
			executionId: this.executionId,
			nodeIds: [...compiledNodeIds],
			nowIso,
		});
		const nodeRuns = await this.readRecoveryDatabase(
			"workflow_node_runs_snapshot",
			() => prisma.workflow_node_runs.findMany({
				where: { execution_id: this.executionId },
				select: { node_id: true, status: true, output_refs: true },
			}),
		);
		let runningNodeIds = nodeRuns.filter((run) => run.status === "running").map((run) => run.node_id);
		if (recoveryReason === "local_abandonment") {
			const cutoffMs = Date.parse(ownershipStaleBefore ?? "");
			const abandonedNodeIds: string[] = [];
			for (const nodeId of runningNodeIds) {
				const latestOwnershipEvent = await this.readRecoveryDatabase(
					"workflow_node_ownership_snapshot",
					() => prisma.workflow_execution_events.findFirst({
						where: {
							execution_id: this.executionId,
							node_id: nodeId,
							event_type: {
								in: ["node_started", "node_recovery_started", "node_external_check_started", "node_heartbeat"],
							},
						},
						select: { created_at: true },
						orderBy: [{ created_at: "desc" }, { seq: "desc" }],
					}),
				);
				if (!latestOwnershipEvent) {
					abandonedNodeIds.push(nodeId);
					continue;
				}
				const latestOwnershipMs = Date.parse(latestOwnershipEvent.created_at);
				if (!Number.isFinite(latestOwnershipMs)) {
					return new Response(
						`Workflow node ${nodeId} has an invalid ownership timestamp`,
						{ status: 500 },
					);
				}
				if (latestOwnershipMs < cutoffMs) abandonedNodeIds.push(nodeId);
			}
			runningNodeIds = abandonedNodeIds;
			if (runningNodeIds.length === 0) {
				return Response.json({
					recovered: 0,
					failedExplicitly: 0,
					executionStatus: execution.status,
					ownershipStillActive: true,
				}, { status: 208 });
			}
		}
		try {
			// The queue-side scan and this DO transaction are separated by an
			// asynchronous boundary. A node may reach or leave `running` between
			// those reads, so the caller's lists are advisory snapshots only. The
			// DO owns the current persisted state and immutable flow version; derive
			// the exact recovery classification here to eliminate that TOCTOU race.
			recoverableNodeIds = [];
			unsafeNodeIds = [];
			for (const nodeId of runningNodeIds) {
				if (resolveWorkflowNodeRestartPolicy(flowData, nodeId) === "fail_explicitly") unsafeNodeIds.push(nodeId);
				else recoverableNodeIds.push(nodeId);
			}
		} catch (error: unknown) {
			return new Response(error instanceof Error ? error.message : "Recovery policy validation failed", { status: 400 });
		}

		const latestEvent = await this.readRecoveryDatabase(
			"workflow_latest_event_snapshot",
			() => prisma.workflow_execution_events.findFirst({
				where: { execution_id: this.executionId },
				orderBy: { seq: "desc" },
				select: { seq: true },
			}),
		);
		// Rebuild queued reservations from the authoritative DAG after a runtime
		// restart. This also performs the hard cutover from the former ambiguous
		// queued state, where undispatched dependency-blocked nodes used the same
		// value as true dispatch intents. Reissuing the same attempt is idempotent.
		await updateNodeRuns(this.env.DB, {
			executionId: this.executionId,
			nodeIds: nodeRuns.filter((run) => run.status === "queued").map((run) => run.node_id),
			update: { status: "pending" },
		});
		const recoveryMessagePrefix = recoveryReason === "process_startup"
			? "Local workflow runtime restarted"
			: "Workflow node ownership lease expired";
		for (const nodeId of recoverableNodeIds) {
			const restartPolicy = resolveWorkflowNodeRestartPolicy(flowData, nodeId);
			await incrementNodeRunAttempt(this.env.DB, {
				executionId: this.executionId,
				nodeId,
				trigger: "runtime_recovery",
				nextStatus: "queued",
				previousErrorMessage: `${recoveryMessagePrefix}; node recovery mode is ${restartPolicy}`,
				previousErrorCode: "workflow_runtime_restarted",
				failureStage: resolveWorkflowNodeRetryPolicy(flowData, nodeId).failureStage,
				nowIso,
			});
		}
		const interruptionMessage = recoveryReason === "process_startup"
			? "Local workflow runtime restarted while a non-replayable node was running"
			: "Workflow node ownership lease expired while a non-replayable node was running";
		for (const nodeId of unsafeNodeIds) {
			await updateNodeRun(this.env.DB, {
				executionId: this.executionId,
				nodeId,
				status: "failed",
				errorMessage: interruptionMessage,
				errorCode: "workflow_runtime_restart_unsafe",
				failureStage: resolveWorkflowNodeRetryPolicy(flowData, nodeId).failureStage,
				finishedAt: nowIso,
			});
		}
		const persistedTerminalFailure = nodeRuns.some((run) => run.status === "failed" || run.status === "canceled" || run.status === "skipped");
		const executionFailedByRestart = execution.status === "running" && unsafeNodeIds.length > 0;
		const executionMustFail = executionFailedByRestart || (execution.status === "running" && persistedTerminalFailure);
		if (executionMustFail) {
			const failureMessage = executionFailedByRestart
				? interruptionMessage
				: "Recovered workflow contains a persisted terminal node failure";
			await updateExecutionStatus(this.env.DB, {
				executionId: this.executionId,
				status: "failed",
				errorMessage: failureMessage,
				finishedAt: nowIso,
			});
		}

		const effectiveExecutionStatus = executionMustFail || execution.status === "failed" ? "failed" : "running";
		if (effectiveExecutionStatus === "failed") {
			const blockedRuns = await this.readRecoveryDatabase(
				"workflow_blocked_runs_snapshot",
				() => prisma.workflow_node_runs.findMany({
					where: { execution_id: this.executionId, status: { in: ["pending", "queued"] }, node_id: { notIn: recoverableNodeIds } },
					select: { node_id: true },
				}),
			);
			await updateNodeRuns(this.env.DB, {
				executionId: this.executionId,
				nodeIds: blockedRuns.map((run) => run.node_id),
				update: {
					status: "skipped",
					errorMessage: executionFailedByRestart
						? interruptionMessage
						: "Execution was already failed when local workflow state was restored",
					finishedAt: nowIso,
				},
			});
		}
		const recoveredRuns = await this.readRecoveryDatabase(
			"workflow_recovered_runs_snapshot",
			() => prisma.workflow_node_runs.findMany({
				where: { execution_id: this.executionId },
				select: { node_id: true, status: true, output_refs: true },
			}),
		);
		let graph: GraphState;
		try {
			graph = rebuildWorkflowExecutionGraph({
				flowData,
				executionStatus: effectiveExecutionStatus,
				concurrency: execution.concurrency,
				latestEventSeq: latestEvent?.seq ?? 0,
				nodeRuns: recoveredRuns.map((run) => ({
					nodeId: run.node_id,
					status: run.status,
					...(run.output_refs != null ? { outputRefs: parseStoredJson(run.output_refs) } : {}),
				})),
			});
		} catch (error: unknown) {
			return new Response(error instanceof Error ? error.message : "Workflow graph recovery failed", { status: 400 });
		}
		const inferredNotSelected = graph.notSelected.filter((nodeId) => (
			recoveredRuns.find((run) => run.node_id === nodeId)?.status === "pending"
		));
		if (inferredNotSelected.length > 0) await this.persistNotSelectedNodeRuns(inferredNotSelected, nowIso);
		const allNodesSucceeded = recoveredRuns.length === Object.keys(graph.indeg).length
			&& recoveredRuns.every((run) => run.status === "success" || run.status === "not_selected" || inferredNotSelected.includes(run.node_id));
		if (effectiveExecutionStatus === "running" && allNodesSucceeded) {
			graph.status = "success";
		}
		await this.saveGraphState(graph);
		for (const nodeId of recoverableNodeIds) {
			await this.appendEvent({
				eventType: "node_recovered_after_restart",
				level: "warn",
				nodeId,
				message: "Node was requeued using its declared restart policy",
				data: {
					restartPolicy: resolveWorkflowNodeRestartPolicy(flowData, nodeId),
					recoveryReason,
					...(ownershipStaleBefore ? { ownershipStaleBefore } : {}),
				},
			});
		}
		for (const nodeId of unsafeNodeIds) {
			await this.appendEvent({
				eventType: "node_restart_interrupted",
				level: "error",
				nodeId,
				message: interruptionMessage,
				data: {
					restartPolicy: "fail_explicitly",
					recoveryReason,
					...(ownershipStaleBefore ? { ownershipStaleBefore } : {}),
				},
			});
		}
		if (executionMustFail) {
			await this.appendEvent({
				eventType: "execution_failed",
				level: "error",
				message: executionFailedByRestart ? interruptionMessage : "Recovered workflow contains a persisted terminal node failure",
				data: { unsafeNodeIds },
			});
		}
		if (graph.status === "success") {
			await updateExecutionStatus(this.env.DB, {
				executionId: this.executionId,
				status: "success",
				finishedAt: nowIso,
			});
			await this.appendEvent({
				eventType: "execution_succeeded",
				level: "info",
				message: "Execution terminal state was restored from persisted node facts",
				data: { recoveredAfterRestart: true },
			});
		} else if (effectiveExecutionStatus === "running") {
			await this.redispatchPersistedQueuedNodes(new Set(recoverableNodeIds));
			await this.schedule(new Set(recoverableNodeIds));
		} else {
			await this.redispatchPersistedQueuedNodes(new Set(recoverableNodeIds));
		}
		return Response.json({
			recovered: recoverableNodeIds.length,
			failedExplicitly: unsafeNodeIds.length,
			executionStatus: graph.status,
		});
	}

	private async handleStart(): Promise<Response> {
		const execution = await getPrismaClient().workflow_executions.findUnique({
			where: { id: this.executionId },
			select: {
				id: true,
				flow_version_id: true,
				status: true,
				concurrency: true,
			},
		});
		if (!execution) return new Response("Execution not found", { status: 404 });
		if (execution.status !== "queued") {
			return new Response(`Execution already ${execution.status}`, { status: 208 });
		}

		const nowIso = new Date().toISOString();
		const claimed = await claimQueuedExecutionStart(this.env.DB, {
			executionId: this.executionId,
			startedAt: nowIso,
		});
		if (!claimed) {
			return new Response("Execution start was already claimed", { status: 208 });
		}

		const flowData = await loadFlowVersionData(
			this.env.DB,
			execution.flow_version_id,
		);
		if (!flowData) {
			await updateExecutionStatus(this.env.DB, {
				executionId: this.executionId,
				status: "failed",
				errorMessage: "Invalid flow version data",
				finishedAt: new Date().toISOString(),
			});
			await this.appendEvent({
				eventType: "execution_failed",
				level: "error",
				message: "Invalid flow version data",
			});
			return new Response("Invalid flow version data", { status: 400 });
		}

		const compiledGraph = compileWorkflowGraph(flowData);
		const { nodeIds } = compiledGraph;
		if (!nodeIds.length) {
			await updateExecutionStatus(this.env.DB, {
				executionId: this.executionId,
				status: "success",
				finishedAt: new Date().toISOString(),
			});
			await this.appendEvent({
				eventType: "execution_succeeded",
				level: "info",
				message: "Empty workflow",
			});
			return new Response("ok");
		}
		if (workflowGraphHasCycle(compiledGraph)) {
			await updateExecutionStatus(this.env.DB, {
				executionId: this.executionId,
				status: "failed",
				errorMessage: "Cycle detected in workflow graph",
				finishedAt: new Date().toISOString(),
			});
			await this.appendEvent({
				eventType: "execution_failed",
				level: "error",
				message: "Cycle detected in workflow graph",
			});
			return new Response("Cycle detected", { status: 400 });
		}

		await ensureNodeRuns(this.env.DB, {
			executionId: this.executionId,
			nodeIds: [...nodeIds],
			nowIso,
		});

		let outputReuses: ReturnType<typeof readResolvedWorkflowOutputReuses>;
		let replayCheckpoints: ReturnType<typeof readResolvedWorkflowReplayCheckpoints>;
		try {
			outputReuses = readResolvedWorkflowOutputReuses(flowData);
			replayCheckpoints = readResolvedWorkflowReplayCheckpoints(flowData);
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : "Resolved workflow output reuse is invalid";
			await updateExecutionStatus(this.env.DB, {
				executionId: this.executionId,
				status: "failed",
				errorMessage: message,
				finishedAt: nowIso,
			});
			return new Response(message, { status: 409 });
		}
		for (const { nodeId, reuse } of outputReuses) {
			await updateNodeRun(this.env.DB, {
				executionId: this.executionId,
				nodeId,
				status: "success",
				outputRefs: reuse.outputRefs,
				startedAt: nowIso,
				finishedAt: nowIso,
			});
		}
		for (const { nodeId, checkpoint } of replayCheckpoints) {
			await updateNodeRun(this.env.DB, {
				executionId: this.executionId,
				nodeId,
				status: "pending",
				outputRefs: checkpoint.outputRefs,
			});
		}
		const reusedNodeIds = new Set(outputReuses.map(({ nodeId }) => nodeId));
		const replayCheckpointByNodeId = new Map(replayCheckpoints.map(({ nodeId, checkpoint }) => [nodeId, checkpoint] as const));
		const graphState = rebuildWorkflowExecutionGraph({
			flowData,
			executionStatus: "running",
			concurrency: Number(execution.concurrency || 1),
			latestEventSeq: 0,
			nodeRuns: nodeIds.map((nodeId) => ({
				nodeId,
				status: reusedNodeIds.has(nodeId) ? "success" : "pending",
				...((outputReuses.find((entry) => entry.nodeId === nodeId)?.reuse.outputRefs
					?? replayCheckpointByNodeId.get(nodeId)?.outputRefs) !== undefined
					? {
						outputRefs: outputReuses.find((entry) => entry.nodeId === nodeId)?.reuse.outputRefs
							?? replayCheckpointByNodeId.get(nodeId)?.outputRefs,
					}
					: {}),
			})),
		});
		if (graphState.notSelected.length > 0) {
			await this.persistNotSelectedNodeRuns(graphState.notSelected, nowIso);
		}
		if (outputReuses.length + graphState.notSelected.length === nodeIds.length) graphState.status = "success";
		await this.saveGraphState(graphState);
		await this.state.storage.put("seq", 0);
		await this.appendEvent({ eventType: "execution_created", level: "info" });
		await this.appendEvent({ eventType: "execution_started", level: "info" });
		for (const { nodeId, reuse } of outputReuses) {
			await this.appendEvent({
				eventType: "node_output_reused",
				level: "info",
				nodeId,
				message: reuse.kind === "pin"
					? "Node used a pinned durable output"
					: "Node reused an unchanged upstream output for partial replay",
				data: {
					kind: reuse.kind,
					sourceExecutionId: reuse.sourceExecutionId,
					sourceNodeRunId: reuse.sourceNodeRunId,
				},
			});
		}
		for (const { nodeId, checkpoint } of replayCheckpoints) {
			await this.appendEvent({
				eventType: "node_output_reused",
				level: "info",
				nodeId,
				message: "Node replay seeded unchanged successful collection items",
				data: {
					kind: checkpoint.kind,
					sourceExecutionId: checkpoint.sourceExecutionId,
					sourceNodeRunId: checkpoint.sourceNodeRunId,
					reusedItemCount: checkpoint.outputRefs.itemRuns.length,
				},
			});
		}
		if (graphState.status === "success") {
			await updateExecutionStatus(this.env.DB, {
				executionId: this.executionId,
				status: "success",
				finishedAt: nowIso,
			});
			await this.appendEvent({
				eventType: "execution_succeeded",
				level: "info",
				message: "Execution satisfied entirely by validated durable output reuse",
			});
			return new Response("ok");
		}
		await this.schedule();
		return new Response("ok");
	}

	private async handleNodeStarted(request: Request): Promise<Response> {
		const graph = await this.loadGraphState();
		let body: Record<string, unknown>;
		try {
			body = await parseRequestBody(request);
		} catch (error: unknown) {
			return new Response(
				error instanceof Error ? error.message : "Invalid request body",
				{ status: 400 },
			);
		}
		const nodeId = typeof body.nodeId === "string" ? body.nodeId.trim() : "";
		if (!nodeId) return new Response("bad request", { status: 400 });
		if (!graph) {
			return new Response("Execution graph is not initialized", { status: 409 });
		}
		if (!(nodeId in graph.indeg)) {
			return new Response("Node is outside the execution graph", { status: 404 });
		}
		const nodeAttempt = await this.requireCurrentNodeAttempt(body, nodeId);
		if (nodeAttempt instanceof Response) return nodeAttempt;
		const nodeRun = nodeAttempt;
		if (nodeRun.status === "waiting_external") {
			return new Response("resume external wait", { status: 209 });
		}
		if (
			nodeRun.status === "running" ||
			nodeRun.status === "success" ||
			nodeRun.status === "failed" ||
			nodeRun.status === "canceled" ||
				nodeRun.status === "skipped"
				|| nodeRun.status === "not_selected"
		) {
			return new Response(`already ${nodeRun.status}`, { status: 208 });
		}
		if (graph.status !== "running") {
			return new Response("Execution is not running", { status: 409 });
		}
		if (nodeRun.status !== "queued") {
			return new Response(`Node run is ${nodeRun.status}`, { status: 409 });
		}
		const pendingReservationIndex = graph.ready.indexOf(nodeId);
		if (pendingReservationIndex >= 0) {
			graph.ready.splice(pendingReservationIndex, 1);
			graph.running += 1;
			await this.saveGraphState(graph);
		}
		const nowIso = new Date().toISOString();
		await updateNodeRun(this.env.DB, {
			executionId: this.executionId,
			nodeId,
			status: "running",
			errorMessage: null,
			errorCode: null,
			failureStage: null,
			startedAt: nowIso,
			finishedAt: null,
		});
		await this.appendEvent({ eventType: "node_started", nodeId });
		return new Response("accepted", { status: 202 });
	}

	private async handleNodeHeartbeat(request: Request): Promise<Response> {
		const graph = await this.loadGraphState();
		let body: Record<string, unknown>;
		try {
			body = await parseRequestBody(request);
		} catch (error: unknown) {
			return new Response(
				error instanceof Error ? error.message : "Invalid request body",
				{ status: 400 },
			);
		}
		const nodeId = typeof body.nodeId === "string" ? body.nodeId.trim() : "";
		if (!nodeId) return new Response("bad request", { status: 400 });
		if (!graph) {
			return new Response("Execution graph is not initialized", { status: 409 });
		}
		if (!(nodeId in graph.indeg)) {
			return new Response("Node is outside the execution graph", { status: 404 });
		}
		const nodeAttempt = await this.requireCurrentNodeAttempt(body, nodeId);
		if (nodeAttempt instanceof Response) return nodeAttempt;
		if (nodeAttempt.status !== "running" || graph.status !== "running") {
			return new Response(`already ${nodeAttempt.status}`, { status: 208 });
		}
		await this.appendEvent({
			eventType: "node_heartbeat",
			level: "debug",
			nodeId,
			data: {
				nodeRunId: nodeAttempt.id,
				attempt: nodeAttempt.attempt,
			},
		});
		return new Response("accepted", { status: 202 });
	}

	private async handleNodeRecoveryStarted(request: Request): Promise<Response> {
		const graph = await this.loadGraphState();
		let body: Record<string, unknown>;
		try {
			body = await parseRequestBody(request);
		} catch (error: unknown) {
			return new Response(error instanceof Error ? error.message : "Invalid request body", { status: 400 });
		}
		const nodeId = typeof body.nodeId === "string" ? body.nodeId.trim() : "";
		if (!nodeId || !graph || !(nodeId in graph.indeg)) return new Response("Invalid recovery node", { status: 409 });
		const prisma = getPrismaClient();
		const execution = await prisma.workflow_executions.findUnique({
			where: { id: this.executionId },
			select: { flow_version_id: true },
		});
		if (!execution) return new Response("Execution not found", { status: 404 });
		const flowData = await loadFlowVersionData(this.env.DB, execution.flow_version_id);
		if (!flowData || resolveWorkflowNodeRestartPolicy(flowData, nodeId) === "fail_explicitly") {
			return new Response("Recovery node has no automatic restart contract", { status: 409 });
		}
		const nodeAttempt = await this.requireCurrentNodeAttempt(body, nodeId);
		if (nodeAttempt instanceof Response) return nodeAttempt;
		const nodeRun = nodeAttempt;
		if (nodeRun.status === "running" || nodeRun.status === "success" || nodeRun.status === "failed" || nodeRun.status === "canceled" || nodeRun.status === "skipped" || nodeRun.status === "not_selected") {
			return new Response(`already ${nodeRun.status}`, { status: 208 });
		}
		if (nodeRun.status === "waiting_external") return new Response("resume external wait", { status: 209 });
		if (nodeRun.status !== "queued") return new Response(`Node run is ${nodeRun.status}`, { status: 409 });
		// schedule() already reserves one concurrency slot before enqueueing a recovery job.
		// Re-reserving it here strands the next ready node after this recovery succeeds.
		// Keep the original started_at as the user-visible wall-clock start across attempts.
		await updateNodeRun(this.env.DB, {
			executionId: this.executionId,
			nodeId,
			status: "running",
			errorMessage: null,
			errorCode: null,
			failureStage: null,
			finishedAt: null,
		});
		await this.appendEvent({ eventType: "node_recovery_started", nodeId });
		return new Response("accepted", { status: 202 });
	}

	private async handleNodeExternalCheckStarted(request: Request): Promise<Response> {
		let body: Record<string, unknown>;
		try {
			body = await parseRequestBody(request);
		} catch (error: unknown) {
			return new Response(error instanceof Error ? error.message : "Invalid request body", { status: 400 });
		}
		const nodeId = typeof body.nodeId === "string" ? body.nodeId.trim() : "";
		if (!nodeId) return new Response("Invalid external check target", { status: 400 });
		const graphState = await this.loadOrRehydrateGraphState(nodeId);
		if (graphState instanceof Response) return graphState;
		const graph = graphState;
		const nodeAttempt = await this.requireCurrentNodeAttempt(body, nodeId);
		if (nodeAttempt instanceof Response) return nodeAttempt;
		const nodeRun = nodeAttempt;
		if (nodeRun.status === "success" || nodeRun.status === "failed" || nodeRun.status === "canceled" || nodeRun.status === "skipped" || nodeRun.status === "not_selected" || nodeRun.status === "running") {
			return new Response(`already ${nodeRun.status}`, { status: 208 });
		}
		if ((graph.status !== "running" && graph.status !== "failed") || nodeRun.status !== "waiting_external") {
			return new Response(`Node run is ${nodeRun.status}`, { status: 409 });
		}
		graph.running += 1;
		await this.saveGraphState(graph);
		await updateNodeRun(this.env.DB, {
			executionId: this.executionId,
			nodeId,
			status: "running",
			errorMessage: null,
			errorCode: null,
			failureStage: null,
			finishedAt: null,
		});
		await this.appendEvent({ eventType: "node_external_check_started", nodeId });
		return new Response("accepted", { status: 202 });
	}

	private async handleNodeWaiting(request: Request): Promise<Response> {
		const graph = await this.loadGraphState();
		let body: Record<string, unknown>;
		try {
			body = await parseRequestBody(request);
		} catch (error: unknown) {
			return new Response(error instanceof Error ? error.message : "Invalid request body", { status: 400 });
		}
		const nodeId = typeof body.nodeId === "string" ? body.nodeId.trim() : "";
		if (!nodeId || !graph || !(nodeId in graph.indeg)) return new Response("Invalid waiting node", { status: 409 });
		if (graph.status !== "running" && graph.status !== "failed") return new Response("Execution is not active", { status: 409 });
		const nodeAttempt = await this.requireCurrentNodeAttempt(body, nodeId);
		if (nodeAttempt instanceof Response) return nodeAttempt;
		const nodeRun = nodeAttempt;
		if (nodeRun.status === "waiting_external") return new Response("already waiting", { status: 208 });
		if (nodeRun.status !== "running") return new Response(`Node run is ${nodeRun.status}`, { status: 409 });
		graph.running = Math.max(0, graph.running - 1);
		await this.saveGraphState(graph);
		await updateNodeRun(this.env.DB, {
			executionId: this.executionId,
			nodeId,
			status: "waiting_external",
			outputRefs: body.outputRefs,
			errorMessage: null,
			errorCode: null,
			failureStage: null,
			finishedAt: null,
		});
		await this.appendEvent({ eventType: "node_waiting_external", nodeId, data: { receiptPersisted: true } });
		if (graph.status === "running") await this.schedule();
		return new Response("accepted", { status: 202 });
	}

	private async handleNodeProgress(request: Request): Promise<Response> {
		let body: Record<string, unknown>;
		try {
			body = await parseRequestBody(request);
		} catch (error: unknown) {
			return new Response(error instanceof Error ? error.message : "Invalid progress request", { status: 400 });
		}
		const nodeId = typeof body.nodeId === "string" ? body.nodeId.trim() : "";
		if (!nodeId) return new Response("Invalid progress node", { status: 400 });
		let outputRefs;
		try {
			outputRefs = parseWorkflowNodeOutputV1(body.outputRefs);
		} catch (error: unknown) {
			return new Response(error instanceof Error ? error.message : "Invalid progress output refs", { status: 400 });
		}
		if (!outputRefs || outputRefs.nodeId !== nodeId || outputRefs.executionMode !== "each") {
			return new Response("Progress output must belong to the running each node", { status: 400 });
		}
		const graph = await this.loadGraphState();
		// 并行分支级联失败时 graph.status 会先翻为 failed，但其它仍在执行的 each
		// 节点（含恢复中的 item）还会继续 checkpoint。progress 是纯进度上报、不改变
		// 节点生命周期，failed 状态同样必须接受，否则在飞分支的 checkpoint 会 409
		// 误报成节点失败，掩盖真实根因（实测 asset-image-generate 反复如此）。
		if (!graph || (graph.status !== "running" && graph.status !== "failed") || !(nodeId in graph.indeg)) {
			console.info(JSON.stringify({
				message: "node_progress_rejected_not_running_node",
				executionId: this.executionId,
				nodeId,
				graphStatus: graph?.status ?? null,
				inIndeg: graph ? nodeId in graph.indeg : false,
			}));
			return new Response("Execution is not running this node", { status: 409 });
		}
		const nodeAttempt = await this.requireCurrentNodeAttempt(body, nodeId);
		if (nodeAttempt instanceof Response) {
			console.info(JSON.stringify({
				message: "node_progress_rejected_attempt",
				executionId: this.executionId,
				nodeId,
				attemptBody: body,
			}));
			return nodeAttempt;
		}
		const nodeRun = nodeAttempt;
		// each 模式节点的 item 可能交错：部分 item 进入外部等待（waiting_external）时
		// 父节点被标 waiting_external，但其它 item 仍可能继续完成并 checkpoint（恢复
		// 的 item 在 resume 后也会 checkpoint）。waiting_external 只是「存在外部等待
		// item」的信号，不代表整个节点停止运行——此时 progress 必须接受，否则恢复
		// item 的 checkpoint 会 409 并拖垮整个节点（实测 asset-image-generate 恢复
		// 时反复 409 失败）。
		if (nodeRun.status !== "running" && nodeRun.status !== "waiting_external") {
			console.info(JSON.stringify({
				message: "node_progress_rejected_run_status",
				executionId: this.executionId,
				nodeId,
				runStatus: nodeRun.status,
			}));
			return new Response(`Node run is ${nodeRun.status}`, { status: 409 });
		}
		// checkpoint 是进度上报，不改变节点生命周期状态：父节点在 waiting_external
		// （部分 item 外部等待）时保持 waiting_external，running 时保持 running。
		// 不能强制改回 running——那会覆盖外部等待信号，导致后续恢复的 item 状态错乱。
		await updateNodeRun(this.env.DB, {
			executionId: this.executionId,
			nodeId,
			status: nodeRun.status,
			outputRefs,
		});
		await this.appendEvent({
			eventType: "node_progress",
			nodeId,
			data: {
				completedItems: outputRefs.evidence.completedItems ?? 0,
				failedItems: outputRefs.evidence.failedItems ?? 0,
				settledItems: outputRefs.evidence.settledItems ?? outputRefs.itemRuns.length,
				totalItems: outputRefs.evidence.totalItems ?? outputRefs.itemRuns.length,
			},
		});
		return new Response("accepted", { status: 202 });
	}

	private async handleNodeComplete(request: Request): Promise<Response> {
		const graph = await this.loadGraphState();
		let body: Record<string, unknown>;
		try {
			body = await parseRequestBody(request);
		} catch (error: unknown) {
			return new Response(
				error instanceof Error ? error.message : "Invalid request body",
				{ status: 400 },
			);
		}
		const nodeId = typeof body.nodeId === "string" ? body.nodeId.trim() : "";
		if (typeof body.ok !== "boolean") {
			return new Response("ok must be boolean", { status: 400 });
		}
		const ok = body.ok;
		const errorMessage =
			typeof body.errorMessage === "string" ? body.errorMessage : null;
		const errorCode =
			typeof body.errorCode === "string" ? body.errorCode : null;
		const outputRefs = body.outputRefs;
		if (!nodeId) return new Response("bad request", { status: 400 });
		if (!graph) {
			return new Response("Execution graph is not initialized", { status: 409 });
		}
		if (!(nodeId in graph.indeg)) {
			return new Response("Node is outside the execution graph", { status: 404 });
		}
		const nodeAttempt = await this.requireCurrentNodeAttempt(body, nodeId);
		if (nodeAttempt instanceof Response) return nodeAttempt;
		const nodeRun = nodeAttempt;
		if (
			nodeRun.status === "success" ||
			nodeRun.status === "failed" ||
			nodeRun.status === "skipped"
			|| nodeRun.status === "not_selected"
		) {
			return new Response(`already ${nodeRun.status}`);
		}
		if (nodeRun.status === "canceled") {
			if (outputRefs !== undefined) {
				await updateNodeRun(this.env.DB, {
					executionId: this.executionId,
					nodeId,
					status: "canceled",
					outputRefs,
				});
				await this.appendEvent({
					eventType: "node_output_after_cancel",
					level: "warn",
					nodeId,
					message: "Late node output was preserved after workflow cancellation",
				});
			}
			return new Response("already canceled; late output preserved");
		}
		if (nodeRun.status !== "running") {
			return new Response(`Node run is ${nodeRun.status}`, { status: 409 });
		}

		const nowIso = new Date().toISOString();
		if (graph.status === "failed") {
			graph.running = Math.max(0, graph.running - 1);
			await this.saveGraphState(graph);
			await updateNodeRun(this.env.DB, {
				executionId: this.executionId,
				nodeId,
				status: ok ? "success" : "failed",
				...(ok
					? {
							outputRefs,
							errorMessage: null,
							errorCode: null,
							failureStage: null,
						}
					: {
							errorMessage: errorMessage || "node failed",
							...(outputRefs !== undefined ? { outputRefs } : {}),
						}),
				finishedAt: nowIso,
			});
			await this.appendEvent({
				eventType: ok ? "node_succeeded" : "node_failed",
				level: ok ? "info" : "error",
				nodeId,
				message: ok
					? "Node completed after the execution had already failed; output was preserved"
					: errorMessage || "node failed after execution failure",
				data: {
					afterExecutionFailure: true,
					...(errorCode ? { errorCode } : {}),
				},
			});
			return new Response("recorded after execution failure");
		}
		if (graph.status !== "running") {
			return new Response("Execution is not running", { status: 409 });
		}
		graph.running = Math.max(0, graph.running - 1);

		if (!ok) {
			const execution = await getPrismaClient().workflow_executions.findUnique({
				where: { id: this.executionId },
				select: { flow_version_id: true },
			});
			const flowData = execution ? await loadFlowVersionData(this.env.DB, execution.flow_version_id) : null;
			if (!flowData) return new Response("Workflow execution semantics snapshot is unavailable", { status: 500 });
			const retryPolicy = resolveWorkflowNodeRetryPolicy(flowData, nodeId);
			const durableRetryDirective = readWorkflowDurableRetryDirective(outputRefs);
			if (nodeRun.attempt < retryPolicy.maxAttempts || durableRetryDirective !== null) {
				// Preserve the executor's latest failure evidence before incrementing the
				// physical attempt. The next attempt must receive the exact monotonic
				// retry cursor rather than an older checkpoint.
				if (outputRefs !== undefined) {
					await updateNodeRun(this.env.DB, {
						executionId: this.executionId,
						nodeId,
						outputRefs,
					});
				}
				const nextAttempt = await incrementNodeRunAttempt(this.env.DB, {
					executionId: this.executionId,
					nodeId,
					trigger: "automatic_retry",
					nextStatus: "pending",
					previousErrorMessage: errorMessage || "node failed",
					previousErrorCode: errorCode || "workflow_node_runtime_failed",
					failureStage: retryPolicy.failureStage,
					nowIso,
				});
				if (!graph.ready.includes(nodeId)) graph.ready.unshift(nodeId);
				await this.saveGraphState(graph);
				await this.appendEvent({
					eventType: "node_retry_scheduled",
					level: "warn",
					nodeId,
					message: errorMessage || "Deterministic node retry scheduled",
					data: {
						errorCode,
						failureStage: retryPolicy.failureStage,
						logicalContinuation: durableRetryDirective !== null,
						...(durableRetryDirective
							? {
								failureCode: durableRetryDirective.failureCode,
								retryOrdinal: durableRetryDirective.retryOrdinal,
							}
							: {}),
						previousAttempt: nodeRun.attempt,
						nextAttempt,
						maxAttempts: retryPolicy.maxAttempts,
					},
				});
				await this.schedule();
				return new Response("retry scheduled", { status: 202 });
			}
			graph.status = "failed";
			// A terminal execution cannot retain active-looking sibling node runs.
			// Already accepted media continues in its provider/task ledger and its
			// late output remains preservable by the canceled-node completion path;
			// only this execution's scheduling/tracking lifecycle is closed here.
			graph.running = 0;
			await this.saveGraphState(graph);
			await updateNodeRun(this.env.DB, {
				executionId: this.executionId,
				nodeId,
				status: "failed",
				errorMessage: errorMessage || "node failed",
				errorCode: errorCode || "workflow_node_runtime_failed",
				failureStage: retryPolicy.failureStage,
				...(outputRefs !== undefined ? { outputRefs } : {}),
				finishedAt: nowIso,
			});
			await this.appendEvent({
				eventType: "node_failed",
				level: "error",
				nodeId,
				message: errorMessage || "node failed",
				data: errorCode ? { errorCode } : undefined,
			});
			await updateExecutionStatus(this.env.DB, {
				executionId: this.executionId,
				status: "failed",
				errorMessage: errorMessage || "node failed",
				errorCode: errorCode || "workflow_node_runtime_failed",
				failureStage: retryPolicy.failureStage,
				finishedAt: nowIso,
			});
			const unsettledRuns = await this.env.DB.workflow_node_runs.findMany({
				where: {
					execution_id: this.executionId,
					status: { in: ["pending", "queued", "running", "waiting_external"] },
					node_id: { not: nodeId },
				},
				select: { node_id: true, status: true },
			});
			const blockedRuns = unsettledRuns.filter((run) => run.status === "pending" || run.status === "queued");
			const activeSiblingRuns = unsettledRuns.filter((run) => run.status === "running" || run.status === "waiting_external");
			await updateNodeRuns(this.env.DB, {
				executionId: this.executionId,
				nodeIds: blockedRuns.map((run) => run.node_id),
				update: {
					status: "skipped",
					errorMessage: `Blocked because workflow node ${nodeId} failed`,
					finishedAt: nowIso,
				},
			});
			await updateNodeRuns(this.env.DB, {
				executionId: this.executionId,
				nodeIds: activeSiblingRuns.map((run) => run.node_id),
				update: {
					status: "canceled",
					errorMessage: `Execution tracking closed because workflow node ${nodeId} failed; accepted external tasks and late assets remain preserved`,
					errorCode: "workflow_execution_terminalized",
					finishedAt: nowIso,
				},
			});
			await this.appendEvent({
				eventType: "execution_failed",
				level: "error",
				message: errorMessage || "node failed",
				data: {
					nodeId,
					blockedNodeCount: blockedRuns.length,
					terminalizedActiveNodeCount: activeSiblingRuns.length,
					...(errorCode ? { errorCode } : {}),
				},
			});
			// 执行失败同样剥离该执行的 fan-out 中间产物（可能残留部分已完成资产），
			// 防 flow 主表污染；已受理的付费任务不受影响。
			await this.stripFanoutNodesAfterTerminal(nowIso);
			return new Response("ok");
		}

		await updateNodeRun(this.env.DB, {
			executionId: this.executionId,
			nodeId,
			status: "success",
			outputRefs,
			errorMessage: null,
			errorCode: null,
			failureStage: null,
			finishedAt: nowIso,
		});
		await this.appendEvent({ eventType: "node_succeeded", nodeId });

		const resolved = resolveWorkflowGraphNode(graph, { nodeId, status: "success", outputRefs });
		for (const readyNodeId of resolved.readyNodeIds) {
			if (!graph.ready.includes(readyNodeId) && !graph.notSelected.includes(readyNodeId)) graph.ready.push(readyNodeId);
		}
		if (resolved.notSelectedNodeIds.length > 0) {
			await this.persistNotSelectedNodeRuns(resolved.notSelectedNodeIds, nowIso);
		}

		const terminalRuns = await this.env.DB.workflow_node_runs.findMany({
			where: { execution_id: this.executionId },
			select: { status: true },
		});
		const allNodesSettled = terminalRuns.length === Object.keys(graph.indeg).length
			&& terminalRuns.every((run) => run.status === "success" || run.status === "not_selected");
		if (allNodesSettled) {
			graph.status = "success";
			await this.saveGraphState(graph);
			await updateExecutionStatus(this.env.DB, {
				executionId: this.executionId,
				status: "success",
				finishedAt: nowIso,
			});
			await this.appendEvent({
				eventType: "execution_succeeded",
				level: "info",
			});
			// 执行成功：剥离 fan-out 中间产物节点，保留 concat 成片节点（防 flow 主表污染）。
			await this.stripFanoutNodesAfterTerminal(nowIso);
			return new Response("ok");
		}

		await this.saveGraphState(graph);
		await this.schedule();
		return new Response("ok");
	}
}
