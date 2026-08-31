import type { WorkerEnv } from "../../types";
import crypto from "node:crypto";
import {
	hasWorkflowPluginExecutorRefPrefix,
	type WorkflowArtifactIdentityV1,
	type WorkflowInputBindingProvenanceV1,
} from "@tapcanvas/workflow-kernel-protocol";
import {
	findWorkflowNode,
	parseWorkflowNodeOutputV1,
	resolveWorkflowNodeExecutorRef,
	type WorkflowNodeExecutionResult,
	type WorkflowNodeOutputV1,
	type WorkflowNodeSnapshot,
} from "./execution.node-runtime";
import { executeRegisteredWorkflowNode } from "./execution.node-executors";
import { runWorkflowAgentNode } from "./execution.agent-runner";
import { runLocalWorkflowJavascript } from "./execution.javascript-runner";
import { runWorkflowImageNode } from "./execution.image-runner";
import {
	createWorkflowInternalContext,
	prepareWorkflowVideoProductionAssets,
	readWorkflowVoicePlanningFacts,
	runWorkflowVideoNode,
} from "./execution.video-runner";
import {
	readWorkflowCanvasGroup,
	readWorkflowCanvasGroupFromFlowData,
	readWorkflowCanvasProjectContextFromFlowData,
} from "./execution.canvas-source-runner";
import { stripWorkflowFanoutNodes } from "./execution.flow-cleanup";
import { estimateWorkflowVideo } from "./execution.video-estimate-runner";
import { concatWorkflowVideos } from "./execution.video-concat-runner";
import { projectWorkflowFilmToCanvas } from "./execution.video-delivery-projection";
import { resolveModelDurationOptions, resolveModelMediaOptions } from "../task/video-orchestrator.model-duration";
import { readWorkflowKnowledge, searchWorkflowKnowledge } from "./execution.knowledge-runner";
import { invokeWorkflowTool } from "./execution.tool-runner";
import { resolveWorkflowNodeRestartPolicy } from "./execution.recovery";
import { runWorkflowSubworkflow } from "./execution.subworkflow-runner";
import { createTrustedWorkflowPluginOwnerAdapters } from "./execution.plugin-adapters";
import { loadPersistedWorkflowPluginRuntimeRegistry } from "./execution.plugin-catalog";
import {
	createWorkflowPureCacheRequest,
	findWorkflowPureCacheHit,
	materializeWorkflowPureCacheHit,
	recordWorkflowPureCacheStore,
} from "./execution.pure-cache";
import {
	stampWorkflowNodeOutputProvenance,
	stampWorkflowNodeResultProvenance,
	type WorkflowProvenanceContext,
} from "./execution.provenance";
import {
	parseWorkflowNodeJob,
	workflowNodeAttemptMatches,
	type WorkflowNodeAttemptIdentity,
	type WorkflowNodeJob,
	type WorkflowNodeJobPhase,
} from "./execution.node-attempt";
import { createRuntimeWorkflowAssetResolver } from "./execution.project-context-runtime";
import { freshReadFlowRow } from "../task/video-orchestrator.flow-io";
import { insertExecutionEvent, updateNodeRun } from "./execution.repo";
import { resolveWorkflowNodeExecutionModelKey } from "./execution.node-model-attribution";
import { workflowExternalCheckDelaySeconds } from "./execution.external-check";
import { decideWorkflowFamilyAutomaticRecovery } from "./execution.auto-recovery";
import { refreshEquippedWorkflowExecutionFamilyProjection } from "../task/equipped-workflow-execution-projection";
import { parseWorkflowProjectContext, type WorkflowProjectContext } from "./execution.project-context";

export type { WorkflowNodeJob } from "./execution.node-attempt";

type ActiveWorkflowJobLease = Readonly<{
	signal: AbortSignal;
	invalidate: (reason: Error) => void;
	release: () => void;
}>;

const activeWorkflowJobs = new Map<string, Set<AbortController>>();

async function refreshWorkflowFamilyCanvasProjection(input: Readonly<{
	env: WorkerEnv;
	executionId: string;
	runtimeNodeId: string;
}>): Promise<void> {
	const execution = await input.env.DB.workflow_executions.findUnique({
		where: { id: input.executionId },
		select: { owner_id: true },
	});
	if (!execution) return;
	await refreshEquippedWorkflowExecutionFamilyProjection({
		c: createWorkflowInternalContext(input.env, {
			executionId: input.executionId,
			runtimeNodeId: input.runtimeNodeId,
			ownerId: execution.owner_id,
		}),
		ownerId: execution.owner_id,
		executionId: input.executionId,
	});
}

async function appendAutomaticRecoveryEvent(input: Readonly<{
	env: WorkerEnv;
	executionId: string;
	nodeId: string;
	eventType: string;
	level: "info" | "warn" | "error";
	message: string;
	data: Readonly<Record<string, unknown>>;
}>): Promise<void> {
	await insertExecutionEvent(input.env.DB, {
		id: crypto.randomUUID(),
		executionId: input.executionId,
		eventType: input.eventType,
		level: input.level,
		nodeId: input.nodeId,
		message: input.message,
		data: input.data,
		nowIso: new Date().toISOString(),
	});
}

