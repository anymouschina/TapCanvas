import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { WorkerEnv } from "../../types";
import { buildWorkflowCapabilityDescriptor } from "./capability-bay.descriptor";
import { builtInOneClickWorkflowSql } from "./system-one-click-workflow";
import { BUILTIN_ONE_CLICK_WORKFLOW as identity, createBuiltInOneClickWorkflowDefinition, ONE_CLICK_VIDEO_NODES_SCRIPT } from "./system-one-click-workflow.definition";
import { compileWorkflowGraph } from "../execution/execution.recovery";
import { executeRegisteredWorkflowNode } from "../execution/execution.node-executors";
import type { WorkflowNodeSnapshot } from "../execution/execution.node-runtime";
import { runLocalWorkflowJavascript } from "../execution/execution.javascript-runner";
import { PublicFlowPatchRequestSchema } from "../flow/flow.public.schemas";
import { applyPublicFlowGraphPatch } from "../flow/flow.public.service";

const group = { id: "caller-group", type: "groupNode", position: { x: 0, y: 0 }, data: { label: "原文" }, style: { width: 500, height: 400 } };
const source = (text: string) => ({ id: "caller-text", type: "taskNode", parentId: group.id, position: { x: 0, y: 0 }, data: { kind: "text", content: text } });
const facts = (text: string, segmentCharLength?: unknown) => ({
	flowId: "caller-flow", groupId: group.id, group, children: [source(text)],
	callConfig: { sourceGroupId: group.id, ...(segmentCharLength !== undefined ? { segmentCharLength } : {}) },
});
const runJavascript = (request: { code: string; input: unknown }) => runLocalWorkflowJavascript({ WORKFLOW_LOCAL_JAVASCRIPT_ENABLED: "true" } as WorkerEnv, request);
const split = async (text: string, segmentCharLength?: unknown) => PublicFlowPatchRequestSchema.parse((await runJavascript({ code: ONE_CLICK_VIDEO_NODES_SCRIPT, input: facts(text, segmentCharLength) })).output);

