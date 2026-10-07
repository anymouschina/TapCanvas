import {
	WORKFLOW_EXECUTION_SEMANTICS_PROTOCOL_VERSION,
	deriveWorkflowExecutionSemanticsV2,
	hasWorkflowPluginExecutorRefPrefix,
	parseWorkflowExecutionSemanticsSnapshotV2,
	parseWorkflowExecutionSemanticsV2,
	parseWorkflowPipelineRunSpec,
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
	type WorkflowNodeSnapshot,
} from "./execution.node-runtime";
import { resolveCoreWorkflowExecutorSemantics } from "./execution.core-semantics";

import { flattenWorkflowNodeTree } from "./execution.node-tree";
import { composeWorkflowPipelineRunSemantics } from "./execution.pipeline-runner";

function frozenNodeTree(flowData: unknown): WorkflowNodeSnapshot[] {
	const nodes = parseWorkflowNodes({ nodes: flattenWorkflowNodeTree(parseWorkflowNodes(flowData)) });
	if (new Set(nodes.map(node => node.id)).size !== nodes.length) throw new Error("Frozen workflow node ids must be unique across inline steps");
	return nodes;
}

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
	const nodes = frozenNodeTree(flowData);
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
	return frozenNodeTree(flowData).some((node) => {
		const executorRef = resolveWorkflowNodeExecutorRef(node);
		return executorRef ? hasWorkflowPluginExecutorRefPrefix(executorRef) : false;
	});
}

/** Preserve original action semantics when an explicit bound selects a subgraph. */
export function projectWorkflowExecutionSemanticsSnapshot(
	source: Record<string, unknown>,
	scoped: Record<string, unknown>,
): Record<string, unknown> {
	if (source[SNAPSHOT_FIELD] === undefined) return scoped;
	const original = parseWorkflowExecutionSemanticsSnapshotV2(source[SNAPSHOT_FIELD]);
	assertSnapshotMatchesFlow(source, original);
	const nodes = Object.fromEntries(frozenNodeTree(scoped).map(node => {
		const entry = original.nodes[node.id];
		if (!entry) throw new Error(`Scoped node ${node.id} has no frozen execution semantics`);
		return [node.id, entry];
	}));
	const snapshot = { ...original, nodes };
	assertSnapshotMatchesFlow(scoped, snapshot);
	return { ...scoped, [SNAPSHOT_FIELD]: snapshot };
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
	const resolveNodeSemantics = (node: WorkflowNodeSnapshot): WorkflowExecutionSemanticsV2 => {
		const executorRef = resolveWorkflowNodeExecutorRef(node);
		if (!executorRef) throw new Error(`Workflow node ${node.id} has no executorRef for its execution semantics`);
		const semantics = executorRef === "workflow.pipeline.run/v1"
			? composeWorkflowPipelineRunSemantics(parseWorkflowPipelineRunSpec(node.data.workflowPipeline), resolveNodeSemantics)
			: resolveCoreWorkflowExecutorSemantics(executorRef)
				?? (hasWorkflowPluginExecutorRefPrefix(executorRef) ? resolvePluginSemantics(executorRef, manifests) : null);
		if (!semantics) throw new Error(`Workflow executor ${executorRef} has no registered execution semantics`);
		const retryPolicy = node.data.workflowRetryPolicy;
		if (retryPolicy !== undefined && (!isRecord(retryPolicy) || !Number.isInteger(retryPolicy.maxAttempts))) {
			throw new Error(`Workflow node ${node.id} retry policy requires an integer maxAttempts`);
		}
		const configuredSemantics = isRecord(retryPolicy)
			? parseWorkflowExecutionSemanticsV2({ ...semantics, maxAutomaticAttempts: retryPolicy.maxAttempts })
			: semantics;
		nodes[node.id] = Object.freeze({ executorRef, semantics: configuredSemantics });
		return configuredSemantics;
	};
	for (const node of frozenNodeTree(flowData)) resolveNodeSemantics(node);
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