async function continueRepairableWorkflowFamily(input: Readonly<{
	env: WorkerEnv;
	executionId: string;
	nodeId: string;
}>): Promise<void> {
	const execution = await input.env.DB.workflow_executions.findUnique({
		where: { id: input.executionId },
		select: {
			id: true,
			owner_id: true,
			status: true,
			failure_stage: true,
			execution_family_id: true,
		},
	});
	if (!execution) return;
	const [familyExecutionCount, activeExecutionCount] = await Promise.all([
		input.env.DB.workflow_executions.count({
			where: { execution_family_id: execution.execution_family_id, owner_id: execution.owner_id },
		}),
		input.env.DB.workflow_executions.count({
			where: {
				execution_family_id: execution.execution_family_id,
				owner_id: execution.owner_id,
				status: { in: ["queued", "running"] },
			},
		}),
	]);
	const decision = decideWorkflowFamilyAutomaticRecovery({
		executionStatus: execution.status,
		failureStage: execution.failure_stage,
		familyExecutionCount,
		activeExecutionCount,
	});
	if (!decision.eligible) {
		await appendAutomaticRecoveryEvent({
			env: input.env,
			executionId: input.executionId,
			nodeId: input.nodeId,
			eventType: "execution_automatic_recovery_not_started",
			level: "warn",
			message: "Automatic same-family continuation was not admissible",
			data: { ...decision, familyExecutionCount, activeExecutionCount },
		});
		return;
	}
	try {
		const { resumeWorkflowExecution } = await import("./execution.resume-service");
		const recovery = await resumeWorkflowExecution({
			context: createWorkflowInternalContext(input.env, {
				executionId: input.executionId,
				runtimeNodeId: input.nodeId,
				ownerId: execution.owner_id,
			}),
			env: input.env,
			ownerId: execution.owner_id,
			sourceExecutionId: input.executionId,
			trigger: "agent",
		});
		await appendAutomaticRecoveryEvent({
			env: input.env,
			executionId: input.executionId,
			nodeId: input.nodeId,
			eventType: "execution_automatic_recovery_started",
			level: "info",
			message: "Repairable pre-submit failure continued in the same execution family",
			data: { recoveryExecutionId: recovery.id, executionFamilyId: recovery.executionFamilyId },
		});
		await refreshWorkflowFamilyCanvasProjection({
			env: input.env,
			executionId: recovery.id,
			runtimeNodeId: input.nodeId,
		}).catch((error: unknown) => {
			console.error(JSON.stringify({
				message: "workflow_recovery_family_projection_refresh_failed",
				executionId: recovery.id,
				nodeId: input.nodeId,
				error: error instanceof Error ? error.message : String(error),
			}));
		});
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		await appendAutomaticRecoveryEvent({
			env: input.env,
			executionId: input.executionId,
			nodeId: input.nodeId,
			eventType: "execution_automatic_recovery_failed",
			level: "error",
			message: "Automatic same-family continuation failed",
			data: { error: message },
		});
	}
}

function abortActiveWorkflowNodeJobs(executionId: string, reason: Error): number {
	const controllers = activeWorkflowJobs.get(executionId);
	if (!controllers) return 0;
	activeWorkflowJobs.delete(executionId);
	for (const controller of controllers) {
		controller.abort(reason);
	}
	return controllers.size;
}

function registerActiveWorkflowJob(executionId: string): ActiveWorkflowJobLease {
	const controller = new AbortController();
	const controllers = activeWorkflowJobs.get(executionId) ?? new Set<AbortController>();
	controllers.add(controller);
	activeWorkflowJobs.set(executionId, controllers);
	return {
		signal: controller.signal,
		invalidate: (reason) => controller.abort(reason),
		release: () => {
			const active = activeWorkflowJobs.get(executionId);
			if (!active) return;
			active.delete(controller);
			if (active.size === 0) activeWorkflowJobs.delete(executionId);
		},
	};
}

const WORKFLOW_NODE_HEARTBEAT_INTERVAL_MS = 15_000;

/** Locally aborts node executors for one exact durable execution identity. */
export function cancelActiveWorkflowNodeJobs(executionId: string): number {
	return abortActiveWorkflowNodeJobs(
		executionId,
		new Error("workflow_execution_cancelled_by_user"),
	);
}

