import type { WorkerEnv } from "../../types";
import { buildInternalApiKey } from "../apiKey/internal-api-key";
import { buildAgentsBridgeRemoteTools } from "../task/task.agents-bridge";
import { validateWorkflowToolArguments } from "./execution.json-schema-validator";

export type WorkflowToolInvocationRequest = Readonly<{
	executionId: string;
	nodeId: string;
	ownerId: string;
	projectId: string | null;
	flowId: string;
	chapterId?: string | null;
	toolName: string;
	args: Record<string, unknown>;
}>;

export type WorkflowToolInvocationResult = Readonly<{
	toolName: string;
	content: string;
	data: Record<string, unknown> | null;
	execution: Record<string, unknown> | null;
}>;

function internalBaseUrl(env: WorkerEnv): string {
	const value = String(env.TAPCANVAS_API_INTERNAL_BASE ?? env.TAPCANVAS_API_BASE_URL ?? "").trim().replace(/\/+$/u, "");
	if (!value) throw new Error("Workflow Tool Invocation requires TAPCANVAS_API_INTERNAL_BASE");
	return value;
}

export async function invokeWorkflowTool(env: WorkerEnv, request: WorkflowToolInvocationRequest): Promise<WorkflowToolInvocationResult> {
	const tool = buildAgentsBridgeRemoteTools({
		publicAgentsRequest: true,
		canvasProjectId: request.projectId,
		canvasFlowId: request.flowId,
		chapterId: request.chapterId,
		executionId: request.executionId,
		adminWorkflowAccess: true,
	}).find((candidate) => candidate.name === request.toolName);
	if (!tool || !tool.parameters) {
		throw new Error(`Workflow tool '${request.toolName}' is not authorized in the current project/flow scope`);
	}
	const issues = validateWorkflowToolArguments(tool.parameters as Record<string, unknown>, request.args);
	if (issues.length > 0) {
		throw new Error(`Workflow tool arguments violate the registered schema: ${issues.map((issue) => issue.message).join("; ")}`);
	}
	const apiKey = buildInternalApiKey({
		internalWorkerToken: String(env.INTERNAL_WORKER_TOKEN ?? ""),
		userId: request.ownerId,
	});
	if (!apiKey) throw new Error("Workflow Tool Invocation requires INTERNAL_WORKER_TOKEN");
	const response = await fetch(`${internalBaseUrl(env)}/public/agents/tools/execute`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
		body: JSON.stringify({
			toolName: request.toolName,
			args: request.args,
			toolCallId: `workflow:${request.executionId}:${request.nodeId}`.slice(0, 160),
			...(request.projectId ? { canvasProjectId: request.projectId } : {}),
			canvasFlowId: request.flowId,
			...(request.chapterId ? { chapterId: request.chapterId } : {}),
			executionId: request.executionId,
		}),
	});
	const raw = await response.text();
	let payload: unknown;
	try {
		payload = raw.trim() ? JSON.parse(raw) as unknown : null;
	} catch {
		throw new Error(`Workflow tool '${request.toolName}' returned invalid JSON (${response.status})`);
	}
	if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new Error(`Workflow tool '${request.toolName}' failed (${response.status})${raw.trim() ? `: ${raw.slice(0, 500)}` : ""}`);
	}
	const result = payload as Record<string, unknown>;
	if (result.ok !== true || typeof result.content !== "string") {
		throw new Error(`Workflow tool '${request.toolName}' returned an invalid execution receipt`);
	}
	return {
		toolName: request.toolName,
		content: result.content,
		data: result.data && typeof result.data === "object" && !Array.isArray(result.data) ? result.data as Record<string, unknown> : null,
		execution: tool.execution ? tool.execution as unknown as Record<string, unknown> : null,
	};
}
