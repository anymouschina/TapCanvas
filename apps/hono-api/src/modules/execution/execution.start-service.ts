import { Prisma } from "@prisma/client";
import {
	WORKFLOW_CONCURRENCY_MAX,
	WORKFLOW_CONCURRENCY_MIN,
} from "@tapcanvas/workflow-kernel-protocol";
import type { WorkerEnv } from "../../types";
import type { FlowRow } from "../flow/flow.repo";
import { createFlowVersion } from "../flow/flow.repo";
import {
	createExecution,
	getExecutionById,
	mapExecutionRow,
	updateExecutionStatus,
} from "./execution.repo";
import { scopeWorkflowFlowData } from "./execution.flow-scope";
import { inspectWorkflowExecutionSupport } from "./execution.node-runtime";
import { compileWorkflowGraph } from "./execution.recovery";
import type { WorkflowExecutionDto } from "./execution.schemas";
import {
	createWorkflowOutputReuseRepository,
	prepareWorkflowOutputReuse,
} from "./execution.output-reuse";
import type { WorkflowCallerCanvasSnapshot, WorkflowProjectContext } from "./execution.project-context";
import type { WorkflowInitiatingAgentExecution } from "./execution.agent-model-inheritance";
import { listAdmittedWorkflowPluginCatalogRegistrations } from "./execution.plugin-catalog";
import {
	freezeWorkflowExecutionSemanticsSnapshot,
	workflowRequiresPluginSemantics,
} from "./execution.semantics-snapshot";
import { materializeWorkflowConfigurationInheritance } from "./execution.workflow-configuration";
import {
	createVideoWorkflowDefinitionAuthority,
	inspectVideoWorkflowCanvasDefinition,
} from "./execution.video-workflow-definition-authority";
import {
	materializeWorkflowExecutionControl,
	type WorkflowExecutionControlAdmissionV2,
} from "./execution.production-start-deadline";
import {
	resolveWorkflowExecutionRecoveryPolicy,
	WorkflowExecutionRecoveryPolicyError,
} from "./execution.recovery-policy";

export type WorkflowStartFailureCode =
	| "workflow_flow_invalid"
	| "workflow_definition_outdated"
	| "workflow_output_required"
	| "workflow_node_prompt_not_ready"
	| "workflow_node_kind_missing"
	| "workflow_node_executor_missing"
	| "workflow_output_reuse_invalid"
	| "workflow_runtime_unavailable"
	| "workflow_agent_execution_invalid"
	| "workflow_execution_projection_failed"
	| "workflow_start_failed";

export class WorkflowStartError extends Error {
	constructor(
		message: string,
		public readonly code: WorkflowStartFailureCode,
		public readonly status: 400 | 409 | 422 | 500 | 501 | 503,
		public readonly details?: Readonly<Record<string, unknown>>,
	) {
		super(message);
		this.name = "WorkflowStartError";
	}
}

export type StartWorkflowExecutionInput = Readonly<{
	flow: FlowRow;
	ownerId: string;
	triggerNodeId: string;
	stopAfterNodeId?: string;
	replay?: Readonly<{
		sourceExecutionId: string;
		startFromNodeId: string;
		invalidatedNodeIds?: readonly string[];
		scope?: "ancestors" | "recovery_snapshot";
	}>;
	trigger: string;
	concurrency?: number;
	idempotencyKey?: string;
	triggerPayload?: unknown;
	workflowAncestry?: readonly string[];
	/**
	 * 系统级共享工作流的交付目标：媒体节点（参考图 / 逐镜视频 / 最终成片）
	 * 写回调用者当前对话所在的项目画布，而不是工作流自身项目。缺省时保持
	 * 旧行为（写入工作流所在 flow）。flowId 必须属于 ownerId，媒体 runner
	 * 的 getFlowForOwner 会做最终校验。
	 */
	delivery?: Readonly<{
		flowId: string;
		projectId: string | null;
		chapterId?: string | null;
	}>;
	/** Frozen caller canvas/project facts. Equipped workflows must build this per invocation. */
	projectContext?: WorkflowProjectContext;
	/** Immutable caller project/chapter canvas shown by execution history. */
	callerCanvasSnapshot?: WorkflowCallerCanvasSnapshot;
	/** Actual parent Agent execution identity for model inheritance. */
	initiatingAgentExecution?: WorkflowInitiatingAgentExecution;
	/** Frozen runtime control facts derived from the public request admission. */
	executionControl?: WorkflowExecutionControlAdmissionV2;
	recoveryOfExecutionId?: string;
	recoveryAdmission?: "failed_source" | "cancellation_revocation";
	/**
	 * Optional admission projection. When provided, it must finish after the durable execution row
	 * exists and before the scheduler is dispatched, so the caller canvas never observes a running
	 * workflow without its accepted-execution node.
	 */
	materializeAcceptedExecution?: (execution: WorkflowExecutionDto) => Promise<void>;
	now?: Date;
}>;

