import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { executeRegisteredWorkflowNode } from "../execution/execution.node-executors";
import type { WorkflowNodeSnapshot } from "../execution/execution.node-runtime";
import { buildWorkflowCapabilityDescriptor } from "./capability-bay.descriptor";
import {
	BUILTIN_GREETING_WORKFLOW,
	createBuiltInGreetingWorkflowDefinition,
	syncBuiltInGreetingWorkflow,
} from "./system-greeting-workflow";

describe("built-in greeting workflow", () => {
	it("publishes an enabled all-users attachment when a fresh deployment starts with an empty database", async () => {
		const projectCreate = vi.fn();
		const flowCreate = vi.fn();
		const versionCreate = vi.fn();
		const attachmentCreate = vi.fn();
		const transactionDatabase = {
			projects: { create: projectCreate, update: vi.fn() },
			flows: { create: flowCreate, update: vi.fn() },
			flow_versions: { create: versionCreate },
			agent_capability_attachments: { create: attachmentCreate, update: vi.fn() },
		};
		const database = {
			projects: { findUnique: vi.fn().mockResolvedValue(null) },
			flows: { findUnique: vi.fn().mockResolvedValue(null) },
			flow_versions: { findUnique: vi.fn().mockResolvedValue(null) },
			agent_capability_attachments: {
				findUnique: vi.fn().mockResolvedValue(null),
				findFirst: vi.fn().mockResolvedValue(null),
			},
			$transaction: vi.fn(async (
				operation: (transaction: typeof transactionDatabase) => Promise<unknown>,
			) => operation(transactionDatabase)),
		};

		await syncBuiltInGreetingWorkflow(database as unknown as PrismaClient, "bootstrap-admin");

		expect(projectCreate).toHaveBeenCalledWith(expect.objectContaining({
			data: expect.objectContaining({ id: BUILTIN_GREETING_WORKFLOW.projectId, owner_id: "bootstrap-admin" }),
		}));
		expect(flowCreate).toHaveBeenCalledWith(expect.objectContaining({
			data: expect.objectContaining({ id: BUILTIN_GREETING_WORKFLOW.flowId, owner_id: "bootstrap-admin" }),
		}));
		expect(versionCreate).toHaveBeenCalledWith(expect.objectContaining({
			data: expect.objectContaining({ id: BUILTIN_GREETING_WORKFLOW.flowVersionId, user_id: "bootstrap-admin" }),
		}));
		expect(attachmentCreate).toHaveBeenCalledWith(expect.objectContaining({
			data: expect.objectContaining({
				id: BUILTIN_GREETING_WORKFLOW.attachmentId,
				user_id: "bootstrap-admin",
				scope: "all_users",
				route_decisions_json: "[]",
			}),
		}));
	});

	it("materializes a deterministic text artifact and standard workflow output", () => {
		expect(BUILTIN_GREETING_WORKFLOW.id).toBe("tapcanvas.builtin.greeting-fixed-reply/v1");
		expect(BUILTIN_GREETING_WORKFLOW.flowVersionId).toBe("00000000-0000-4000-8000-000000000105");
		const definition = createBuiltInGreetingWorkflowDefinition();
		const data = JSON.parse(definition.flowData) as {
			nodes: Array<{ id: string; data: Record<string, unknown> }>;
			edges: Array<{ source: string; target: string }>;
		};
		const byId = new Map(data.nodes.map((node) => [node.id, node.data]));
		expect(byId.get(BUILTIN_GREETING_WORKFLOW.textNodeId)).toMatchObject({
			workflowTextInput: "我是你爹",
			workflowAtomicSpec: { executorRef: "workflow.input.text/v1" },
		});
		expect(byId.get(BUILTIN_GREETING_WORKFLOW.outputNodeId)).toMatchObject({
			kind: "workflowOutput",
			workflowAtomicSpec: { executorRef: "workflow.output/v1" },
		});
		expect(data.nodes.some((node) => (node.data.workflowAtomicSpec as { executorRef?: unknown } | undefined)?.executorRef === "workflow.script.javascript/v1")).toBe(false);
		expect(data.edges).toHaveLength(2);
	});

	it("publishes semantic invocation evidence without a local greeting router", () => {
		const definition = createBuiltInGreetingWorkflowDefinition();
		const descriptor = buildWorkflowCapabilityDescriptor({
			flow: {
				id: BUILTIN_GREETING_WORKFLOW.flowId,
				name: definition.flowName,
				data: definition.flowData,
				project_id: BUILTIN_GREETING_WORKFLOW.projectId,
				canvas_revision: 0,
			},
			version: { id: BUILTIN_GREETING_WORKFLOW.flowVersionId, data: definition.flowData },
		});
		expect(descriptor.invocation).toEqual({ sourceMode: "none", requiredTriggerPayloadFields: [] });
		expect(descriptor.summary).toContain("简短打招呼");
		expect(descriptor.operations).toEqual(["text_input"]);
		expect(descriptor.sideEffects).toEqual(["none"]);
	});

	it("executes the built-in nodes into the exact fixed reply", async () => {
		const definition = createBuiltInGreetingWorkflowDefinition();
		const data = JSON.parse(definition.flowData) as {
			nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
		};
		const nodeSnapshot = (id: string): WorkflowNodeSnapshot => {
			const stored = data.nodes.find((node) => node.id === id);
			if (!stored) throw new Error(`Missing built-in workflow node ${id}`);
			return { id: stored.id, type: stored.type, kind: "workflowStage", data: stored.data };
		};
		const context = (node: WorkflowNodeSnapshot, inputs: Record<string, readonly unknown[]> = {}) => ({
			executionId: "builtin-greeting-execution",
			executionFamilyId: "builtin-greeting-family",
			ownerId: "tapcanvas_admin",
			flowId: BUILTIN_GREETING_WORKFLOW.flowId,
			flowVersionId: BUILTIN_GREETING_WORKFLOW.flowVersionId,
			projectId: BUILTIN_GREETING_WORKFLOW.projectId,
			workflowKey: BUILTIN_GREETING_WORKFLOW.id,
			node,
			inputs,
			inputProvenance: [],
		});
		const dependencies = { runAgent: vi.fn(), runJavascript: vi.fn(), runVideo: vi.fn() };
		const textResult = await executeRegisteredWorkflowNode(
			context(nodeSnapshot(BUILTIN_GREETING_WORKFLOW.textNodeId)),
			dependencies,
		);
		expect(textResult).toMatchObject({
			ok: true,
			outputRefs: {
				ports: { text: BUILTIN_GREETING_WORKFLOW.reply },
				artifacts: [{ type: "tapcanvas.text/v1", value: BUILTIN_GREETING_WORKFLOW.reply }],
			},
		});
		if (!textResult.ok) throw new Error("Expected built-in text node to succeed");
		const outputResult = await executeRegisteredWorkflowNode(
			context(nodeSnapshot(BUILTIN_GREETING_WORKFLOW.outputNodeId), {
				text: [textResult.outputRefs.ports.text],
			}),
			dependencies,
		);
		expect(outputResult).toMatchObject({
			ok: true,
			outputRefs: {
				ports: {
					output: { text: [BUILTIN_GREETING_WORKFLOW.reply] },
				},
			},
		});
		expect(dependencies.runAgent).not.toHaveBeenCalled();
		expect(dependencies.runJavascript).not.toHaveBeenCalled();
		expect(dependencies.runVideo).not.toHaveBeenCalled();
	});
});
