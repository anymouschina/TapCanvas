import {
	WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION,
	deriveWorkflowExecutionSemanticsV2,
	hasWorkflowPluginExecutorRefPrefix,
	parseWorkflowExecutionSemanticsSnapshotV2,
	parseWorkflowPluginExecutorRefV1,
	parseWorkflowPluginManifestV1,
	type WorkflowExecutionSemanticsSnapshotV2,
	type WorkflowExecutionSemanticsV2,
	type WorkflowPluginManifestV1,
} from "@tapcanvas/workflow-kernel-protocol";
import type { WorkflowPluginCatalogRegistration } from "./execution.plugin-runtime";
import {
	parseWorkflowNodes,
	resolveWorkflowNodeExecutorRef,
} from "./execution.node-runtime";
import { resolveCoreWorkflowExecutorSemantics } from "./execution.core-semantics";

const SNAPSHOT_FIELD = "workflowExecutionSemantics";

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseFlowRecord(value: unknown): Record<string, unknown> {
	let parsed = value;
	if (typeof value === "string") {
		try {
			parsed = JSON.parse(value) as unknown;
		} catch (error: unknown) {
			throw new Error(`Workflow flow version data is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	if (!isRecord(parsed)) throw new Error("Workflow flow version data must be an object");
	return parsed;
}

function registeredPluginManifests(
	registrations: readonly WorkflowPluginCatalogRegistration[],
): readonly WorkflowPluginManifestV1[] {
	return registrations.map((registration) => parseWorkflowPluginManifestV1(registration.manifest));
}

function resolvePluginSemantics(
	executorRef: string,
	manifests: readonly WorkflowPluginManifestV1[],
): WorkflowExecutionSemanticsV2 {
	const identity = parseWorkflowPluginExecutorRefV1(executorRef);
	const manifest = manifests.find((candidate) => (
		candidate.pluginId === identity.pluginId
		&& candidate.pluginVersion === identity.pluginVersion
	));
	if (!manifest) throw new Error(`Workflow plugin executor ${executorRef} has no admitted immutable manifest`);
	const capability = manifest.capabilities.find((candidate) => (
		candidate.capabilityId === identity.capabilityId
		&& candidate.capabilityVersion === identity.capabilityVersion
	));
	if (!capability) throw new Error(`Workflow plugin executor ${executorRef} has no matching immutable capability`);
	return deriveWorkflowExecutionSemanticsV2(capability.execution);
}

function assertSnapshotMatchesFlow(
	flowData: Record<string, unknown>,
	snapshot: WorkflowExecutionSemanticsSnapshotV2,
): void {
	const nodes = parseWorkflowNodes(flowData);
	if (Object.keys(snapshot.nodes).length !== nodes.length) {
		throw new Error("Workflow execution semantics snapshot must cover every immutable workflow node exactly once");
	}
	for (const node of nodes) {
		const executorRef = resolveWorkflowNodeExecutorRef(node);
		if (!executorRef) throw new Error(`Workflow node ${node.id} has no executorRef for its frozen execution semantics`);
		const frozen = snapshot.nodes[node.id];
		if (!frozen || frozen.executorRef !== executorRef) {
			throw new Error(`Workflow node ${node.id} execution semantics do not match its immutable executorRef`);
		}
	}
}

export function workflowRequiresPluginSemantics(flowData: unknown): boolean {
	return parseWorkflowNodes(flowData).some((node) => {
		const executorRef = resolveWorkflowNodeExecutorRef(node);
		return executorRef ? hasWorkflowPluginExecutorRefPrefix(executorRef) : false;
	});
}

export function freezeWorkflowExecutionSemanticsSnapshot(
	flowDataValue: unknown,
	pluginRegistrations: readonly WorkflowPluginCatalogRegistration[] = [],
): Record<string, unknown> {
	const flowData = parseFlowRecord(flowDataValue);
	const existing = flowData[SNAPSHOT_FIELD];
	if (existing !== undefined) {
		const snapshot = parseWorkflowExecutionSemanticsSnapshotV2(existing);
		assertSnapshotMatchesFlow(flowData, snapshot);
		return { ...flowData, [SNAPSHOT_FIELD]: snapshot };
	}
	const manifests = registeredPluginManifests(pluginRegistrations);
	const nodes: Record<string, Readonly<{ executorRef: string; semantics: WorkflowExecutionSemanticsV2 }>> = {};
	for (const node of parseWorkflowNodes(flowData)) {
		const executorRef = resolveWorkflowNodeExecutorRef(node);
		if (!executorRef) throw new Error(`Workflow node ${node.id} has no executorRef for its execution semantics`);
		const semantics = resolveCoreWorkflowExecutorSemantics(executorRef)
			?? (hasWorkflowPluginExecutorRefPrefix(executorRef) ? resolvePluginSemantics(executorRef, manifests) : null);
		if (!semantics) throw new Error(`Workflow executor ${executorRef} has no registered execution semantics`);
		nodes[node.id] = Object.freeze({ executorRef, semantics });
	}
	return {
		...flowData,
		[SNAPSHOT_FIELD]: Object.freeze({
			protocolVersion: WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION,
			nodes: Object.freeze(nodes),
		}),
	};
}

export function readWorkflowExecutionSemanticsSnapshot(
	flowDataValue: unknown,
): WorkflowExecutionSemanticsSnapshotV2 {
	const flowData = parseFlowRecord(flowDataValue);
	const snapshot = parseWorkflowExecutionSemanticsSnapshotV2(flowData[SNAPSHOT_FIELD]);
	assertSnapshotMatchesFlow(flowData, snapshot);
	return snapshot;
}

export function readWorkflowNodeExecutionSemantics(
	flowDataValue: unknown,
	nodeId: string,
): WorkflowExecutionSemanticsV2 {
	const snapshot = readWorkflowExecutionSemanticsSnapshot(flowDataValue);
	const frozen = snapshot.nodes[nodeId];
	if (!frozen) throw new Error(`Workflow node ${nodeId} has no frozen execution semantics`);
	return frozen.semantics;
}