export type StartWorkflowExecutionResult = Readonly<{
	created: boolean;
	execution: WorkflowExecutionDto;
}>;

function isPrismaUniqueConstraint(error: unknown): boolean {
	return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function workflowRecoveryAdmissionReason(error: unknown): string | null {
	if (!(error instanceof Error) || error.name !== "WorkflowRecoveryAdmissionError") return null;
	if (!("reason" in error) || typeof error.reason !== "string" || !error.reason.trim()) return null;
	return error.reason;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveAuthoredExecutionConcurrency(
	flowData: Readonly<Record<string, unknown>>,
	triggerNodeId: string,
): number | undefined {
	const nodes = Array.isArray(flowData.nodes) ? flowData.nodes : [];
	const triggerNode = nodes.find((candidate) => {
		if (!isRecord(candidate)) return false;
		return candidate.id === triggerNodeId;
	});
	if (!isRecord(triggerNode) || !isRecord(triggerNode.data)) return undefined;
	const value = triggerNode.data.workflowExecutionConcurrency;
	if (value === undefined) return undefined;
	if (
		typeof value !== "number"
		|| !Number.isInteger(value)
		|| value < WORKFLOW_CONCURRENCY_MIN
		|| value > WORKFLOW_CONCURRENCY_MAX
	) {
		throw new WorkflowStartError(
			`workflowExecutionConcurrency must be an integer between ${WORKFLOW_CONCURRENCY_MIN} and ${WORKFLOW_CONCURRENCY_MAX}`,
			"workflow_flow_invalid",
			400,
			{ triggerNodeId, workflowExecutionConcurrency: value },
		);
	}
	return value;
}

function readPayloadString(payload: Record<string, unknown>, field: string): string {
	const value = payload[field];
	return typeof value === "string" ? value.trim() : "";
}

function workflowUserInput(payload: unknown): string | null {
	if (!isRecord(payload)) return null;
	const source = readPayloadString(payload, "source");
	if (source) return source;
	try {
		return JSON.stringify(payload);
	} catch {
		return null;
	}
}

function executionUsesProjectAssets(
	projectContext: WorkflowProjectContext | undefined,
	triggerPayload: unknown,
): boolean {
	if (projectContext?.selectedAssetIds.some((assetId) => assetId.trim().length > 0)) return true;
	if (!isRecord(triggerPayload) || !Array.isArray(triggerPayload.selectedAssetIds)) return false;
	return triggerPayload.selectedAssetIds.some(
		(assetId) => typeof assetId === "string" && assetId.trim().length > 0,
	);
}

/**
 * 按次媒体参数覆盖（对话动态指定）：triggerPayload 可携带
 * videoModelKey / imageModelKey / resolution / aspectRatio / imageSize
 * （如“竖版 9:16、1080p；图片 2K”）。只覆盖按 executorRef 识别的
 * 媒体节点，不触碰其它节点。
 * 注入发生在不可变执行快照冻结时，对全部共享工作流通用，不做语义判断。
 */
function applyWorkflowTriggerMediaOverrides(
	flowData: Record<string, unknown>,
	payload: unknown,
): void {
	if (!isRecord(payload)) return;
	const videoModelKey = readPayloadString(payload, "videoModelKey");
	const imageModelKey = readPayloadString(payload, "imageModelKey");
	const videoResolution = readPayloadString(payload, "videoResolution");
	const videoAspectRatio = readPayloadString(payload, "videoAspectRatio");
	const imageAspectRatio = readPayloadString(payload, "imageAspectRatio");
	const imageSize = readPayloadString(payload, "imageSize");
	if (!videoModelKey && !imageModelKey && !videoResolution && !videoAspectRatio && !imageAspectRatio && !imageSize) return;
	const nodes = Array.isArray(flowData.nodes) ? flowData.nodes : [];
	flowData.nodes = nodes.map((rawNode) => {
		if (!isRecord(rawNode)) return rawNode;
		const nodeData = isRecord(rawNode.data) ? rawNode.data : null;
		if (!nodeData) return rawNode;
		const spec = isRecord(nodeData.workflowAtomicSpec) ? nodeData.workflowAtomicSpec : null;
		const executorRef = typeof spec?.executorRef === "string" ? spec.executorRef : "";
		if (executorRef === "tapcanvas.image.generate/v1") {
			const nextData = { ...nodeData };
			if (imageModelKey) nextData.workflowImageModelKey = imageModelKey;
			if (imageAspectRatio) nextData.workflowImageAspectRatio = imageAspectRatio;
			if (imageSize) nextData.workflowImageSize = imageSize;
			return { ...rawNode, data: nextData };
		}
		if (executorRef !== "agents.delivery.contract/v2"
			&& executorRef !== "video.estimate/v1"
			&& executorRef !== "tapcanvas.video.generate/v1") {
			return rawNode;
		}
		const nextData = { ...nodeData };
		if (videoModelKey) nextData.workflowVideoModelKey = videoModelKey;
		if (executorRef !== "agents.delivery.contract/v2") {
			if (videoResolution) nextData.workflowVideoResolution = videoResolution;
			if (videoAspectRatio) nextData.workflowVideoAspectRatio = videoAspectRatio;
		}
		return { ...rawNode, data: nextData };
	});
}

function applyWorkflowAuthoredConfigurationInheritance(flowData: Record<string, unknown>): void {
	const nodes = Array.isArray(flowData.nodes) ? flowData.nodes : [];
	try {
		flowData.nodes = materializeWorkflowConfigurationInheritance(nodes);
	} catch (error: unknown) {
		throw new WorkflowStartError(
			error instanceof Error ? error.message : "Workflow configuration inheritance is invalid",
			"workflow_flow_invalid",
			400,
		);
	}
}

function assertFrozenVideoEstimateConfiguration(flowData: Record<string, unknown>): void {
	const nodes = Array.isArray(flowData.nodes) ? flowData.nodes : [];
	for (const rawNode of nodes) {
		if (!isRecord(rawNode) || !isRecord(rawNode.data)) continue;
		const spec = isRecord(rawNode.data.workflowAtomicSpec) ? rawNode.data.workflowAtomicSpec : null;
		if (spec?.executorRef !== "video.estimate/v1") continue;
		const modelKey = readPayloadString(rawNode.data, "workflowVideoModelKey");
		const resolution = readPayloadString(rawNode.data, "workflowVideoResolution");
		const aspectRatio = readPayloadString(rawNode.data, "workflowVideoAspectRatio");
		if (modelKey && resolution && aspectRatio) continue;
		const nodeId = typeof rawNode.id === "string" && rawNode.id.trim() ? rawNode.id.trim() : "unknown";
		const missingFields = [
			!modelKey ? "videoModelKey" : null,
			!resolution ? "videoResolution" : null,
			!aspectRatio ? "videoAspectRatio" : null,
		].filter((value): value is string => value !== null);
		throw new WorkflowStartError(
			`Video estimate node ${nodeId} requires explicit live-catalog media configuration`,
			"workflow_flow_invalid",
			400,
			{ nodeId, missingTriggerPayloadFields: missingFields },
		);
	}
}

async function stableIdentity(prefix: string, identity: string): Promise<string> {
	const bytes = new TextEncoder().encode(identity);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
	return `${prefix}-${hex.slice(0, 40)}`;
}

function requireExecutableFlow(raw: unknown, triggerNodeId: string, stopAfterNodeId?: string): Record<string, unknown> {
	let scopedFlowData: Record<string, unknown>;
	try {
		scopedFlowData = scopeWorkflowFlowData(raw, triggerNodeId, stopAfterNodeId);
	} catch (error: unknown) {
		throw new WorkflowStartError(
			error instanceof Error ? error.message : "Workflow flow data is invalid",
			"workflow_flow_invalid",
			400,
		);
	}
	const support = inspectWorkflowExecutionSupport(scopedFlowData);
	if (!stopAfterNodeId && !support.hasWorkflowOutput) {
		throw new WorkflowStartError(
			"Workflow requires at least one workflowOutput node",
			"workflow_output_required",
			400,
		);
	}
	const promptNotReadyNodes = support.unsupportedNodes.filter((node) => node.reason === "prompt_not_ready");
	if (promptNotReadyNodes.length > 0) {
		throw new WorkflowStartError(
			"Workflow contains nodes whose prompts are not ready",
			"workflow_node_prompt_not_ready",
			409,
			{ nodes: promptNotReadyNodes },
		);
	}
	const missingKindNodes = support.unsupportedNodes.filter((node) => node.reason === "kind_missing");
	if (missingKindNodes.length > 0) {
		throw new WorkflowStartError(
			"Workflow contains task nodes without an executable kind",
			"workflow_node_kind_missing",
			422,
			{ nodes: missingKindNodes },
		);
	}
	const missingExecutorNodes = support.unsupportedNodes.filter((node) => node.reason === "executor_not_registered");
	if (missingExecutorNodes.length > 0) {
		throw new WorkflowStartError(
			"Workflow contains nodes without a registered server executor; execution was not created",
			"workflow_node_executor_missing",
			501,
			{ nodes: missingExecutorNodes },
		);
	}
	try {
		compileWorkflowGraph(scopedFlowData);
	} catch (error: unknown) {
		throw new WorkflowStartError(
			error instanceof Error ? error.message : "Workflow graph contract is invalid",
			"workflow_flow_invalid",
			400,
		);
	}
	return scopedFlowData;
}

async function startDurableExecution(env: WorkerEnv, executionId: string): Promise<void> {
	const namespace = env.EXECUTION_DO;
	if (!namespace) {
		throw new WorkflowStartError(
			"Workflow execution runtime bindings are unavailable",
			"workflow_runtime_unavailable",
			503,
		);
	}
	try {
		const stub = namespace.get(namespace.idFromName(executionId));
		const response = await stub.fetch("https://do/start", { method: "POST" });
		if (!response.ok) {
			const detail = (await response.text().catch(() => "")).trim();
			throw new Error(
				`Workflow scheduler rejected start with HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
			);
		}
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : "Failed to start execution";
		await updateExecutionStatus(env.DB, {
			executionId,
			status: "failed",
			errorMessage: message,
			finishedAt: new Date().toISOString(),
		});
		throw new WorkflowStartError(message, "workflow_start_failed", 500);
	}
}

async function materializeAcceptedExecution(
	input: StartWorkflowExecutionInput,
	execution: WorkflowExecutionDto,
): Promise<void> {
	if (!input.materializeAcceptedExecution) return;
	try {
		await input.materializeAcceptedExecution(execution);
	} catch (error: unknown) {
		throw new WorkflowStartError(
			"Workflow execution was accepted but its caller-canvas node could not be persisted",
			"workflow_execution_projection_failed",
			503,
			{
				executionId: execution.id,
				cause: error instanceof Error ? error.message : String(error),
			},
		);
	}
}

export async function startWorkflowExecution(
	env: WorkerEnv,
	input: StartWorkflowExecutionInput,
): Promise<StartWorkflowExecutionResult> {
	if (!env.EXECUTION_DO || !env.WORKFLOW_NODE_QUEUE) {
		throw new WorkflowStartError(
			"Workflow execution runtime bindings are unavailable",
			"workflow_runtime_unavailable",
			503,
		);
	}
	let videoDefinitionState: ReturnType<typeof inspectVideoWorkflowCanvasDefinition>;
	try {
		videoDefinitionState = inspectVideoWorkflowCanvasDefinition(input.flow.data);
	} catch (error: unknown) {
		throw new WorkflowStartError(
			error instanceof Error ? error.message : "Workflow definition provenance is invalid",
			"workflow_flow_invalid",
			400,
		);
	}
	if (videoDefinitionState.applicable && !videoDefinitionState.current) {
		throw new WorkflowStartError(
			"One-click production workflow definition is not the current executable contract",
			"workflow_definition_outdated",
			409,
			videoDefinitionState,
		);
	}
	const executableFlowData = requireExecutableFlow(input.flow.data, input.triggerNodeId, input.stopAfterNodeId);
	let recoveryPolicy: ReturnType<typeof resolveWorkflowExecutionRecoveryPolicy>;
	try {
		recoveryPolicy = resolveWorkflowExecutionRecoveryPolicy(executableFlowData, input.triggerNodeId);
	} catch (error: unknown) {
		if (!(error instanceof WorkflowExecutionRecoveryPolicyError)) throw error;
		throw new WorkflowStartError(error.message, "workflow_flow_invalid", 400, error.details);
	}
	if (input.recoveryOfExecutionId && recoveryPolicy === "fresh_only") {
		throw new WorkflowStartError(
			"This workflow requires a fresh execution and cannot recover or resume an earlier execution",
			"workflow_start_failed",
			409,
			{
				triggerNodeId: input.triggerNodeId,
				workflowExecutionRecoveryPolicy: recoveryPolicy,
				recoveryOfExecutionId: input.recoveryOfExecutionId,
			},
		);
	}
	const definitionAuthority = createVideoWorkflowDefinitionAuthority(videoDefinitionState);
	if (definitionAuthority) {
		executableFlowData.workflowDefinitionAuthority = definitionAuthority;
	}
	// Variant branches inherit media configuration from one authored source node.
	// Resolve that relation before applying any explicit per-run override so the
	// immutable execution snapshot always contains a complete, auditable config.
	applyWorkflowAuthoredConfigurationInheritance(executableFlowData);
	if (input.triggerPayload !== undefined) {
		const nodes = Array.isArray(executableFlowData.nodes) ? executableFlowData.nodes : [];
		executableFlowData.nodes = nodes.map((rawNode) => {
			if (!rawNode || typeof rawNode !== "object" || Array.isArray(rawNode)) return rawNode;
			const node = rawNode as Record<string, unknown>;
			if (node.id !== input.triggerNodeId || !node.data || typeof node.data !== "object" || Array.isArray(node.data)) return rawNode;
			return {
				...node,
				data: { ...(node.data as Record<string, unknown>), workflowTriggerPayload: input.triggerPayload },
			};
		});
		// 按次媒体参数注入：对话可动态指定模型/分辨率/比例（如“竖版 9:16 发抖音”），
		// 随执行快照冻结到对应媒体 executor 节点，不要求小T改工作流或重新装配。
		applyWorkflowTriggerMediaOverrides(executableFlowData, input.triggerPayload);
	}
	assertFrozenVideoEstimateConfiguration(executableFlowData);
	if (input.workflowAncestry) {
		executableFlowData.workflowExecutionAncestry = [...new Set(input.workflowAncestry)];
	}
	if (input.projectContext) {
		// ProjectContext is a run fact, not workflow template configuration. It is frozen
		// into the immutable flow version so every node and recovery sees the same view.
		executableFlowData.workflowProjectContext = input.projectContext;
	}
	if (input.callerCanvasSnapshot) {
		executableFlowData.workflowCallerCanvasSnapshot = input.callerCanvasSnapshot;
	}
	if (input.initiatingAgentExecution) {
		if (input.trigger !== "agent") {
			throw new WorkflowStartError(
				"Only agent-triggered workflows may freeze an initiating Agent execution",
				"workflow_agent_execution_invalid",
				400,
			);
		}
		executableFlowData.workflowInitiatingAgentExecution = {
			model: input.initiatingAgentExecution.model,
			apiStyle: input.initiatingAgentExecution.apiStyle,
		};
	}
	if (input.delivery) {
		// 交付目标随执行快照冻结，与 triggerPayload 一样进入不可变 flow version；
		// 执行期媒体节点据此写回调用者画布，工作流自身项目保持模板态。
		// 交付目标等于工作流自身 flow 时是 no-op，不注入（保持旧行为语义一致）。
		if (input.delivery.flowId.trim() !== input.flow.id.trim()) {
			executableFlowData.workflowDeliveryScope = {
				flowId: input.delivery.flowId,
				projectId: input.delivery.projectId ?? null,
				...(input.delivery.chapterId ? { chapterId: input.delivery.chapterId } : {}),
			};
		}
	}
	let scopedFlowData: Record<string, unknown>;
	try {
		scopedFlowData = await prepareWorkflowOutputReuse({
			flowData: executableFlowData,
			flowId: input.flow.id,
			ownerId: input.ownerId,
			...(input.replay ? { replay: input.replay } : {}),
			repository: createWorkflowOutputReuseRepository(env.DB),
		});
	} catch (error: unknown) {
		throw new WorkflowStartError(
			error instanceof Error ? error.message : "Workflow output reuse contract is invalid",
			"workflow_output_reuse_invalid",
			409,
		);
	}
	try {
		const pluginRegistrations = workflowRequiresPluginSemantics(scopedFlowData)
			? await listAdmittedWorkflowPluginCatalogRegistrations(env.DB)
			: [];
		scopedFlowData = freezeWorkflowExecutionSemanticsSnapshot(scopedFlowData, pluginRegistrations);
	} catch (error: unknown) {
		throw new WorkflowStartError(
			error instanceof Error ? error.message : "Workflow execution semantics cannot be frozen",
			"workflow_flow_invalid",
			400,
		);
	}
	// This timestamp is both the durable execution row's created_at and the
	// provider-start SLA anchor. Materialize the absolute deadline only here,
	// after all admission/preparation work, so pre-execution chat or context
	// collection time cannot consume the workflow's five-minute window.
	const nowIso = (input.now ?? new Date()).toISOString();
	if (input.executionControl) {
		try {
			scopedFlowData.workflowExecutionControl = materializeWorkflowExecutionControl(
				scopedFlowData,
				input.executionControl,
				nowIso,
			);
		} catch (error: unknown) {
			throw new WorkflowStartError(
				error instanceof Error ? error.message : "Workflow execution control is invalid",
				"workflow_flow_invalid",
				400,
			);
		}
	}
	const authoredConcurrency = resolveAuthoredExecutionConcurrency(scopedFlowData, input.triggerNodeId);
	const concurrency = Math.max(
		WORKFLOW_CONCURRENCY_MIN,
		Math.min(
			WORKFLOW_CONCURRENCY_MAX,
			Math.floor(input.concurrency ?? authoredConcurrency ?? WORKFLOW_CONCURRENCY_MIN),
		),
	);
	const identity = input.idempotencyKey?.trim();
	const contextIdentity = input.projectContext
		? `${input.projectContext.projectId}:${input.projectContext.canvasId}`
		: "no-project-context";
	const executionId = identity
		? await stableIdentity("workflow-execution", `${input.flow.id}:${input.triggerNodeId}:${input.stopAfterNodeId ?? "complete"}:${contextIdentity}:${identity}`)
		: crypto.randomUUID();
	const flowVersionId = identity
		? await stableIdentity("workflow-version", executionId)
		: crypto.randomUUID();
	let executionFamilyId = executionId;
	if (input.recoveryOfExecutionId) {
		const sourceExecution = await getExecutionById(env.DB, input.recoveryOfExecutionId);
		if (!sourceExecution || sourceExecution.owner_id !== input.ownerId) {
			throw new WorkflowStartError(
				"Workflow recovery source does not exist in the authorized execution scope",
				"workflow_flow_invalid",
				400,
			);
		}
		executionFamilyId = sourceExecution.execution_family_id;
	}

	try {
		await createFlowVersion(env.DB, {
			id: flowVersionId,
			flowId: input.flow.id,
			name: input.flow.name,
			data: JSON.stringify(scopedFlowData),
			userId: input.ownerId,
			nowIso,
		});
	} catch (error: unknown) {
		if (!identity || !isPrismaUniqueConstraint(error)) throw error;
	}

	try {
		await createExecution(env.DB, {
			id: executionId,
			flowId: input.flow.id,
			flowVersionId,
			ownerId: input.ownerId,
			concurrency,
			trigger: input.trigger,
			projectId: input.projectContext?.projectId ?? input.delivery?.projectId ?? input.flow.project_id,
			canvasId: input.projectContext?.canvasId ?? input.delivery?.flowId ?? input.flow.id,
			userInput: workflowUserInput(input.triggerPayload),
			projectContext: input.projectContext,
			assetSnapshot: input.projectContext?.assetSnapshot,
			recoveryOfExecutionId: input.recoveryOfExecutionId ?? null,
			...(input.recoveryOfExecutionId
				? { recoveryAdmission: input.recoveryAdmission ?? "failed_source" as const }
				: {}),
			executionFamilyId,
			usesProjectAssets: executionUsesProjectAssets(input.projectContext, input.triggerPayload),
			nowIso,
		});
	} catch (error: unknown) {
		const recoveryAdmissionReason = workflowRecoveryAdmissionReason(error);
		if (recoveryAdmissionReason) {
			throw new WorkflowStartError(
				error instanceof Error ? error.message : "Workflow recovery admission was rejected",
				"workflow_start_failed",
				409,
				{ reason: recoveryAdmissionReason, recoveryOfExecutionId: input.recoveryOfExecutionId ?? null },
			);
		}
		if (!identity || !isPrismaUniqueConstraint(error)) throw error;
		const existing = await getExecutionById(env.DB, executionId);
		if (!existing || existing.owner_id !== input.ownerId || existing.flow_id !== input.flow.id) {
			throw error;
		}
		const existingExecution = mapExecutionRow(existing);
		await materializeAcceptedExecution(input, existingExecution);
		if (existing.status === "queued") {
			await startDurableExecution(env, executionId);
			const refreshed = await getExecutionById(env.DB, executionId);
			if (!refreshed) {
				throw new WorkflowStartError("Failed to load claimed execution", "workflow_start_failed", 500);
			}
			return { created: false, execution: mapExecutionRow(refreshed) };
		}
		return { created: false, execution: existingExecution };
	}

	const created = await getExecutionById(env.DB, executionId);
	if (!created) {
		throw new WorkflowStartError("Failed to load execution", "workflow_start_failed", 500);
	}
	await materializeAcceptedExecution(input, mapExecutionRow(created));
	await startDurableExecution(env, executionId);
	const started = await getExecutionById(env.DB, executionId);
	if (!started) {
		throw new WorkflowStartError("Failed to load started execution", "workflow_start_failed", 500);
	}
	return { created: true, execution: mapExecutionRow(started) };
}
