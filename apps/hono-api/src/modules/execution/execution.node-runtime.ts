import {
	hasWorkflowPluginExecutorRefPrefix,
	parseWorkflowMediaAssetV1,
	WORKFLOW_CONCURRENCY_MAX,
	WORKFLOW_CONCURRENCY_MIN,
	type WorkflowItemLineageV1,
	type WorkflowNodeExecutionMode,
} from "@tapcanvas/workflow-kernel-protocol";
import { CORE_WORKFLOW_EXECUTOR_REFS } from "./execution.core-semantics";
import {
	parseWorkflowExternalCheckScheduleV1,
	type WorkflowExternalCheckScheduleV1,
} from "./execution.external-check";

export type WorkflowNodeSnapshot = {
	id: string;
	type: string;
	kind: string;
	data: Record<string, unknown>;
};

export type UnsupportedWorkflowNode = {
	nodeId: string;
	kind: string;
	reason:
		| "executor_not_registered"
		| "kind_missing"
		| "prompt_not_ready";
};

export type WorkflowExecutionSupport = {
	hasWorkflowOutput: boolean;
	nodes: WorkflowNodeSnapshot[];
	unsupportedNodes: UnsupportedWorkflowNode[];
};

export type WorkflowNodeExecutionResult =
	| {
			ok: true;
			outputRefs: WorkflowNodeOutputV1;
	  }
	| {
			ok: false;
			waitingExternal: true;
			externalCheck: WorkflowExternalCheckScheduleV1;
			outputRefs: WorkflowNodeOutputV1;
	  }
	| {
			ok: false;
			waitingExternal?: false;
			errorCode:
				| "workflow_node_executor_missing"
				| "workflow_node_kind_missing"
				| "workflow_node_prompt_not_ready"
				| "workflow_project_context_required"
				| "workflow_node_runtime_failed"
				| "workflow_asset_forbidden"
				| "workflow_asset_not_found"
				| "workflow_asset_deleted"
				| "workflow_asset_transcoding"
				| "workflow_asset_resource_unavailable"
				| "workflow_explicit_failure_terminal"
				| "workflow_subworkflow_failed";
			errorMessage: string;
			outputRefs?: WorkflowNodeOutputV1;
	  };

export type WorkflowNodeItemRunV1 = Readonly<{
	itemId: string;
	index: number;
	status: "success" | "waiting_external" | "failed";
	runtimeNodeId: string;
	lineage: readonly WorkflowItemLineageV1[];
	ports: Record<string, unknown>;
	artifacts: WorkflowNodeOutputV1["artifacts"];
	evidence: Record<string, unknown>;
	errorCode?: string;
	errorMessage?: string;
	externalCheck?: WorkflowExternalCheckScheduleV1;
}>;

export type WorkflowNodeOutputV1 = {
	protocolVersion: "1";
	executorRef: string;
	nodeId: string;
	executionMode: WorkflowNodeExecutionMode;
	ports: Record<string, unknown>;
	artifacts: Array<{
		type: string;
		identity: string | null;
		value?: unknown;
		media?: ReturnType<typeof parseWorkflowMediaAssetV1>;
	}>;
	evidence: Record<string, unknown>;
	itemRuns: readonly WorkflowNodeItemRunV1[];
	externalCheck?: WorkflowExternalCheckScheduleV1;
};

export function workflowNodeWaiting(
	outputRefs: WorkflowNodeOutputV1,
	externalCheck: WorkflowExternalCheckScheduleV1,
): Extract<WorkflowNodeExecutionResult, { waitingExternal: true }> {
	return { ok: false, waitingExternal: true, externalCheck, outputRefs };
}

function requireNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`Workflow node output ${field} must be a non-empty string`);
	}
	return value.trim();
}

function parseWorkflowLineage(value: unknown, field: string): WorkflowItemLineageV1 {
	if (!isRecord(value)) throw new Error(`Workflow node output ${field} must be an object`);
	const index = value.index;
	if (!Number.isInteger(index) || Number(index) < 0) {
		throw new Error(`Workflow node output ${field}.index must be a non-negative integer`);
	}
	return {
		nodeId: requireNonEmptyString(value.nodeId, `${field}.nodeId`),
		portId: requireNonEmptyString(value.portId, `${field}.portId`),
		itemId: requireNonEmptyString(value.itemId, `${field}.itemId`),
		index: Number(index),
	};
}

function parseWorkflowArtifacts(value: unknown): WorkflowNodeOutputV1["artifacts"] {
	if (!Array.isArray(value)) throw new Error("Workflow node output artifacts must be an array");
	return value.map((artifact, index) => {
		if (!isRecord(artifact)) throw new Error(`Workflow node output artifacts[${index}] must be an object`);
		if (artifact.identity !== null && typeof artifact.identity !== "string") {
			throw new Error(`Workflow node output artifacts[${index}].identity must be a string or null`);
		}
		return {
			type: requireNonEmptyString(artifact.type, `artifacts[${index}].type`),
			identity: artifact.identity,
			...(Object.prototype.hasOwnProperty.call(artifact, "value") ? { value: artifact.value } : {}),
			...(Object.prototype.hasOwnProperty.call(artifact, "media")
				? { media: parseWorkflowMediaAssetV1(artifact.media) }
				: {}),
		};
	});
}

