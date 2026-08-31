import { buildVideoWorkflowCanvasDefinitionPatch } from "../src/canvas/videoWorkflowCanvasTemplate.ts";

type FlowEnvelope = Readonly<{
	data: Readonly<{
		data: Readonly<{
			nodes: readonly Readonly<Record<string, unknown>>[];
			edges: readonly Readonly<Record<string, unknown>>[];
		}>;
	}>;
}>;

let input = "";
for await (const chunk of process.stdin) input += String(chunk);
const flow = (JSON.parse(input) as FlowEnvelope).data.data;
const group = flow.nodes.find((node) => {
	const data = node.data as Readonly<Record<string, unknown>> | undefined;
	return node.type === "groupNode" && data?.workflowKey === "one-click-production/v1";
});
if (!group) throw new Error("Current flow has no one-click-production workflow group");
const data = group.data as Readonly<Record<string, unknown>>;
const workflowInstanceId = String(data.workflowInstanceId ?? "").trim();
const workflowGroupId = String(group.id ?? "").trim();
const executionScope = data.workflowExecutionScope;
const executionVariant = data.workflowExecutionVariant;
if (executionScope !== "prompt_only" && executionScope !== "media_delivery") {
	throw new Error("Current workflow group has no valid execution scope");
}
if (executionVariant !== "full_video" && executionVariant !== "first_video") {
	throw new Error("Current workflow group has no valid execution variant");
}
const patch = buildVideoWorkflowCanvasDefinitionPatch({
	workflowInstanceId,
	workflowGroupId,
	executionScope,
	executionVariant,
	existingNodes: flow.nodes.map((node) => ({
		id: String(node.id ?? ""),
		parentId: typeof node.parentId === "string" ? node.parentId : null,
	})),
	existingEdges: flow.edges.map((edge) => ({
		id: typeof edge.id === "string" ? edge.id : undefined,
		source: String(edge.source ?? ""),
		target: String(edge.target ?? ""),
		sourceHandle: typeof edge.sourceHandle === "string" ? edge.sourceHandle : null,
		targetHandle: typeof edge.targetHandle === "string" ? edge.targetHandle : null,
	})),
});
process.stdout.write(JSON.stringify(patch));