describe("system one-click video nodes v1", () => {
	it("exports exactly the SQL used at startup, with no dependency on a private user flow", () => {
		expect(readFileSync("sql/releases/20260908_one_click_video_nodes_v1.sql", "utf8")).toBe(builtInOneClickWorkflowSql());
	});
	it("compiles the five-node graph and publishes a non-paid skill-free capability", () => {
		const definition = createBuiltInOneClickWorkflowDefinition();
		const graph = JSON.parse(definition.flowData) as Parameters<typeof compileWorkflowGraph>[0];
		expect(() => compileWorkflowGraph(graph)).not.toThrow();
		const descriptor = buildWorkflowCapabilityDescriptor({ flow: { id: identity.flowId, name: definition.flowName, data: definition.flowData, project_id: identity.projectId, canvas_revision: 0 }, version: { id: identity.flowVersionId, data: definition.flowData } });
		expect(descriptor.requiredSkills).toEqual([]);
		expect(descriptor.requiredTools).toEqual(["tapcanvas_flow_patch"]);
		expect(descriptor.sideEffects).toEqual(["external_mutation"]);
		expect(descriptor.invocation).toEqual({ sourceMode: "canvas_group", requiredTriggerPayloadFields: ["sourceGroupId"] });
		expect(descriptor.operations).toEqual(["canvas_source", "javascript", "tool_invocation"]);
	});
	it("preserves Unicode, whitespace, the short last segment and sources exceeding ten nodes", async () => {
		const text = " 开场🙂\n" + "甲".repeat(1300) + "尾";
		const patch = await split(text);
		const prompts = (patch.createNodes ?? []).map(node => String(node.data.prompt));
		expect(prompts.length).toBeGreaterThan(10);
		expect(prompts.join("")).toBe(text);
		expect(prompts.slice(0, -1).every(prompt => Array.from(prompt).length === 120)).toBe(true);
		expect(Array.from(prompts.at(-1) ?? "").length).toBeLessThan(120);
		expect(patch.createNodes?.every(node => node.data.kind === "video" && node.data.status === "idle")).toBe(true);
	});
	it("uses explicit character length without padding or a model selection", async () => {
		const patch = await split("甲🙂乙", 2);
		expect(patch.createNodes?.map(node => node.data.prompt)).toEqual(["甲🙂", "乙"]);
		expect(patch.createNodes?.every(node => !Object.hasOwn(node.data, "model"))).toBe(true);
	});
	it.each([0, -1, 1.5, "120", 10001])("rejects invalid character length %s", async length => {
		await expect(split("原文", length)).rejects.toThrow("segmentCharLength");
	});
	it("rejects an empty source before writing any node", async () => {
		await expect(split(" \n")).rejects.toThrow("文本来源为空");
	});
	it("executes source, split, canvas write and output in caller scope without Agent or media calls", async () => {
		const definition = createBuiltInOneClickWorkflowDefinition();
		const graph = JSON.parse(definition.flowData) as { nodes: Array<{ id: string; type: string; data: Record<string, unknown> }> };
		const snapshot = (id: string): WorkflowNodeSnapshot => {
			const node = graph.nodes.find(candidate => candidate.id === `builtin-one-click-v1:${id}`);
			if (!node) throw new Error("Missing workflow node");
			return { ...node, kind: String(node.data.kind) };
		};
		const text = "甲".repeat(121);
		const current = { nodes: [group, source(text)], edges: [] };
		const invokeTool = vi.fn(async (request: { args: Record<string, unknown> }) => {
			const patch = PublicFlowPatchRequestSchema.parse(request.args);
			const applied = applyPublicFlowGraphPatch({ current, patch });
			const parsedNodes = applied.data.nodes as Array<{ id: string; data: Record<string, unknown> }>;
			const createdNodeSnapshots = parsedNodes.filter(node => node.data.kind === "video");
			expect(createdNodeSnapshots).toHaveLength(2);
			expect(parsedNodes.find(node => node.id === "caller-text")?.data.content).toBe(text);
			return { toolName: "tapcanvas_flow_patch", content: "保存成功", data: { createdNodeSnapshots }, execution: null };
		});
		const dependencies = { runAgent: vi.fn(), runVideo: vi.fn(), runJavascript, invokeTool, readCanvasGroupFromFlow: vi.fn(async () => facts(text)) };
		const execute = (id: string, inputs: Record<string, readonly unknown[]>) => executeRegisteredWorkflowNode({
			executionId: "execution-1", executionFamilyId: "family-1", ownerId: "new-user", flowId: identity.flowId, flowVersionId: identity.flowVersionId, projectId: identity.projectId, workflowKey: identity.id,
			node: snapshot(id), inputs, inputProvenance: [], flowVersionData: { workflowDeliveryScope: { flowId: "caller-flow", projectId: "caller-project" } },
		}, dependencies);
		const sourceResult = await execute("source", { trigger: [{ sourceGroupId: group.id }] });
		if (!sourceResult.ok) throw new Error("errorMessage" in sourceResult ? sourceResult.errorMessage : "Unexpected external wait");
		const splitResult = await execute("split", { input: [sourceResult.outputRefs.ports["canvas-facts"]] });
		if (!splitResult.ok) throw new Error("errorMessage" in splitResult ? splitResult.errorMessage : "Unexpected external wait");
		const writeResult = await execute("write", { arguments: [splitResult.outputRefs.ports.result] });
		if (!writeResult.ok) throw new Error("errorMessage" in writeResult ? writeResult.errorMessage : "Unexpected external wait");
		const outputResult = await execute("output", { input: [writeResult.outputRefs.ports.result] });
		expect(outputResult.ok).toBe(true);
		expect(invokeTool).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "new-user", flowId: "caller-flow", projectId: "caller-project", toolName: "tapcanvas_flow_patch" }));
		expect(dependencies.runAgent).not.toHaveBeenCalled();
		expect(dependencies.runVideo).not.toHaveBeenCalled();
	});
	it("refuses to overwrite nodes and assets on a repeated request", async () => {
		const patch = await split("原文");
		const first = applyPublicFlowGraphPatch({ current: { nodes: [group, source("原文")], edges: [] }, patch });
		expect(() => applyPublicFlowGraphPatch({ current: first.data, patch })).toThrow("createNodes 节点已存在");
	});
});
