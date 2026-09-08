import type { WorkflowAtomicNodeSpecV1 } from "@tapcanvas/workflow-kernel-protocol";

export const BUILTIN_ONE_CLICK_WORKFLOW = Object.freeze({
	id: "tapcanvas.builtin.one-click-video-nodes/v1",
	projectId: "00000000-0000-4000-8000-000000000111",
	flowId: "00000000-0000-4000-8000-000000000112",
	flowVersionId: "00000000-0000-4000-8000-000000000113",
	attachmentId: "00000000-0000-4000-8000-000000000114",
	releasedAt: "2026-09-08T00:00:00.000Z",
});

// Authored deterministic workflow code, executed by the existing isolated JS
// executor. Character slicing does not interpret, rewrite, or pad the story.
export const ONE_CLICK_VIDEO_NODES_SCRIPT = String.raw`
if (!input || !input.group || !Array.isArray(input.children)) {
  throw new Error("一键成片v1：缺少当前画布组及其真实子节点");
}
const charLength = input.callConfig?.segmentCharLength ?? 120;
if (!Number.isSafeInteger(charLength) || charLength < 1 || charLength > 10000) {
  throw new Error("一键成片v1：segmentCharLength 必须是 1 到 10000 的整数");
}
const sources = input.children.filter(node =>
  node.data && ["text", "novelDoc", "storyboardScript"].includes(node.data.kind)
);
if (sources.length === 0) throw new Error("一键成片v1：当前组没有文本来源节点");
const createNodes = [];
for (const source of sources) {
  if (typeof source.id !== "string" || !source.id) throw new Error("文本来源缺少节点身份");
  const text = [source.data.chapterText, source.data.content, source.data.prompt]
    .find(value => typeof value === "string" && value.trim().length > 0);
  if (text === undefined) throw new Error("文本来源为空：" + source.id);
  const characters = Array.from(text);
  for (let offset = 0; offset < characters.length; offset += charLength) {
    const prompt = characters.slice(offset, offset + charLength).join("");
    const index = createNodes.length;
    createNodes.push({
      id: "one-click-v1:" + encodeURIComponent(source.id) + ":" + charLength + ":" + offset,
      type: "taskNode",
      position: { x: 0, y: index * 360 },
      parentId: input.groupId,
      data: {
        kind: "video",
        label: "视频 " + (index + 1),
        prompt,
        status: "idle",
        sourceNodeId: source.id,
        sourceCharStart: offset,
        sourceCharEnd: offset + Array.from(prompt).length,
        segmentIndex: index,
        segmentCharLength: charLength
      }
    });
  }
}
// Position after existing content in the same source group, without modifying it.
const right = Math.max(0, ...input.children.map(node =>
  (typeof node.position?.x === "number" ? node.position.x : 0) +
  (typeof node.width === "number" ? node.width : 420)
));
for (const node of createNodes) node.position.x = right + 80;
return { allowOverwrite: false, createNodes };
`.trim();

type Stage = Readonly<{
	id: string;
	label: string;
	spec: WorkflowAtomicNodeSpecV1;
	outputArtifactType?: string;
	data?: Readonly<Record<string, unknown>>;
}>;

export function createBuiltInOneClickWorkflowDefinition() {
	const identity = BUILTIN_ONE_CLICK_WORKFLOW;
	const summary = "一键成片v1：读取调用者当前画布的指定文本组，按每段120个Unicode字符拆分原文（triggerPayload.segmentCharLength可显式调整），末段完整保留；每段创建一个带原文prompt的待生成视频节点并写入该画布组。交付为视频节点，不生成媒体、不调用Skill或知识库。sourceGroupId必须来自调用者真实画布；创建完成后以工具返回的节点快照核对交付。";
	const stages: readonly Stage[] = [
		{ id: "source", label: "读取文本组", spec: { version: 1, category: "source", operation: "canvas_source", executorRef: "tapcanvas.canvas.group.read/v1", executionMode: "once", inputPorts: ["trigger"], outputPorts: ["canvas-facts"], }, outputArtifactType: "tapcanvas.canvas-facts/v1", data: { workflowSourceMode: "canvas_group" } },
		{ id: "split", label: "按字长拆分视频节点", spec: { version: 1, category: "control", operation: "javascript", executorRef: "workflow.script.javascript/v1", executionMode: "once", inputPorts: ["input"], outputPorts: ["result"], }, outputArtifactType: "tapcanvas.json/v1", data: { workflowJavascriptCode: ONE_CLICK_VIDEO_NODES_SCRIPT } },
		{ id: "write", label: "添加到当前画布", spec: { version: 1, category: "tool", operation: "tool_invocation", executorRef: "agents.tool.invoke/v1", executionMode: "once", inputPorts: ["arguments"], outputPorts: ["result"], }, outputArtifactType: "workflow.tool-result/v1", data: { workflowToolInvocationName: "tapcanvas_flow_patch", workflowToolId: "tapcanvas_flow_patch" } },
		{ id: "output", label: "视频节点交付记录", spec: { version: 1, category: "control", operation: "output", executorRef: "workflow.output/v1", executionMode: "once", inputPorts: ["input"], outputPorts: ["output"] } },
	];
	const common = { workflowKey: identity.id, workflowInstanceId: identity.id, workflowDefinitionVersion: 1, workflowPermission: "admin", adminWorkflow: true, status: "idle" };
	const nodeId = (id: string) => `builtin-one-click-v1:${id}`;
	const nodes = [
		{ id: nodeId("trigger"), type: "taskNode", position: { x: 0, y: 0 }, data: { ...common, kind: "workflowTrigger", label: "一键成片v1", workflowTriggerSpec: { version: 1, kind: "manual" }, workflowOutputPorts: ["trigger"], workflowCapabilityDescription: summary } },
		...stages.map((stage, index) => ({
			id: nodeId(stage.id), type: "taskNode", position: { x: (index + 1) * 240, y: 0 },
			data: { ...common, kind: stage.id === "output" ? "workflowOutput" : "workflowStage", label: stage.label, description: stage.label, workflowNodeId: stage.id, workflowNodeKind: stage.spec.operation, workflowAtomicSpec: stage.spec, workflowInputPorts: stage.spec.inputPorts, workflowOutputPorts: stage.spec.outputPorts, workflowOutputArtifactType: stage.outputArtifactType, ...stage.data },
		})),
	];
	const connections = [
		["trigger", "trigger", "source", "trigger"],
		["source", "canvas-facts", "split", "input"],
		["split", "result", "write", "arguments"],
		["write", "result", "output", "input"],
	] as const;
	const edges = connections.map(([source, sourcePort, target, targetPort]) => ({
		id: `builtin-one-click-v1:${source}:${target}`, source: nodeId(source), target: nodeId(target),
		sourceHandle: `out-workflow:${sourcePort}`, targetHandle: `in-workflow:${targetPort}`,
	}));
	return {
		projectName: "一键成片v1 · 系统工作流", flowName: "一键成片v1",
		flowData: JSON.stringify({ nodes, edges, viewport: { x: 0, y: 0, zoom: 1 }, builtinWorkflowId: identity.id, __tapcanvasFlowOwner: { ownerType: "project", ownerId: identity.projectId } }),
	};
}