function parseWorkflowItemRuns(value: unknown): readonly WorkflowNodeItemRunV1[] {
	if (!Array.isArray(value)) throw new Error("Workflow node output itemRuns must be an array");
	return value.map((itemRun, index) => {
		if (!isRecord(itemRun)) throw new Error(`Workflow node output itemRuns[${index}] must be an object`);
		const itemIndex = itemRun.index;
		if (!Number.isInteger(itemIndex) || Number(itemIndex) < 0) {
			throw new Error(`Workflow node output itemRuns[${index}].index must be a non-negative integer`);
		}
		const status = itemRun.status;
		if (status !== "success" && status !== "waiting_external" && status !== "failed") {
			throw new Error(`Workflow node output itemRuns[${index}].status is invalid`);
		}
		if (!Array.isArray(itemRun.lineage)) {
			throw new Error(`Workflow node output itemRuns[${index}].lineage must be an array`);
		}
		if (!isRecord(itemRun.ports) || !isRecord(itemRun.evidence)) {
			throw new Error(`Workflow node output itemRuns[${index}] requires ports and evidence objects`);
		}
		return {
			itemId: requireNonEmptyString(itemRun.itemId, `itemRuns[${index}].itemId`),
			index: Number(itemIndex),
			status,
			runtimeNodeId: requireNonEmptyString(itemRun.runtimeNodeId, `itemRuns[${index}].runtimeNodeId`),
			lineage: itemRun.lineage.map((lineage, lineageIndex) => parseWorkflowLineage(lineage, `itemRuns[${index}].lineage[${lineageIndex}]`)),
			ports: itemRun.ports,
			artifacts: parseWorkflowArtifacts(itemRun.artifacts),
			evidence: itemRun.evidence,
			...(itemRun.externalCheck === undefined
				? {}
				: { externalCheck: parseWorkflowExternalCheckScheduleV1(itemRun.externalCheck) ?? undefined }),
			...(typeof itemRun.errorCode === "string" && itemRun.errorCode.trim() ? { errorCode: itemRun.errorCode.trim() } : {}),
			...(typeof itemRun.errorMessage === "string" && itemRun.errorMessage.trim() ? { errorMessage: itemRun.errorMessage.trim() } : {}),
		};
	});
}