async function requireSuccessfulDurableResponse(
	response: {
		ok: boolean;
		status: number;
		text: () => Promise<string>;
	},
	action: string,
): Promise<void> {
	if (response.ok) return;
	const detail = (await response.text().catch(() => "")).trim();
	throw new Error(
		`${action} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
	);
}

type WorkflowNodeJobContext = {
	node: WorkflowNodeSnapshot;
	executionFamilyId: string;
	recoveryOfExecutionId: string | null;
	ownerId: string;
	flowId: string;
	flowVersionId: string;
	projectId: string | null;
	workflowKey: string | null;
	inputs: Record<string, readonly unknown[]>;
	flowVersionData: Record<string, unknown>;
	projectContext: WorkflowProjectContext | null;
	resumeOutputRefs?: WorkflowNodeOutputV1;
	resumeOnly: boolean;
	nodeRunId: string | null;
	nodeRunAttempt: number | null;
	inputProvenance: readonly WorkflowInputBindingProvenanceV1[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseStoredJson(value: string | null | undefined): unknown {
	if (!value) return undefined;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return undefined;
	}
}

function parseFlowData(value: unknown): Record<string, unknown> {
	const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
	if (!isRecord(parsed) || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
		throw new Error("Workflow immutable flow version must contain nodes and edges arrays");
	}
	return parsed;
}

function portFromHandle(value: unknown, prefix: string): string | null {
	if (typeof value !== "string" || !value.startsWith(prefix)) return null;
	try {
		const decoded = decodeURIComponent(value.slice(prefix.length)).trim();
		return decoded || null;
	} catch {
		return null;
	}
}

function parseNodeOutput(value: unknown): Record<string, unknown> | null {
	const parsed = typeof value === "string" ? (() => {
		try {
			return JSON.parse(value) as unknown;
		} catch {
			return null;
		}
	})() : value;
	return isRecord(parsed) ? parsed : null;
}

function outputArtifactIdentities(output: Record<string, unknown>): readonly WorkflowArtifactIdentityV1[] {
	if (!Array.isArray(output.artifacts)) return [];
	return output.artifacts.flatMap((value) => {
		if (!isRecord(value) || typeof value.type !== "string" || !value.type.trim()) return [];
		if (value.identity !== null && (typeof value.identity !== "string" || !value.identity.trim())) return [];
		return [{
			type: value.type.trim(),
			identity: value.identity === null ? null : value.identity.trim(),
		} satisfies WorkflowArtifactIdentityV1];
	});
}

async function loadWorkflowNodeJobContext(
	env: WorkerEnv,
	executionId: string,
	nodeId: string,
	phase: WorkflowNodeJobPhase,
	expectedAttempt: WorkflowNodeAttemptIdentity,
): Promise<WorkflowNodeJobContext> {
	const execution = await env.DB.workflow_executions.findUnique({
		where: { id: executionId },
		select: {
			flow_version_id: true,
			flow_id: true,
			owner_id: true,
			execution_family_id: true,
			recovery_of_execution_id: true,
			project_context: true,
		},
	});
	if (!execution) {
		throw new Error(`Workflow execution ${executionId} does not exist`);
	}
	const flowVersion = await env.DB.flow_versions.findUnique({
		where: { id: execution.flow_version_id },
		select: { data: true },
	});
	if (!flowVersion) {
		throw new Error(
			`Workflow execution ${executionId} references a missing flow version`,
		);
	}
	const flowData = parseFlowData(flowVersion.data);
	const projectContext = parseWorkflowProjectContext(parseStoredJson(execution.project_context));
	const node = findWorkflowNode(flowData, nodeId);
	const executorRef = resolveWorkflowNodeExecutorRef(node);
	const edges = flowData.edges as unknown[];
	const incomingEdges = edges.filter((edge) => isRecord(edge) && edge.target === nodeId);
	const sourceNodeIds = incomingEdges.flatMap((edge) => (
		isRecord(edge) && typeof edge.source === "string" && edge.source.trim()
			? [edge.source.trim()]
			: []
	));
	const upstreamRuns = sourceNodeIds.length > 0
		? await env.DB.workflow_node_runs.findMany({
				where: {
					execution_id: executionId,
					node_id: { in: sourceNodeIds },
					status: { in: ["success", "not_selected"] },
				},
				select: { id: true, node_id: true, status: true, output_refs: true },
			})
		: [];
	const runByNodeId = new Map(upstreamRuns.map((run) => [run.node_id, run] as const));
	const outputByNodeId = new Map(upstreamRuns.map((run) => [run.node_id, parseNodeOutput(run.output_refs)] as const));
	const statusByNodeId = new Map(upstreamRuns.map((run) => [run.node_id, run.status] as const));
	const inputs: Record<string, unknown[]> = {};
	const inputProvenance: WorkflowInputBindingProvenanceV1[] = [];
	const nodeData = isRecord(node.data) ? node.data : {};
	const atomicSpec = isRecord(nodeData.workflowAtomicSpec) ? nodeData.workflowAtomicSpec : {};
	const optionalInputPorts = new Set(
		(Array.isArray(atomicSpec.optionalInputPorts) ? atomicSpec.optionalInputPorts : Array.isArray(nodeData.workflowOptionalInputPorts) ? nodeData.workflowOptionalInputPorts : [])
			.flatMap((port) => typeof port === "string" && port.trim() ? [port.trim()] : []),
	);
	for (const edge of incomingEdges) {
		if (!isRecord(edge) || typeof edge.source !== "string") continue;
		if (statusByNodeId.get(edge.source) === "not_selected") continue;
		const sourcePort = portFromHandle(edge.sourceHandle, "out-workflow:");
		const targetPort = portFromHandle(edge.targetHandle, "in-workflow:");
		if (!sourcePort || !targetPort) {
			throw new Error(`Workflow edge feeding node ${nodeId} is missing explicit port handles`);
		}
		const sourceOutput = outputByNodeId.get(edge.source);
		const sourceRun = runByNodeId.get(edge.source);
		const sourcePorts = sourceOutput && isRecord(sourceOutput.ports) ? sourceOutput.ports : null;
		if (!sourceRun || !sourcePorts || !Object.prototype.hasOwnProperty.call(sourcePorts, sourcePort)) {
			if (optionalInputPorts.has(targetPort)) continue;
			throw new Error(`Upstream node ${edge.source} produced no value for port ${sourcePort}`);
		}
		const values = inputs[targetPort] ?? [];
		values.push(sourcePorts[sourcePort]);
		inputs[targetPort] = values;
		inputProvenance.push({
			sourceNodeId: edge.source,
			sourceNodeRunId: sourceRun.id,
			sourcePortId: sourcePort,
			targetPortId: targetPort,
			artifacts: sourceOutput ? outputArtifactIdentities(sourceOutput) : [],
		});
	}
	const flow = await env.DB.flows.findUnique({
		where: { id: execution.flow_id },
		select: { project_id: true },
	});
	const currentRun = await env.DB.workflow_node_runs.findUnique({
		where: { execution_id_node_id: { execution_id: executionId, node_id: nodeId } },
		select: { id: true, attempt: true, output_refs: true },
	});
	if (!currentRun || !workflowNodeAttemptMatches(
		{ nodeRunId: currentRun.id, attempt: currentRun.attempt },
		expectedAttempt,
	)) {
		throw new Error(`Workflow node ${nodeId} attempt changed before executor context was loaded`);
	}
	const currentOutput = parseWorkflowNodeOutputV1(currentRun?.output_refs);
	const isSamePhysicalExecutionRecovery = phase === "recover"
		&& execution.recovery_of_execution_id === null;
	const resumeOnly = phase === "await_external"
		|| (execution.recovery_of_execution_id !== null && currentOutput !== null)
		|| (executorRef === "agents.logical-task/v2" && (
			currentOutput !== null || isSamePhysicalExecutionRecovery
		));
	if (phase === "await_external" && !currentOutput) {
		throw new Error(`Workflow node ${nodeId} cannot resume an external task without a valid persisted output receipt`);
	}
	const nodeFacts = node.data;
	return {
		node,
		executionFamilyId: execution.execution_family_id,
		recoveryOfExecutionId: execution.recovery_of_execution_id,
		ownerId: execution.owner_id,
		flowId: execution.flow_id,
		flowVersionId: execution.flow_version_id,
		projectId: flow?.project_id ?? null,
		workflowKey: typeof nodeFacts.workflowKey === "string" && nodeFacts.workflowKey.trim()
			? nodeFacts.workflowKey.trim()
			: null,
		inputs,
		flowVersionData: flowData,
		projectContext,
		resumeOnly,
		nodeRunId: currentRun?.id ?? null,
		nodeRunAttempt: currentRun?.attempt ?? null,
		inputProvenance,
		...(currentOutput ? { resumeOutputRefs: currentOutput } : {}),
	};
}

function runtimeFailure(error: unknown): WorkflowNodeExecutionResult {
	return {
		ok: false,
		errorCode: "workflow_node_runtime_failed",
		errorMessage:
			error instanceof Error ? error.message : String(error),
	};
}

export async function handleWorkflowNodeJob(
	env: WorkerEnv,
	rawJob: WorkflowNodeJob,
): Promise<void> {
	const job = parseWorkflowNodeJob(rawJob);
	const { executionId, nodeId, nodeRunId, attempt } = job;
	const phase = job.phase === "await_external"
		? "await_external"
		: job.phase === "recover"
			? "recover"
			: "execute";
	const activeJob = registerActiveWorkflowJob(executionId);
	let stopHeartbeat: (() => void) | null = null;
	try {

	const namespace = env.EXECUTION_DO;
	if (!namespace) throw new Error("EXECUTION_DO binding missing");
	const stub = namespace.get(namespace.idFromName(executionId));

	const startedPath = phase === "await_external"
		? "https://do/nodeExternalCheckStarted"
		: phase === "recover"
			? "https://do/nodeRecoveryStarted"
			: "https://do/nodeStarted";
	const startedResponse = await stub.fetch(startedPath, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ nodeId, nodeRunId, attempt }),
		});
	await requireSuccessfulDurableResponse(
		startedResponse,
		`Marking workflow node ${nodeId} as started`,
	);
	if (startedResponse.status === 208) return;
	if (startedResponse.status === 209 && phase !== "await_external") {
		const queue = env.WORKFLOW_NODE_QUEUE;
		if (!queue) throw new Error("WORKFLOW_NODE_QUEUE binding missing");
		// One immediate reconciliation upgrades a pre-contract persisted wait into
		// an explicit timer/signal receipt. It does not submit the paid action again.
		await queue.send({ ...job, phase: "await_external" });
		return;
	}
	if (startedResponse.status !== 202) {
		throw new Error(
			`Workflow scheduler returned unexpected nodeStarted status ${startedResponse.status}`,
		);
	}

	let heartbeatInFlight = false;
	const heartbeatTimer = setInterval(() => {
		if (heartbeatInFlight) return;
		heartbeatInFlight = true;
		void stub.fetch("https://do/nodeHeartbeat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ nodeId, nodeRunId, attempt }),
		})
			.then(async (heartbeatResponse) => {
				await requireSuccessfulDurableResponse(
					heartbeatResponse,
					`Renewing workflow node ${nodeId} ownership`,
				);
				if (heartbeatResponse.status === 208) {
					stopHeartbeat?.();
					activeJob.invalidate(new Error(
						`workflow_node_attempt_ownership_lost:${executionId}:${nodeId}:${attempt}`,
					));
				}
			})
			.catch((error: unknown) => {
				console.error("[workflow-queue] node ownership heartbeat failed", {
					executionId,
					nodeId,
					nodeRunId,
					attempt,
					error: error instanceof Error ? error.message : String(error),
				});
			})
			.finally(() => {
				heartbeatInFlight = false;
			});
	}, WORKFLOW_NODE_HEARTBEAT_INTERVAL_MS);
	heartbeatTimer.unref?.();
	stopHeartbeat = () => clearInterval(heartbeatTimer);

	let result: WorkflowNodeExecutionResult;
	try {
		const context = await loadWorkflowNodeJobContext(env, executionId, nodeId, phase, { nodeRunId, attempt });
		const executorRef = resolveWorkflowNodeExecutorRef(context.node);
		const nodeData = context.node.data;
		const modelKey = resolveWorkflowNodeExecutionModelKey({
			executorRef,
			flowVersionData: context.flowVersionData,
			nodeData,
		});
		const toolName = executorRef === "agents.tool.invoke/v1" && typeof nodeData.workflowToolInvocationName === "string"
			? nodeData.workflowToolInvocationName
			: null;
		await updateNodeRun(env.DB, {
			executionId,
			nodeId,
			inputRefs: context.inputs,
			nodeType: executorRef ?? context.node.kind,
			toolName,
			modelKey,
		});
		const provenanceContext: WorkflowProvenanceContext = {
			executionId,
			nodeRunId: context.nodeRunId,
			attempt: context.nodeRunAttempt,
			flowId: context.flowId,
			flowVersionId: context.flowVersionId,
			nodeId,
			inputBindings: context.inputProvenance,
		};
		const cacheRequest = await createWorkflowPureCacheRequest({
			ownerId: context.ownerId,
			node: context.node,
			inputs: context.inputs,
			resumeOnly: context.resumeOnly,
		});
		const cacheHit = cacheRequest
			? await findWorkflowPureCacheHit(env.DB, context.ownerId, cacheRequest)
			: null;
		if (cacheRequest && cacheHit) {
			result = {
				ok: true,
				outputRefs: materializeWorkflowPureCacheHit({
					request: cacheRequest,
					hit: cacheHit,
					node: context.node,
				}),
			};
		} else {
			const pluginRuntimeRegistry = executorRef && hasWorkflowPluginExecutorRefPrefix(executorRef)
				? await loadPersistedWorkflowPluginRuntimeRegistry(
					env.DB,
					createTrustedWorkflowPluginOwnerAdapters(env),
				)
				: null;
			result = await executeRegisteredWorkflowNode(
				{
					executionId,
					...context,
					checkpointOutputRefs: async (outputRefs) => {
						const progressResponse = await stub.fetch("https://do/nodeProgress", {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: JSON.stringify({
									nodeId,
									nodeRunId,
									attempt,
									outputRefs: stampWorkflowNodeOutputProvenance({ outputRefs, context: provenanceContext }),
								}),
							});
						await requireSuccessfulDurableResponse(
							progressResponse,
							`Checkpointing workflow node ${nodeId} item progress`,
						);
						if (progressResponse.status === 208) {
							throw new Error(`Workflow node ${nodeId} attempt became stale while checkpointing progress`);
						}
					},
					abortSignal: activeJob.signal,
				},
				{
					...(pluginRuntimeRegistry ? { pluginRuntimeRegistry } : {}),
					runAgent: (request) => runWorkflowAgentNode(env, request),
					runJavascript: (request) => runLocalWorkflowJavascript(env, request),
					runImage: (request) => runWorkflowImageNode(env, request),
					runVideo: (request) => runWorkflowVideoNode(env, request),
					prepareVideoProductionAssets: (request) => prepareWorkflowVideoProductionAssets(env, request),
					readVoicePlanningFacts: (request) => readWorkflowVoicePlanningFacts(env, request),
					runVideoEstimate: (request) => estimateWorkflowVideo(env, request),
					resolveVideoDurationOptions: (request) => resolveModelDurationOptions({
						c: createWorkflowInternalContext(env, request),
						modelKey: request.modelKey,
					}),
					resolveVideoMediaOptions: (request) => resolveModelMediaOptions({
						c: createWorkflowInternalContext(env, request),
						modelKey: request.modelKey,
					}),
					runVideoConcat: (request) => concatWorkflowVideos(env, request),
					projectWorkflowFilm: (request) => projectWorkflowFilmToCanvas(env, request),
					readCanvasGroup: (request) => readWorkflowCanvasGroup(request),
					readCanvasGroupFromFlow: async (request) => {
						const internalContext = createWorkflowInternalContext(env, {
							executionId,
							runtimeNodeId: nodeId,
							ownerId: request.ownerId,
						});
						const row = await freshReadFlowRow({
							c: internalContext,
							flowId: request.flowId,
							requestUserId: request.ownerId,
							devBypass: false,
							...(request.chapterId ? { chapterId: request.chapterId } : {}),
						});
						return readWorkflowCanvasGroupFromFlowData({
							flowId: request.flowId,
							groupId: request.groupId,
							rowData: row.data,
						});
					},
					readCanvasProjectContextFromFlow: async (request) => {
						const internalContext = createWorkflowInternalContext(env, {
							executionId,
							runtimeNodeId: nodeId,
							ownerId: request.ownerId,
						});
						const row = await freshReadFlowRow({
							c: internalContext,
							flowId: request.flowId,
							requestUserId: request.ownerId,
							devBypass: false,
							...(request.chapterId ? { chapterId: request.chapterId } : {}),
						});
						return readWorkflowCanvasProjectContextFromFlowData({
							flowId: request.flowId,
							rowData: row.data,
							projectContext: request.projectContext,
						});
					},
					searchKnowledge: (request) => searchWorkflowKnowledge(env, request),
					readKnowledge: (request) => readWorkflowKnowledge(env, request),
					invokeTool: (request) => invokeWorkflowTool(env, request),
					runSubworkflow: (request) => runWorkflowSubworkflow(env, request),
					resolveProjectAsset: async (request) => {
						const internalContext = createWorkflowInternalContext(env, {
							executionId,
							runtimeNodeId: nodeId,
							ownerId: request.ownerId,
						});
						const resolver = createRuntimeWorkflowAssetResolver({
							c: internalContext,
							ownerId: request.ownerId,
							context: request.projectContext,
						});
						const resolved = await resolver.resolveAssetResource(request.assetId, request.preferredKind);
						await env.DB.workflow_executions.update({
							where: { id: executionId },
							data: { uses_project_assets: true },
						});
						return resolved;
					},
				},
			);
			if (result.ok && cacheRequest) {
				if (!context.nodeRunId) {
					throw new Error(`Workflow node ${nodeId} pure cache requires a durable node run identity`);
				}
				result = {
					ok: true,
					outputRefs: recordWorkflowPureCacheStore({
						request: cacheRequest,
						outputRefs: result.outputRefs,
						executionId,
						nodeRunId: context.nodeRunId,
					}),
				};
			}
		}
		result = stampWorkflowNodeResultProvenance(result, provenanceContext);
		if (toolName) {
			await updateNodeRun(env.DB, {
				executionId,
				nodeId,
				toolCalls: [{ toolName, ok: result.ok }],
			});
		}
	} catch (error: unknown) {
		result = runtimeFailure(error);
	}

	if (!result.ok && result.waitingExternal === true) {
		const persistedOutputRefs: WorkflowNodeOutputV1 = {
			...result.outputRefs,
			externalCheck: result.externalCheck,
		};
		const waitingResponse = await stub.fetch("https://do/nodeWaiting", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ nodeId, nodeRunId, attempt, outputRefs: persistedOutputRefs, fromExternalCheck: phase === "await_external" }),
			});
		await requireSuccessfulDurableResponse(
			waitingResponse,
			`Persisting workflow node ${nodeId} external wait receipt`,
		);
		if (waitingResponse.status === 208) return;
		const queue = env.WORKFLOW_NODE_QUEUE;
		if (!queue) throw new Error("WORKFLOW_NODE_QUEUE binding missing");
		const delaySeconds = workflowExternalCheckDelaySeconds(result.externalCheck);
		if (delaySeconds !== null) {
			await queue.send({ ...job, phase: "await_external" }, { delaySeconds });
		}
		return;
	}

	const completionResponse = await stub.fetch("https://do/nodeComplete", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				nodeId,
				nodeRunId,
				attempt,
				ok: result.ok,
				...(result.ok
					? { outputRefs: result.outputRefs }
					: {
							errorCode: result.errorCode,
							errorMessage: result.errorMessage,
							...(result.outputRefs ? { outputRefs: result.outputRefs } : {}),
						}),
			}),
		});
	await requireSuccessfulDurableResponse(
		completionResponse,
		`Completing workflow node ${nodeId}`,
	);
	if (completionResponse.status === 208) return;
	try {
		await refreshWorkflowFamilyCanvasProjection({ env, executionId, runtimeNodeId: nodeId });
	} catch (error: unknown) {
		console.error(JSON.stringify({
			message: "workflow_execution_family_projection_refresh_failed",
			executionId,
			nodeId,
			error: error instanceof Error ? error.message : String(error),
		}));
	}
	if (completionResponse.status === 202 && !result.ok) return;
	if (!result.ok) {
		const abortedJobs = abortActiveWorkflowNodeJobs(
			executionId,
			new Error(`workflow_execution_failed_at_node:${nodeId}`),
		);
		if (abortedJobs > 0) {
			console.info(JSON.stringify({
				message: "workflow_execution_terminal_failure_jobs_aborted",
				executionId,
				nodeId,
				abortedJobs,
			}));
		}
		// 节点失败（含 checkpoint 409 等 DO 拒绝回传的路径）：主动剥离该执行的
		// fan-out 中间产物，防 flow 主表污染。DO 的 handleNodeComplete 失败分支
		// 只在 nodeRun.status==running 时可达；waiting_external 恢复中的失败回传
		// 会被 DO 以 409 拒绝，因此这里必须兜底触发。
		try {
			const executionRow = await env.DB.workflow_executions.findUnique({
				where: { id: executionId },
				select: { flow_id: true, owner_id: true },
			});
			if (executionRow) {
				await stripWorkflowFanoutNodes({
					executionId,
					flowId: executionRow.flow_id,
					ownerId: executionRow.owner_id,
					nowIso: new Date().toISOString(),
				});
			}
		} catch {
			// 清理失败不阻塞节点收尾；终态剥离由 DO 分支或幂等重试兜底。
		}
		try {
			await continueRepairableWorkflowFamily({ env, executionId, nodeId });
		} catch (error: unknown) {
			console.error(JSON.stringify({
				message: "workflow_execution_automatic_recovery_dispatch_failed",
				executionId,
				nodeId,
				error: error instanceof Error ? error.message : String(error),
			}));
		}
	}
	} finally {
		stopHeartbeat?.();
		activeJob.release();
	}
}

export async function resumeWaitingWorkflowNodes(env: WorkerEnv): Promise<number> {
	const queue = env.WORKFLOW_NODE_QUEUE;
	if (!queue) throw new Error("WORKFLOW_NODE_QUEUE binding missing");
	const waitingRuns = await env.DB.workflow_node_runs.findMany({
		where: {
			status: "waiting_external",
			workflow_executions: { status: { in: ["running", "failed"] } },
		},
		select: { id: true, execution_id: true, node_id: true, attempt: true, output_refs: true },
	});
	let dispatched = 0;
	for (const run of waitingRuns) {
		const outputRefs = parseWorkflowNodeOutputV1(run.output_refs);
		const schedule = outputRefs?.externalCheck ?? null;
		if (schedule?.mode === "signal_only") continue;
		const job = {
			executionId: run.execution_id,
			nodeId: run.node_id,
			nodeRunId: run.id,
			attempt: run.attempt,
			phase: "await_external",
		} as const;
		if (!schedule) {
			// Existing durable receipts are reconciled once to obtain the mandatory
			// versioned schedule; absence never selects an arbitrary polling cadence.
			await queue.send(job);
		} else {
			const delaySeconds = workflowExternalCheckDelaySeconds(schedule);
			if (delaySeconds === null) continue;
			await queue.send(job, { delaySeconds });
		}
		dispatched += 1;
	}
	return dispatched;
}

/**
 * Replays only durable dispatch intents. `pending` nodes are not eligible here:
 * they have not yet been released by the authoritative DAG scheduler.
 */
export async function resumeQueuedWorkflowNodes(env: WorkerEnv): Promise<number> {
	const queue = env.WORKFLOW_NODE_QUEUE;
	if (!queue) throw new Error("WORKFLOW_NODE_QUEUE binding missing");
	const queuedRuns = await env.DB.workflow_node_runs.findMany({
		where: {
			status: "queued",
			workflow_executions: { status: "running" },
		},
		select: { id: true, execution_id: true, node_id: true, attempt: true },
	});
	for (const run of queuedRuns) {
		await queue.send({
			executionId: run.execution_id,
			nodeId: run.node_id,
			nodeRunId: run.id,
			attempt: run.attempt,
			...(run.attempt > 1 ? { phase: "recover" as const } : {}),
		});
	}
	return queuedRuns.length;
}

export function startPersistedWorkflowNodeReconciler(
	env: WorkerEnv,
	intervalMs = 15_000,
): () => void {
	const boundedIntervalMs = Math.max(5_000, Math.floor(intervalMs));
	let reconciling = false;
	const timer = setInterval(() => {
		if (reconciling) return;
		reconciling = true;
		void reconcileLocallyAbandonedWorkflowExecutions(env)
			.then(async (abandoned) => {
				const queuedNodes = await resumeQueuedWorkflowNodes(env);
				const waitingNodes = await resumeWaitingWorkflowNodes(env);
				if (abandoned.executions > 0 || queuedNodes > 0 || waitingNodes > 0) {
					console.info("[workflow-queue] reconciled durable workflow dispatches", {
						abandonedExecutions: abandoned.executions,
						recoverableNodes: abandoned.recoverableNodes,
						unsafeNodes: abandoned.unsafeNodes,
						queuedNodes,
						waitingNodes,
					});
				}
			})
			.catch((error: unknown) => {
				console.error("[workflow-queue] durable dispatch reconciliation failed", error);
			})
			.finally(() => {
				reconciling = false;
			});
	}, boundedIntervalMs);
	timer.unref?.();
	return () => clearInterval(timer);
}

type PersistedRecoverableExecution = Readonly<{
	id: string;
	flow_version_id: string;
	status: "running" | "failed";
}>;

type PersistedWorkflowNodeStatus = Readonly<{
	node_id: string;
	status: string;
}>;

type WorkflowRecoveryResult = Readonly<{
	recovered: boolean;
	recoverableNodes: number;
	unsafeNodes: number;
}>;

type WorkflowRecoveryContract =
	| Readonly<{ recoveryReason: "process_startup" }>
	| Readonly<{
			recoveryReason: "local_abandonment";
			ownershipStaleBefore: string;
		}>;

const LOCAL_WORKFLOW_ABANDONMENT_GRACE_MS = 60_000;

type LocalWorkflowAbandonmentOptions = Readonly<{
	nowMs?: number;
	abandonmentGraceMs?: number;
}>;

async function hasRecentWorkflowNodeOwnershipEvent(
	env: WorkerEnv,
	executionId: string,
	runningNodeIds: readonly string[],
	options: LocalWorkflowAbandonmentOptions,
): Promise<boolean> {
	if (runningNodeIds.length === 0) return false;
	const latestOwnershipEvent = await env.DB.workflow_execution_events.findFirst({
		where: {
			execution_id: executionId,
			node_id: { in: [...runningNodeIds] },
			event_type: {
				in: ["node_started", "node_recovery_started", "node_external_check_started", "node_heartbeat"],
			},
		},
		select: { created_at: true },
		orderBy: [{ created_at: "desc" }, { seq: "desc" }],
	});
	if (!latestOwnershipEvent) return false;
	const ownershipStartedAtMs = Date.parse(latestOwnershipEvent.created_at);
	if (!Number.isFinite(ownershipStartedAtMs)) {
		throw new Error(
			`Workflow execution ${executionId} has an invalid ownership event timestamp`,
		);
	}
	const nowMs = options.nowMs ?? Date.now();
	const abandonmentGraceMs = options.abandonmentGraceMs
		?? LOCAL_WORKFLOW_ABANDONMENT_GRACE_MS;
	return nowMs - ownershipStartedAtMs < abandonmentGraceMs;
}

async function recoverPersistedWorkflowExecution(
	env: WorkerEnv,
	execution: PersistedRecoverableExecution,
	nodeRuns: readonly PersistedWorkflowNodeStatus[],
	recoveryContract: WorkflowRecoveryContract,
): Promise<WorkflowRecoveryResult> {
	const namespace = env.EXECUTION_DO;
	if (!namespace) throw new Error("EXECUTION_DO binding missing");
	const hasPersistedWork = nodeRuns.some((run) => (
		run.status === "pending"
		|| run.status === "running"
		|| run.status === "waiting_external"
		|| run.status === "queued"
	));
	if (execution.status === "failed" && !hasPersistedWork) {
		return { recovered: false, recoverableNodes: 0, unsafeNodes: 0 };
	}
	const flowVersion = await env.DB.flow_versions.findUnique({
		where: { id: execution.flow_version_id },
		select: { data: true },
	});
	if (!flowVersion?.data) {
		throw new Error(`Interrupted workflow execution ${execution.id} has no immutable flow version data`);
	}
	const runningNodeIds = nodeRuns
		.filter((run) => run.status === "running")
		.map((run) => run.node_id);
	const recoverableNodeIds: string[] = [];
	const unsafeNodeIds: string[] = [];
	for (const nodeId of runningNodeIds) {
		const policy = resolveWorkflowNodeRestartPolicy(flowVersion.data, nodeId);
		if (policy === "fail_explicitly") unsafeNodeIds.push(nodeId);
		else recoverableNodeIds.push(nodeId);
	}
	const stub = namespace.get(namespace.idFromName(execution.id));
	const response = await stub.fetch("https://do/recoverAfterRestart", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ recoverableNodeIds, unsafeNodeIds, ...recoveryContract }),
	});
	await requireSuccessfulDurableResponse(response, `Recovering interrupted workflow execution ${execution.id}`);
	if (response.status === 208) {
		return { recovered: false, recoverableNodes: 0, unsafeNodes: 0 };
	}
	return {
		recovered: true,
		recoverableNodes: recoverableNodeIds.length,
		unsafeNodes: unsafeNodeIds.length,
	};
}

/**
 * Repairs a persisted `running` execution after its exact in-process executor
 * has disappeared without a terminal callback (for example, after a transient
 * database disconnect in the queue driver). Active executions are fenced by
 * the local executor registry; restart recovery remains the authority for a
 * new process, where that registry is intentionally empty.
 */
export async function reconcileLocallyAbandonedWorkflowExecutions(
	env: WorkerEnv,
	activeExecutionIds: ReadonlySet<string> | ((executionId: string) => boolean) =
		(executionId) => activeWorkflowJobs.has(executionId),
	options: LocalWorkflowAbandonmentOptions = {},
): Promise<Readonly<{
	executions: number;
	recoverableNodes: number;
	unsafeNodes: number;
}>> {
	const reconciliationNowMs = options.nowMs ?? Date.now();
	const abandonmentGraceMs = options.abandonmentGraceMs
		?? LOCAL_WORKFLOW_ABANDONMENT_GRACE_MS;
	const ownershipStaleBefore = new Date(
		reconciliationNowMs - abandonmentGraceMs,
	).toISOString();
	const executions = await env.DB.workflow_executions.findMany({
		where: { status: "running" },
		select: { id: true, flow_version_id: true, status: true },
	});
	let recoveredExecutions = 0;
	let recoverableNodes = 0;
	let unsafeNodes = 0;
	for (const execution of executions) {
		// Do not snapshot the process-local registry at reconciliation start. A
		// waiting_external job can become active while the database scan is in
		// progress; a stale snapshot would then misclassify that live poll as a
		// process restart, increment its attempt and fence its eventual result.
		const executionIsActive = typeof activeExecutionIds === "function"
			? activeExecutionIds(execution.id)
			: activeExecutionIds.has(execution.id);
		if (executionIsActive) continue;
		const nodeRuns = await env.DB.workflow_node_runs.findMany({
			where: { execution_id: execution.id },
			select: { node_id: true, status: true },
		});
		const runningNodeIds = nodeRuns
			.filter((run) => run.status === "running")
			.map((run) => run.node_id);
		if (runningNodeIds.length === 0) continue;
		// Ownership can be acquired while the persisted status query is in flight.
		// Recheck both the process-local driver and the append-only durable start
		// event before classifying a running node as abandoned. Startup recovery
		// remains immediate because it runs through recoverInterruptedWorkflowExecutions
		// before the API accepts any new work.
		if (typeof activeExecutionIds === "function"
			? activeExecutionIds(execution.id)
			: activeExecutionIds.has(execution.id)) continue;
		if (await hasRecentWorkflowNodeOwnershipEvent(
			env,
			execution.id,
			runningNodeIds,
			{
				nowMs: reconciliationNowMs,
				abandonmentGraceMs,
			},
		)) continue;
		if (typeof activeExecutionIds === "function"
			? activeExecutionIds(execution.id)
			: activeExecutionIds.has(execution.id)) continue;
		const recovery = await recoverPersistedWorkflowExecution(
			env,
			{ ...execution, status: "running" },
			nodeRuns,
			{ recoveryReason: "local_abandonment", ownershipStaleBefore },
		);
		if (!recovery.recovered) continue;
		recoveredExecutions += 1;
		recoverableNodes += recovery.recoverableNodes;
		unsafeNodes += recovery.unsafeNodes;
	}
	return { executions: recoveredExecutions, recoverableNodes, unsafeNodes };
}

export async function recoverInterruptedWorkflowExecutions(env: WorkerEnv): Promise<Readonly<{
	executions: number;
	recoverableNodes: number;
	unsafeNodes: number;
}>> {
	const namespace = env.EXECUTION_DO;
	if (!namespace) throw new Error("EXECUTION_DO binding missing");
	const executions = await env.DB.workflow_executions.findMany({
		where: { status: { in: ["queued", "running", "failed"] } },
		select: { id: true, flow_version_id: true, status: true },
	});
	let recoveredExecutions = 0;
	let recoverableNodes = 0;
	let unsafeNodes = 0;
	for (const execution of executions) {
		if (execution.status === "queued") {
			const stub = namespace.get(namespace.idFromName(execution.id));
			const response = await stub.fetch("https://do/start", { method: "POST" });
			await requireSuccessfulDurableResponse(response, `Starting persisted queued workflow execution ${execution.id}`);
			recoveredExecutions += 1;
			continue;
		}
		const nodeRuns = await env.DB.workflow_node_runs.findMany({
			where: { execution_id: execution.id },
			select: { node_id: true, status: true },
		});
		const recovery = await recoverPersistedWorkflowExecution(
			env,
			{
				id: execution.id,
				flow_version_id: execution.flow_version_id,
				status: execution.status === "failed" ? "failed" : "running",
			},
			nodeRuns,
			{ recoveryReason: "process_startup" },
		);
		if (!recovery.recovered) continue;
		recoveredExecutions += 1;
		recoverableNodes += recovery.recoverableNodes;
		unsafeNodes += recovery.unsafeNodes;
	}
	return { executions: recoveredExecutions, recoverableNodes, unsafeNodes };
}
