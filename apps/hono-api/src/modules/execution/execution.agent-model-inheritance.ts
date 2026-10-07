import { AgentExecutionPreferencesSchema } from "../task/agent-execution-provenance";
import type { z } from "zod";

export type WorkflowAgentPreferences = z.infer<typeof AgentExecutionPreferencesSchema>;

export type WorkflowInitiatingAgentExecution = Readonly<{
	model: string;
	apiStyle: "chat" | "responses";
} & WorkflowAgentPreferences>;

export type WorkflowAgentModelCutover = Readonly<{
	targetModelKey: string;
	apiStyle: "chat" | "responses";
	authorizedBy: string;
	authorizationSource: "admin" | "initiating_agent";
	requestedAt: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Agent-triggered workflows are child execution chains. Freeze the caller's
 * actual model identity into the immutable flow version so every Agent node,
 * retry and restart uses the same model instead of a model saved in the canvas.
 */
export function parseWorkflowInitiatingAgentExecution(
	flowVersionData: unknown,
): WorkflowInitiatingAgentExecution | null {
	if (!isRecord(flowVersionData)) return null;
	const raw = flowVersionData.workflowInitiatingAgentExecution;
	if (!isRecord(raw)) return null;
	const model = typeof raw.model === "string" ? raw.model.trim() : "";
	const apiStyle = raw.apiStyle;
	if (!model || (apiStyle !== "chat" && apiStyle !== "responses")) return null;
	return { model, apiStyle, ...AgentExecutionPreferencesSchema.parse(raw) };
}

export function resolveWorkflowAgentModelKey(input: Readonly<{
	flowVersionData: unknown;
	configuredModelKey?: string | null;
}>): string {
	return parseWorkflowInitiatingAgentExecution(input.flowVersionData)?.model
		?? (isRecord(input.flowVersionData)
			&& isRecord(input.flowVersionData.workflowDirectAgentModelSelection)
			&& typeof input.flowVersionData.workflowDirectAgentModelSelection.model === "string"
			? input.flowVersionData.workflowDirectAgentModelSelection.model.trim()
			: null)
		?? input.configuredModelKey?.trim()
		?? "";
}

/**
 * The reasoning effort the user chose for this run, in precedence order: the
 * initiating AI-chat turn, then the effort selected next to the model when the
 * workflow was launched directly, then the node's own configuration. Returns
 * undefined when nobody chose one, so the caller applies the workflow default.
 */
export function resolveWorkflowAgentReasoningEffort(input: Readonly<{
	flowVersionData: unknown;
	configuredEffort?: WorkflowAgentPreferences["reasoningEffort"];
}>): WorkflowAgentPreferences["reasoningEffort"] {
	const initiating = parseWorkflowInitiatingAgentExecution(input.flowVersionData)?.reasoningEffort;
	if (initiating) return initiating;
	const direct = isRecord(input.flowVersionData) && isRecord(input.flowVersionData.workflowDirectAgentModelSelection)
		? AgentExecutionPreferencesSchema.safeParse({
			reasoningEffort: input.flowVersionData.workflowDirectAgentModelSelection.reasoningEffort,
		})
		: null;
	if (direct?.success && direct.data.reasoningEffort) return direct.data.reasoningEffort;
	return input.configuredEffort;
}

/**
 * Produces the next immutable workflow snapshot for an explicitly authorized
 * model cutover. This is a lifecycle transition, never a provider fallback:
 * callers must supply the exact target model and authorization provenance.
 */
export function applyWorkflowAgentModelCutover(
	flowVersionData: unknown,
	cutover: WorkflowAgentModelCutover,
): Record<string, unknown> {
	if (!isRecord(flowVersionData)) {
		throw new Error("Workflow Agent model cutover requires an object flow snapshot");
	}
	const source = parseWorkflowInitiatingAgentExecution(flowVersionData);
	if (!source) {
		throw new Error("Workflow Agent model cutover requires frozen initiating Agent provenance");
	}
	const targetModelKey = cutover.targetModelKey.trim();
	const authorizedBy = cutover.authorizedBy.trim();
	if (!targetModelKey || !authorizedBy || !Number.isFinite(Date.parse(cutover.requestedAt))) {
		throw new Error("Workflow Agent model cutover authorization is incomplete");
	}
	if (source.model === targetModelKey && source.apiStyle === cutover.apiStyle) {
		throw new Error("Workflow Agent model cutover target matches the frozen source model");
	}
	const priorLedger = Array.isArray(flowVersionData.workflowAgentModelCutovers)
		? flowVersionData.workflowAgentModelCutovers
		: [];
	return {
		...flowVersionData,
		workflowInitiatingAgentExecution: {
			...source,
			model: targetModelKey,
			apiStyle: cutover.apiStyle,
		},
		workflowAgentModelCutovers: [
			...priorLedger,
			{
				protocolVersion: "tapcanvas.workflow-agent-model-cutover/v1",
				from: source,
				to: { ...source, model: targetModelKey, apiStyle: cutover.apiStyle },
				authorizedBy,
				authorizationSource: cutover.authorizationSource,
				requestedAt: cutover.requestedAt,
				reason: "explicit_model_cutover",
			},
		],
	};
}
