export const WORKFLOW_VIDEO_PROVIDER_EXECUTOR_REF = "tapcanvas.video.generate/v1";

export type WorkflowProductionStartDeadlineV2 = Readonly<{
	version: 2;
	kind: "video_provider_receipt";
	source: "public_chat";
	anchor: "workflow_execution_created";
	publicTurnId: string;
	acceptedAt: string;
	deadlineAt: string;
	targetExecutorRef: typeof WORKFLOW_VIDEO_PROVIDER_EXECUTOR_REF;
	controlledNodeIds: readonly string[];
}>;

export type WorkflowExecutionControlV2 = Readonly<{
	version: 2;
	productionStartDeadline: WorkflowProductionStartDeadlineV2;
}>;

export type WorkflowExecutionControlAdmissionV2 = Readonly<{
	version: 2;
	productionStartDeadline: Readonly<{
		version: 2;
		kind: "video_provider_receipt";
		source: "public_chat";
		publicTurnId: string;
		windowMs: number;
		targetExecutorRef: typeof WORKFLOW_VIDEO_PROVIDER_EXECUTOR_REF;
	}>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readIsoTimestamp(value: unknown): string | null {
	const normalized = readNonEmptyString(value);
	return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

function workflowNodeExecutorRef(value: unknown): string | null {
	if (!isRecord(value) || !isRecord(value.data)) return null;
	const spec = isRecord(value.data.workflowAtomicSpec)
		? value.data.workflowAtomicSpec
		: null;
	return readNonEmptyString(spec?.executorRef);
}

function controlledUpstreamNodeIds(
	flowData: Record<string, unknown>,
	targetExecutorRef: string,
): readonly string[] {
	const nodes = Array.isArray(flowData.nodes) ? flowData.nodes : [];
	const targetNodeIds = nodes.flatMap((node) => {
		if (!isRecord(node) || workflowNodeExecutorRef(node) !== targetExecutorRef) return [];
		const nodeId = readNonEmptyString(node.id);
		return nodeId ? [nodeId] : [];
	});
	if (targetNodeIds.length === 0) {
		throw new Error(`Workflow production-start control target executor is missing: ${targetExecutorRef}`);
	}
	const reverse = new Map<string, string[]>();
	const nodeIds = new Set(nodes.flatMap((node) => {
		const nodeId = isRecord(node) ? readNonEmptyString(node.id) : null;
		return nodeId ? [nodeId] : [];
	}));
	const edges = Array.isArray(flowData.edges) ? flowData.edges : [];
	for (const edge of edges) {
		if (!isRecord(edge)) continue;
		const source = readNonEmptyString(edge.source);
		const target = readNonEmptyString(edge.target);
		if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) continue;
		const sources = reverse.get(target) ?? [];
		sources.push(source);
		reverse.set(target, sources);
	}
	const controlled = new Set<string>();
	const frontier = [...targetNodeIds];
	while (frontier.length > 0) {
		const target = frontier.pop();
		if (!target) continue;
		for (const source of reverse.get(target) ?? []) {
			if (controlled.has(source)) continue;
			controlled.add(source);
			frontier.push(source);
		}
	}
	return [...controlled].sort();
}

export function materializeWorkflowExecutionControl(
	flowData: Record<string, unknown>,
	admission: WorkflowExecutionControlAdmissionV2,
	executionCreatedAt: string,
): WorkflowExecutionControlV2 {
	const deadline = admission.productionStartDeadline;
	const publicTurnId = readNonEmptyString(deadline.publicTurnId);
	const acceptedAt = readIsoTimestamp(executionCreatedAt);
	const windowMs = Number.isFinite(deadline.windowMs) ? Math.floor(deadline.windowMs) : 0;
	if (!publicTurnId || !acceptedAt || windowMs <= 0) {
		throw new Error("Workflow production-start deadline admission is invalid");
	}
	if (deadline.targetExecutorRef !== WORKFLOW_VIDEO_PROVIDER_EXECUTOR_REF) {
		throw new Error("Workflow production-start target executor is invalid");
	}
	const deadlineAt = new Date(Date.parse(acceptedAt) + windowMs).toISOString();
	return {
		version: 2,
		productionStartDeadline: {
			version: 2,
			kind: deadline.kind,
			source: deadline.source,
			anchor: "workflow_execution_created",
			publicTurnId,
			acceptedAt,
			deadlineAt,
			targetExecutorRef: deadline.targetExecutorRef,
			controlledNodeIds: controlledUpstreamNodeIds(flowData, deadline.targetExecutorRef),
		},
	};
}

export function parseWorkflowExecutionControl(value: unknown): WorkflowExecutionControlV2 | null {
	if (!isRecord(value) || value.version !== 2 || !isRecord(value.productionStartDeadline)) return null;
	const deadline = value.productionStartDeadline;
	const publicTurnId = readNonEmptyString(deadline.publicTurnId);
	const acceptedAt = readIsoTimestamp(deadline.acceptedAt);
	const deadlineAt = readIsoTimestamp(deadline.deadlineAt);
	const controlledNodeIds = Array.isArray(deadline.controlledNodeIds)
		? deadline.controlledNodeIds.flatMap((nodeId) => {
			const normalized = readNonEmptyString(nodeId);
			return normalized ? [normalized] : [];
		})
		: [];
	if (
		deadline.version !== 2
		|| deadline.kind !== "video_provider_receipt"
		|| deadline.source !== "public_chat"
		|| deadline.anchor !== "workflow_execution_created"
		|| deadline.targetExecutorRef !== WORKFLOW_VIDEO_PROVIDER_EXECUTOR_REF
		|| !publicTurnId
		|| !acceptedAt
		|| !deadlineAt
		|| controlledNodeIds.length === 0
	) return null;
	return {
		version: 2,
		productionStartDeadline: {
			version: 2,
			kind: "video_provider_receipt",
			source: "public_chat",
			anchor: "workflow_execution_created",
			publicTurnId,
			acceptedAt,
			deadlineAt,
			targetExecutorRef: WORKFLOW_VIDEO_PROVIDER_EXECUTOR_REF,
			controlledNodeIds: [...new Set(controlledNodeIds)].sort(),
		},
	};
}

/**
 * Every pre-provider Agent observes the one immutable public production-start
 * deadline. Do not subdivide that deadline into speculative retry shares: a
 * physical timeout does not guarantee that the provider emitted a resumable
 * candidate, so an early artificial cutoff can turn one healthy inference into
 * several shorter from-scratch inferences. The execution-level deadline worker
 * remains the single authority that cancels unaccepted branches at deadlineAt.
 */
export function computeWorkflowAgentPhysicalAttemptDeadlineAt(input: Readonly<{
	productionStartDeadline: WorkflowProductionStartDeadlineV2;
}>): string {
	const finalDeadlineMs = Date.parse(input.productionStartDeadline.deadlineAt);
	if (!Number.isFinite(finalDeadlineMs)) {
		throw new Error("Workflow production-start deadline is invalid");
	}
	return new Date(finalDeadlineMs).toISOString();
}
