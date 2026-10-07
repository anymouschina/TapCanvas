import type { WorkflowItemLineageV1 } from "@tapcanvas/workflow-kernel-protocol";
import {
	parseWorkflowNodeOutputV1,
	type WorkflowNodeOutputV1,
} from "./execution.node-runtime";

type ChildNodeRunSnapshot = Readonly<{
	nodeId: string;
	status: string;
	outputRefs: unknown;
}>;

export type WorkflowSubworkflowOutputSelection = Readonly<{
	nodeId: string;
	portId: string;
	artifactType: string;
}>;

export type WorkflowSubworkflowOutputProjection = Readonly<{
	protocolVersion: "workflow.subworkflow-output-projection/v1";
	childExecutionId: string;
	childFlowVersionId: string;
	selection: WorkflowSubworkflowOutputSelection;
	lineage: readonly WorkflowItemLineageV1[];
	value: unknown;
	artifact: WorkflowNodeOutputV1["artifacts"][number];
}>;

export type ProjectWorkflowSubworkflowOutputInput = Readonly<{
	childExecutionId: string;
	childFlowVersionId: string;
	selection: WorkflowSubworkflowOutputSelection;
	lineage: readonly WorkflowItemLineageV1[];
	nodeRuns: readonly ChildNodeRunSnapshot[];
}>;

function requireIdentity(value: string, field: string): string {
	const normalized = value.trim();
	if (!normalized) throw new Error(`Subworkflow output projection ${field} must be a non-empty string`);
	return normalized;
}

function projectLineage(lineage: readonly WorkflowItemLineageV1[]): readonly WorkflowItemLineageV1[] {
	return lineage.map((entry, index) => {
		const nodeId = requireIdentity(entry.nodeId, `lineage[${index}].nodeId`);
		const portId = requireIdentity(entry.portId, `lineage[${index}].portId`);
		const itemId = requireIdentity(entry.itemId, `lineage[${index}].itemId`);
		if (!Number.isInteger(entry.index) || entry.index < 0) {
			throw new Error(`Subworkflow output projection lineage[${index}].index must be a non-negative integer`);
		}
		return { nodeId, portId, itemId, index: entry.index };
	});
}

function hasMaterializedArtifact(
	artifact: WorkflowNodeOutputV1["artifacts"][number],
): boolean {
	return (typeof artifact.identity === "string" && artifact.identity.trim().length > 0)
		|| (Object.hasOwn(artifact, "value") && artifact.value !== undefined && artifact.value !== null)
		|| Object.hasOwn(artifact, "media");
}

/**
 * Projects one explicitly configured port and typed artifact from the immutable
 * child execution receipt. It never chooses a node, port, or artifact type from
 * labels, topology order, or output shape.
 */
export function projectWorkflowSubworkflowOutput(
	input: ProjectWorkflowSubworkflowOutputInput,
): WorkflowSubworkflowOutputProjection {
	const childExecutionId = requireIdentity(input.childExecutionId, "childExecutionId");
	const childFlowVersionId = requireIdentity(input.childFlowVersionId, "childFlowVersionId");
	const selection = {
		nodeId: requireIdentity(input.selection.nodeId, "selection.nodeId"),
		portId: requireIdentity(input.selection.portId, "selection.portId"),
		artifactType: requireIdentity(input.selection.artifactType, "selection.artifactType"),
	} as const;
	const matches = input.nodeRuns.filter((run) => run.nodeId === selection.nodeId);
	if (matches.length === 0) {
		throw new Error(`Subworkflow output projection node ${selection.nodeId} has no frozen node run`);
	}
	if (matches.length !== 1) {
		throw new Error(`Subworkflow output projection node ${selection.nodeId} has ${matches.length} frozen node runs; expected exactly one`);
	}
	const nodeRun = matches[0]!;
	if (nodeRun.status !== "success") {
		throw new Error(`Subworkflow output projection node ${selection.nodeId} has status ${nodeRun.status}; expected success`);
	}
	const output = parseWorkflowNodeOutputV1(nodeRun.outputRefs);
	if (!output) {
		throw new Error(`Subworkflow output projection node ${selection.nodeId} has no output receipt`);
	}
	if (output.nodeId !== selection.nodeId) {
		throw new Error(`Subworkflow output projection node identity mismatch: ${output.nodeId} != ${selection.nodeId}`);
	}
	if (!Object.hasOwn(output.ports, selection.portId)) {
		throw new Error(`Subworkflow output projection node ${selection.nodeId} has no output port ${selection.portId}`);
	}
	const value = output.ports[selection.portId];
	if (value === undefined || value === null) {
		throw new Error(`Subworkflow output projection port ${selection.nodeId}.${selection.portId} has no materialized value`);
	}
	const candidates = output.artifacts.filter((artifact) => artifact.type === selection.artifactType);
	if (candidates.length === 0) {
		const available = [...new Set(output.artifacts.map((artifact) => artifact.type))].sort();
		throw new Error(
			`Subworkflow output projection node ${selection.nodeId} has no artifact of type ${selection.artifactType}`
			+ (available.length > 0 ? `; available types: ${available.join(", ")}` : "; no typed artifacts were recorded"),
		);
	}
	if (candidates.length !== 1) {
		throw new Error(`Subworkflow output projection node ${selection.nodeId} has ${candidates.length} artifacts of type ${selection.artifactType}; expected exactly one`);
	}
	const artifact = candidates[0]!;
	if (!hasMaterializedArtifact(artifact)) {
		throw new Error(`Subworkflow output projection artifact ${selection.artifactType} has no materialized identity, value, or media`);
	}
	return {
		protocolVersion: "workflow.subworkflow-output-projection/v1",
		childExecutionId,
		childFlowVersionId,
		selection,
		lineage: projectLineage(input.lineage),
		value,
		artifact,
	};
}