export function parseWorkflowNodeOutputV1(raw: unknown): WorkflowNodeOutputV1 | null {
	if (raw === null || raw === undefined) return null;
	let parsed: unknown = raw;
	if (typeof raw === "string") {
		try {
			parsed = JSON.parse(raw) as unknown;
		} catch (error: unknown) {
			throw new Error(`Workflow node output is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (!isRecord(parsed)) throw new Error("Workflow node output must be an object");
	if (parsed.protocolVersion !== "1") throw new Error("Workflow node output protocolVersion must be 1");
	const executionMode = parsed.executionMode;
	if (executionMode !== "once" && executionMode !== "each" && executionMode !== "collect") {
		throw new Error("Workflow node output executionMode is invalid");
	}
	if (!isRecord(parsed.ports) || !isRecord(parsed.evidence)) {
		throw new Error("Workflow node output requires ports and evidence objects");
	}
	return {
		protocolVersion: "1",
		executorRef: requireNonEmptyString(parsed.executorRef, "executorRef"),
		nodeId: requireNonEmptyString(parsed.nodeId, "nodeId"),
		executionMode,
		ports: parsed.ports,
		artifacts: parseWorkflowArtifacts(parsed.artifacts),
		evidence: parsed.evidence,
		itemRuns: parseWorkflowItemRuns(parsed.itemRuns),
		...(parsed.externalCheck === undefined
			? {}
			: { externalCheck: parseWorkflowExternalCheckScheduleV1(parsed.externalCheck) ?? undefined }),
	};
}

export const REGISTERED_WORKFLOW_EXECUTOR_REFS = CORE_WORKFLOW_EXECUTOR_REFS;

const registeredExecutorRefs = new Set<string>(CORE_WORKFLOW_EXECUTOR_REFS);

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseFlowData(raw: unknown): Record<string, unknown> {
	let parsed = raw;
	if (typeof raw === "string") {
		try {
			parsed = JSON.parse(raw) as unknown;
		} catch {
			throw new Error("Workflow flow version data is not valid JSON");
		}
	}
	if (!isRecord(parsed)) {
		throw new Error("Workflow flow version data must be an object");
	}
	return parsed;
}

export function parseWorkflowNodes(raw: unknown): WorkflowNodeSnapshot[] {
	const flowData = parseFlowData(raw);
	if (!Array.isArray(flowData.nodes)) {
		throw new Error("Workflow flow version data must contain a nodes array");
	}
	return flowData.nodes.map((rawNode, index) => {
		if (!isRecord(rawNode)) {
			throw new Error(`Workflow node at index ${index} must be an object`);
		}
		const id = typeof rawNode.id === "string" ? rawNode.id.trim() : "";
		if (!id) {
			throw new Error(`Workflow node at index ${index} is missing id`);
		}
		const data = isRecord(rawNode.data) ? rawNode.data : {};
		return {
			id,
			type:
				typeof rawNode.type === "string" && rawNode.type.trim()
					? rawNode.type.trim()
					: "unknown",
			kind:
				typeof data.kind === "string" && data.kind.trim()
					? data.kind.trim()
					: "unknown",
			data,
		};
	});
}

function unsupportedNode(
	node: WorkflowNodeSnapshot,
): UnsupportedWorkflowNode | null {
	if (node.type !== "taskNode") return null;
	if (node.data.promptNeedsFill === true) {
		return {
			nodeId: node.id,
			kind: node.kind,
			reason: "prompt_not_ready",
		};
	}
	if (
		node.data.skipDagRun === true
	) {
		return null;
	}
	if (node.kind === "unknown") {
		return {
			nodeId: node.id,
			kind: node.kind,
			reason: "kind_missing",
		};
	}
	const executorRef = resolveWorkflowNodeExecutorRef(node);
	if (executorRef && (registeredExecutorRefs.has(executorRef) || hasWorkflowPluginExecutorRefPrefix(executorRef))) return null;
	return {
		nodeId: node.id,
		kind: node.kind,
		reason: "executor_not_registered",
	};
}

export function inspectWorkflowExecutionSupport(
	raw: unknown,
): WorkflowExecutionSupport {
	const nodes = parseWorkflowNodes(raw);
	return {
		hasWorkflowOutput: nodes.some(
			(node) => node.type === "taskNode" && (
				node.kind === "workflowOutput"
				|| readAtomicSpecField(node.data, "category") === "delivery"
			),
		),
		nodes,
		unsupportedNodes: nodes.flatMap((node) => {
			const unsupported = unsupportedNode(node);
			return unsupported ? [unsupported] : [];
		}),
	};
}

export function workflowNodeExecutionFailure(
	node: WorkflowNodeSnapshot,
): Extract<WorkflowNodeExecutionResult, { ok: false }> | null {
	const unsupported = unsupportedNode(node);
	if (!unsupported) return null;
	if (unsupported.reason === "prompt_not_ready") {
		return {
			ok: false,
			errorCode: "workflow_node_prompt_not_ready",
			errorMessage: `Workflow node ${node.id} cannot run because its prompt is not ready`,
		};
	}
	if (unsupported.reason === "kind_missing") {
		return {
			ok: false,
			errorCode: "workflow_node_kind_missing",
			errorMessage: `Workflow node ${node.id} has no executable kind`,
		};
	}
	return {
		ok: false,
		errorCode: "workflow_node_executor_missing",
		errorMessage: `Workflow node kind "${node.kind}" has no registered server executor (nodeId=${node.id})`,
	};
}

function readAtomicSpecField(
	data: Record<string, unknown>,
	field: string,
): string {
	const raw = data.workflowAtomicSpec;
	if (!isRecord(raw)) return "";
	const value = raw[field];
	return typeof value === "string" ? value.trim() : "";
}

export function resolveWorkflowNodeExecutorRef(
	node: WorkflowNodeSnapshot,
): string | null {
	const explicit = readAtomicSpecField(node.data, "executorRef");
	if (explicit) return explicit;
	if (node.kind === "workflowTrigger") return "workflow.trigger/v1";
	if (node.kind === "workflowInput") return "workflow.input/v1";
	if (node.kind === "workflowOutput") return "workflow.output/v1";
	if (node.kind === "text") return "workflow.input.text/v1";
	if (node.data.skipDagRun === true) return "workflow.output/v1";
	return null;
}

export function resolveWorkflowNodeExecutionMode(
	node: WorkflowNodeSnapshot,
): WorkflowNodeExecutionMode | null {
	if (node.kind === "workflowTrigger") return "once";
	const executionMode = readAtomicSpecField(node.data, "executionMode");
	if (executionMode === "once" || executionMode === "each" || executionMode === "collect") {
		return executionMode;
	}
	return null;
}

export function resolveWorkflowNodeItemConcurrency(node: WorkflowNodeSnapshot): number {
	const rawSpec = node.data.workflowAtomicSpec;
	if (!isRecord(rawSpec) || rawSpec.itemConcurrency === undefined) return 1;
	const value = rawSpec.itemConcurrency;
	if (
		typeof value !== "number"
		|| !Number.isInteger(value)
		|| value < WORKFLOW_CONCURRENCY_MIN
		|| value > WORKFLOW_CONCURRENCY_MAX
	) {
		throw new Error(
			`Workflow node ${node.id} itemConcurrency must be an integer between ${WORKFLOW_CONCURRENCY_MIN} and ${WORKFLOW_CONCURRENCY_MAX}`,
		);
	}
	return value;
}

export function findWorkflowNode(
	raw: unknown,
	nodeId: string,
): WorkflowNodeSnapshot {
	const node = parseWorkflowNodes(raw).find((candidate) => candidate.id === nodeId);
	if (!node) {
		throw new Error(`Workflow node ${nodeId} does not exist in the immutable flow version`);
	}
	return node;
}
