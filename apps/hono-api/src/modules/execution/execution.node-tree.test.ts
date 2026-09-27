import { describe, expect, it } from "vitest";
import { flattenWorkflowNodeTree, mapWorkflowNodeTreeScopes } from "./execution.node-tree";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function node(id: string, workflowPipeline?: Record<string, unknown>): Record<string, unknown> {
	return {
		id,
		data: workflowPipeline ? { workflowPipeline } : {},
	};
}

function pipeline(...nodes: Record<string, unknown>[]): Record<string, unknown> {
	return {
		protocolVersion: "workflow.pipeline.run/v1",
		steps: nodes.map((stepNode) => ({ node: stepNode })),
	};
}

describe("workflow inline node tree", () => {
	it("maps each pipeline's sibling scope while retaining the authored tree", () => {
		const authored = [node("root", pipeline(
			node("first"),
			node("inner", pipeline(node("nested-a"), node("nested-b"))),
		))];

		const mapped = mapWorkflowNodeTreeScopes(authored, (scopeNodes) => {
			const siblingIds = scopeNodes.flatMap((value) =>
				isRecord(value) && typeof value.id === "string" ? [value.id] : [],
			);
			return scopeNodes.map((value) => {
				if (!isRecord(value) || !isRecord(value.data)) return value;
				return { ...value, data: { ...value.data, siblingIds } };
			});
		});

		expect(flattenWorkflowNodeTree(mapped).map((item) => item.id)).toEqual([
			"root", "first", "inner", "nested-a", "nested-b",
		]);
		const rootPipeline = (mapped[0] as Record<string, unknown>).data as Record<string, unknown>;
		const steps = ((rootPipeline.workflowPipeline as Record<string, unknown>).steps as Array<Record<string, unknown>>);
		const innerPipeline = (steps[1]!.node as Record<string, unknown>).data as Record<string, unknown>;
		const nestedSteps = ((innerPipeline.workflowPipeline as Record<string, unknown>).steps as Array<Record<string, unknown>>);

		expect((steps[0]!.node as Record<string, unknown>).data).toMatchObject({ siblingIds: ["first", "inner"] });
		expect((steps[1]!.node as Record<string, unknown>).data).toMatchObject({ siblingIds: ["first", "inner"] });
		expect((nestedSteps[0]!.node as Record<string, unknown>).data).toMatchObject({ siblingIds: ["nested-a", "nested-b"] });
		expect((nestedSteps[1]!.node as Record<string, unknown>).data).toMatchObject({ siblingIds: ["nested-a", "nested-b"] });
	});
});
