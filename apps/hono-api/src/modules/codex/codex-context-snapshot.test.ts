import { describe, expect, it } from "vitest";
import type { CodexCanvasScope } from "@tapcanvas/codex-task-protocol";
import {
	assembleCodexCanvasContextSnapshot,
	CodexCanvasContextSnapshotError,
} from "./codex-context-snapshot";
import { CodexCanvasScopeSchema } from "./codex.schemas";

const scope: CodexCanvasScope = {
	projectId: "project-1",
	flowId: "flow-1",
	chapterId: null,
	canvasRevision: 7,
	selectedNodeIds: ["node-2"],
};

function assemble(input: {
	scope?: CodexCanvasScope;
	nodes?: unknown[];
}) {
	return assembleCodexCanvasContextSnapshot({
		project: { id: "project-1", name: "Project One" },
		scope: input.scope ?? scope,
		source: {
			graph: {
				nodes: input.nodes ?? [
					{ id: "node-1", type: "text", data: { text: "Brief" } },
					{
						id: "node-2",
						type: "generic",
						data: { kind: "image", prompt: "A real canvas prompt" },
					},
				],
				edges: [{ id: "edge-1", source: "node-1", target: "node-2" }],
				viewport: { x: 12, y: 24, zoom: 1.5 },
			},
			flowName: "Flow One",
			canvasRevision: 7,
		},
		snapshotId: "snapshot-fixed",
		createdAt: "2026-07-31T08:00:00.000Z",
	});
}

describe("assembleCodexCanvasContextSnapshot", () => {
	it("keeps the complete graph and derives selected node facts server-side", () => {
		const snapshot = assemble({});

		expect(snapshot.graph.nodes).toHaveLength(2);
		expect(snapshot.graph.edges).toHaveLength(1);
		expect(snapshot.selectedNodeKinds).toEqual(["image"]);
		expect(snapshot.selectedNodes).toEqual([
			{
				id: "node-2",
				type: "generic",
				data: { kind: "image", prompt: "A real canvas prompt" },
			},
		]);
		expect(snapshot.sha256).toMatch(/^[a-f0-9]{64}$/u);
		expect(assemble({}).sha256).toBe(snapshot.sha256);
	});

	it("rejects stale or duplicate browser selection instead of guessing", () => {
		for (const selectedNodeIds of [
			["missing-node"],
			["node-2", "node-2"],
		]) {
			try {
				assemble({ scope: { ...scope, selectedNodeIds } });
				throw new Error("expected context assembly to fail");
			} catch (error: unknown) {
				expect(error).toBeInstanceOf(CodexCanvasContextSnapshotError);
				if (!(error instanceof CodexCanvasContextSnapshotError)) throw error;
				expect([
					"codex_canvas_selection_stale",
					"codex_canvas_selection_invalid",
				]).toContain(error.code);
			}
		}
	});

	it("fails explicitly when the immutable snapshot exceeds the hard limit", () => {
		try {
			assemble({
				scope: { ...scope, selectedNodeIds: ["node-large"] },
				nodes: [{
					id: "node-large",
					type: "text",
					data: { text: "x".repeat(2 * 1024 * 1024) },
				}],
			});
			throw new Error("expected oversized context to fail");
		} catch (error: unknown) {
			expect(error).toBeInstanceOf(CodexCanvasContextSnapshotError);
			if (!(error instanceof CodexCanvasContextSnapshotError)) throw error;
			expect(error.code).toBe("codex_canvas_context_too_large");
			expect(error.status).toBe(413);
		}
	});
});

describe("CodexCanvasScopeSchema", () => {
	it("requires a confirmed revision for canvas scope", () => {
		expect(CodexCanvasScopeSchema.safeParse({
			...scope,
			canvasRevision: null,
		}).success).toBe(false);
		expect(CodexCanvasScopeSchema.safeParse(scope).success).toBe(true);
	});

	it("rejects canvas-only facts from a project-level scope", () => {
		expect(CodexCanvasScopeSchema.safeParse({
			...scope,
			flowId: null,
			canvasRevision: 7,
		}).success).toBe(false);
		expect(CodexCanvasScopeSchema.safeParse({
			...scope,
			flowId: null,
			canvasRevision: null,
		}).success).toBe(false);
		expect(CodexCanvasScopeSchema.safeParse({
			...scope,
			flowId: null,
			canvasRevision: null,
			selectedNodeIds: [],
		}).success).toBe(true);
	});
});
