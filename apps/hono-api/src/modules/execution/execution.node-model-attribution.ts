import { resolveWorkflowAgentModelKey } from "./execution.agent-model-inheritance";

type WorkflowNodeModelData = Readonly<Record<string, unknown>>;

function optionalString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Attribute a model only to a node that actually invokes that model family.
 * Pure control/validation nodes may retain historical model fields in their
 * immutable canvas snapshot, but those fields are configuration provenance,
 * not evidence of a model call.
 */
export function resolveWorkflowNodeExecutionModelKey(input: Readonly<{
	executorRef: string | null;
	flowVersionData: unknown;
	nodeData: WorkflowNodeModelData;
}>): string | null {
	if (input.executorRef === "agents.logical-task/v2") {
		return resolveWorkflowAgentModelKey({
			flowVersionData: input.flowVersionData,
			configuredModelKey: optionalString(input.nodeData.workflowAgentModelKey)
				?? optionalString(input.nodeData.workflowModelKey),
		}) || null;
	}
	if (input.executorRef === "tapcanvas.image.generate/v1") {
		return optionalString(input.nodeData.workflowImageModelKey)
			?? optionalString(input.nodeData.workflowModelKey);
	}
	if (input.executorRef === "tapcanvas.video.generate/v1") {
		return optionalString(input.nodeData.workflowVideoModelKey)
			?? optionalString(input.nodeData.workflowModelKey);
	}
	return null;
}
