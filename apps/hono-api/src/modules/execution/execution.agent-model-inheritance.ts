export type WorkflowInitiatingAgentExecution = Readonly<{
	model: string;
	apiStyle: "chat" | "responses";
}>;

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
	return { model, apiStyle };
}

export function resolveWorkflowAgentModelKey(input: Readonly<{
	flowVersionData: unknown;
	configuredModelKey?: string | null;
}>): string {
	return parseWorkflowInitiatingAgentExecution(input.flowVersionData)?.model
		?? input.configuredModelKey?.trim()
		?? "";
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
			model: targetModelKey,
			apiStyle: cutover.apiStyle,
		},
		workflowAgentModelCutovers: [
			...priorLedger,
			{
				protocolVersion: "tapcanvas.workflow-agent-model-cutover/v1",
				from: source,
				to: { model: targetModelKey, apiStyle: cutover.apiStyle },
				authorizedBy,
				authorizationSource: cutover.authorizationSource,
				requestedAt: cutover.requestedAt,
				reason: "explicit_model_cutover",
			},
		],
	};
}
