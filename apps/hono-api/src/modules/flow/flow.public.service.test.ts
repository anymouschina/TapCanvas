import { describe, expect, it } from "vitest";
import { PublicFlowPatchRequestSchema } from "./flow.public.schemas";
import { applyPublicFlowGraphPatch } from "./flow.public.service";

describe("applyPublicFlowGraphPatch", () => {
	it("creates nodes and edges", () => {
		const current = { nodes: [], edges: [] };
		const out = applyPublicFlowGraphPatch({
			current,
			patch: {
				createNodes: [
					{
						id: "n1",
						type: "taskNode",
						position: { x: 120, y: 80 },
						data: { kind: "image", label: "A" },
					},
				],
				createEdges: [{ id: "e1", source: "n1", target: "n1" }],
				allowOverwrite: false,
			},
		});
		expect(out.data.nodes.length).toBe(1);
		expect(out.data.edges.length).toBe(1);
		expect(out.stats.createdNodes).toBe(1);
		expect(out.stats.createdEdges).toBe(1);
		expect(out.stats.deletedNodes).toBe(0);
		expect(out.stats.deletedEdges).toBe(0);
	});

	it("deletes nodes and cascades connected edges", () => {
		const current = {
			nodes: [
				{
					id: "n1",
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: { kind: "image", label: "A" },
				},
				{
					id: "n2",
					type: "taskNode",
					position: { x: 300, y: 0 },
					data: { kind: "image", label: "B" },
				},
			],
			edges: [{ id: "e1", source: "n1", target: "n2" }],
		};
		const parsed = PublicFlowPatchRequestSchema.parse({
			deleteNodeIds: ["n1"],
		});

		const out = applyPublicFlowGraphPatch({ current, patch: parsed });
		expect(out.data.nodes).toEqual([expect.objectContaining({ id: "n2" })]);
		expect(out.data.edges).toEqual([]);
		expect(out.stats.deletedNodes).toBe(1);
		expect(out.stats.deletedEdges).toBe(1);
	});

	it("deletes edges without touching nodes", () => {
		const current = {
			nodes: [
				{
					id: "n1",
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: { kind: "image", label: "A" },
				},
				{
					id: "n2",
					type: "taskNode",
					position: { x: 300, y: 0 },
					data: { kind: "image", label: "B" },
				},
			],
			edges: [{ id: "e1", source: "n1", target: "n2" }],
		};
		const parsed = PublicFlowPatchRequestSchema.parse({
			deleteEdgeIds: ["e1"],
		});

		const out = applyPublicFlowGraphPatch({ current, patch: parsed });
		expect(out.data.nodes).toHaveLength(2);
		expect(out.data.edges).toEqual([]);
		expect(out.stats.deletedNodes).toBe(0);
		expect(out.stats.deletedEdges).toBe(1);
	});

	it("fails explicitly when deleteNodeIds references a missing node", () => {
		const parsed = PublicFlowPatchRequestSchema.parse({
			deleteNodeIds: ["missing-node"],
		});

		expect(() =>
			applyPublicFlowGraphPatch({ current: { nodes: [], edges: [] }, patch: parsed }),
		).toThrow(/deleteNodeIds 节点不存在/i);
	});

	it("fails explicitly when deleteEdgeIds references a missing edge", () => {
		const parsed = PublicFlowPatchRequestSchema.parse({
			deleteEdgeIds: ["missing-edge"],
		});

		expect(() =>
			applyPublicFlowGraphPatch({ current: { nodes: [], edges: [] }, patch: parsed }),
		).toThrow(/deleteEdgeIds 边不存在/i);
	});

	it("accepts structured createEdges payload with handles", () => {
		const parsed = PublicFlowPatchRequestSchema.parse({
			createNodes: [
				{
					id: "role-card-1",
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: { kind: "image", label: "角色卡" },
				},
				{
					id: "frame-2",
					type: "taskNode",
					position: { x: 320, y: 0 },
					data: { kind: "image", label: "第二帧" },
				},
			],
			createEdges: [
				{
					id: "edge-role-frame-2",
					source: "role-card-1",
					target: "frame-2",
					sourceHandle: "out-image",
					targetHandle: "in-image",
					type: "default",
				},
			],
		});
		const out = applyPublicFlowGraphPatch({ current: { nodes: [], edges: [] }, patch: parsed });
		expect(out.data.edges.length).toBe(1);
		expect(out.stats.createdEdges).toBe(1);
		expect(out.data.edges[0]).toMatchObject({
			id: "edge-role-frame-2",
			source: "role-card-1",
			target: "frame-2",
			sourceHandle: "out-image",
			targetHandle: "in-image",
			type: "default",
		});
	});

	it("rejects createEdges handles that do not exist in the real frontend protocol", () => {
		const parsed = PublicFlowPatchRequestSchema.parse({
			createNodes: [
				{
					id: "role-card-1",
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: { kind: "image", label: "角色卡" },
				},
				{
					id: "frame-2",
					type: "taskNode",
					position: { x: 320, y: 0 },
					data: { kind: "imageEdit", label: "第二帧" },
				},
			],
			createEdges: [
				{
					id: "edge-role-frame-2",
					source: "role-card-1",
					target: "frame-2",
					sourceHandle: "image",
					targetHandle: "reference",
				},
			],
		});

		expect(() =>
			applyPublicFlowGraphPatch({ current: { nodes: [], edges: [] }, patch: parsed }),
		).toThrow(/createEdges .*Handle 非法/i);
	});

	it("explains that same-batch edges cannot reference new nodes by label", () => {
		const parsed = PublicFlowPatchRequestSchema.parse({
			createNodes: [
				{
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: { kind: "image", label: "第一章-静帧01" },
				},
			],
			createEdges: [
				{
					source: "第一章-静帧01",
					target: "第一章-静帧01",
				},
			],
		});

		expect(() =>
			applyPublicFlowGraphPatch({ current: { nodes: [], edges: [] }, patch: parsed }),
		).toThrow(/显式提供稳定 id.*不能使用 label/i);
	});

	it("creates a blank text node with the real taskNode protocol", () => {
		const current = { nodes: [], edges: [] };
		const parsed = PublicFlowPatchRequestSchema.parse({
			createNodes: [
				{
					id: "text-1",
					type: "taskNode",
					position: { x: 584, y: 80 },
					data: {
						kind: "text",
						label: "",
						prompt: "",
						nodeWidth: 380,
						nodeHeight: 360,
					},
				},
			],
		});
		const out = applyPublicFlowGraphPatch({ current, patch: parsed });
		const node = out.data.nodes[0] as {
			type: string;
			data?: Record<string, unknown>;
		};
		expect(node.type).toBe("taskNode");
		expect(node.data?.kind).toBe("text");
		expect(node.data?.nodeWidth).toBe(380);
		expect(node.data?.nodeHeight).toBe(360);
	});

	it("reorders same-batch group writes parent-first and compacts child positions", () => {
		const parsed = PublicFlowPatchRequestSchema.parse({
			createNodes: [
				{
					id: "script-1",
					type: "taskNode",
					parentId: "group-1",
					position: { x: 2660, y: -2010 },
					data: {
						kind: "storyboardScript",
						label: "脚本",
						nodeWidth: 380,
						nodeHeight: 220,
					},
				},
				{
					id: "group-1",
					type: "groupNode",
					position: { x: 2620, y: -2060 },
					style: { width: 1980, height: 1180 },
					data: { label: "第三章 横屏短剧", isGroup: true },
				},
			],
		});

		const out = applyPublicFlowGraphPatch({ current: { nodes: [], edges: [] }, patch: parsed });
		const group = out.data.nodes.find((node) => {
			const record = node as { id?: string };
			return record.id === "group-1";
		}) as
			| {
					position?: { x?: number; y?: number };
					style?: { width?: number; height?: number };
			  }
			| undefined;
		const child = out.data.nodes.find((node) => {
			const record = node as { id?: string };
			return record.id === "script-1";
		}) as { position?: { x?: number; y?: number } } | undefined;

		expect((out.data.nodes[0] as { id?: string } | undefined)?.id).toBe("group-1");
		expect(group?.position).toEqual({ x: 2620, y: -2060 });
		expect(group?.style).toEqual({ width: 396, height: 236 });
		expect(child?.position).toEqual({ x: 8, y: 8 });
	});

	it("compacts grouped children by final node order when appending into an existing group", () => {
		const current = {
			nodes: [
				{
					id: "group-1",
					type: "groupNode",
					position: { x: 1000, y: 600 },
					style: { width: 800, height: 500 },
					data: { label: "group", isGroup: true },
				},
				{
					id: "image-0",
					type: "taskNode",
					parentId: "group-1",
					position: { x: 8, y: 8 },
					data: {
						kind: "image",
						label: "第一张",
						nodeWidth: 100,
						nodeHeight: 80,
					},
				},
			],
			edges: [],
		};
		const parsed = PublicFlowPatchRequestSchema.parse({
			createNodes: [
				{
					id: "image-1",
					type: "taskNode",
					parentId: "group-1",
					position: { x: 260, y: 48 },
					data: {
						kind: "image",
						label: "关键帧",
						nodeWidth: 100,
						nodeHeight: 80,
					},
				},
			],
		});

		const out = applyPublicFlowGraphPatch({ current, patch: parsed });
		const group = out.data.nodes.find((node) => {
			const record = node as { id?: string };
			return record.id === "group-1";
		}) as
			| {
					position?: { x?: number; y?: number };
					style?: { width?: number; height?: number };
			  }
			| undefined;
		const firstChild = out.data.nodes.find((node) => {
			const record = node as { id?: string };
			return record.id === "image-0";
		}) as { position?: { x?: number; y?: number } } | undefined;
		const secondChild = out.data.nodes.find((node) => {
			const record = node as { id?: string };
			return record.id === "image-1";
		}) as { position?: { x?: number; y?: number } } | undefined;

		expect(group?.position).toEqual({ x: 1000, y: 600 });
		expect(group?.style).toEqual({ width: 228, height: 96 });
		expect(firstChild?.position).toEqual({ x: 8, y: 8 });
		expect(secondChild?.position).toEqual({ x: 120, y: 8 });
	});

	it("patches node data without overwrite by default", () => {
		const current = { nodes: [{ id: "n1", data: { label: "A" } }], edges: [] };
		const out = applyPublicFlowGraphPatch({
			current,
			patch: {
				patchNodeData: [{ id: "n1", data: { workflowStage: "image_generation" } }],
			},
		});
		const node = out.data.nodes[0] as { id: string; data?: Record<string, unknown> };
		expect(node.id).toBe("n1");
		expect(node.data?.workflowStage).toBe("image_generation");
	});

	it("auto-wires matching reference image nodes for created visual nodes", () => {
		const current = {
			nodes: [
				{
					id: "ref-1",
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: {
						kind: "image",
						label: "角色卡",
						imageUrl: "https://example.com/assets/fangyuan.jpg?sig=abc",
					},
				},
			],
			edges: [],
		};
		const parsed = PublicFlowPatchRequestSchema.parse({
			createNodes: [
				{
					id: "frame-1",
					type: "taskNode",
					position: { x: 320, y: 0 },
					data: {
						kind: "image",
						label: "关键帧",
						prompt: "夜雨窗前",
						referenceImages: ["https://example.com/assets/fangyuan.jpg?sig=xyz"],
					},
				},
			],
		});

		const out = applyPublicFlowGraphPatch({ current, patch: parsed });
		const targetNode = out.data.nodes.find((node) => {
			const record = node as { id?: string };
			return record.id === "frame-1";
		}) as { data?: Record<string, unknown> } | undefined;

		expect(out.stats.createdEdges).toBe(1);
		expect(out.data.edges).toEqual([
			expect.objectContaining({
				source: "ref-1",
				target: "frame-1",
				sourceHandle: "out-image",
				targetHandle: "in-image",
			}),
		]);
	expect(targetNode?.data?.upstreamReferenceOrder).toEqual(["ref-1"]);
	});

	it("auto-wires matching anchorBindings image urls for created visual nodes", () => {
		const current = {
			nodes: [
				{
					id: "ref-1",
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: {
						kind: "image",
						label: "场景锚点",
						imageUrl: "https://example.com/assets/qingmao-temple.jpg?sig=abc",
					},
				},
			],
			edges: [],
		};
		const parsed = PublicFlowPatchRequestSchema.parse({
			createNodes: [
				{
					id: "frame-2",
					type: "taskNode",
					position: { x: 320, y: 0 },
					data: {
						kind: "image",
						label: "宗祠镜头",
						prompt: "古月宗祠夜景",
						anchorBindings: [
							{
								kind: "scene",
								label: "古月宗祠",
								imageUrl: "https://example.com/assets/qingmao-temple.jpg?sig=xyz",
							},
						],
					},
				},
			],
		});

		const out = applyPublicFlowGraphPatch({ current, patch: parsed });
		const targetNode = out.data.nodes.find((node) => {
			const record = node as { id?: string };
			return record.id === "frame-2";
		}) as { data?: Record<string, unknown> } | undefined;

		expect(out.stats.createdEdges).toBe(1);
		expect(out.data.edges).toEqual([
			expect.objectContaining({
				source: "ref-1",
				target: "frame-2",
				sourceHandle: "out-image",
				targetHandle: "in-image",
			}),
		]);
		expect(targetNode?.data?.upstreamReferenceOrder).toEqual(["ref-1"]);
	});

	it("skips auto-wiring when one reference image matches multiple source nodes", () => {
		const current = {
			nodes: [
				{
					id: "ref-1",
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: {
						kind: "image",
						label: "角色卡-A",
						imageUrl: "https://example.com/assets/fangyuan.jpg",
					},
				},
				{
					id: "ref-2",
					type: "taskNode",
					position: { x: 0, y: 160 },
					data: {
						kind: "image",
						label: "角色卡-B",
						imageUrl: "https://example.com/assets/fangyuan.jpg",
					},
				},
			],
			edges: [],
		};
		const parsed = PublicFlowPatchRequestSchema.parse({
			createNodes: [
				{
					id: "frame-1",
					type: "taskNode",
					position: { x: 320, y: 0 },
					data: {
						kind: "image",
						label: "关键帧",
						prompt: "夜雨窗前",
						referenceImages: ["https://example.com/assets/fangyuan.jpg"],
					},
				},
			],
		});

		const out = applyPublicFlowGraphPatch({ current, patch: parsed });
		expect(out.stats.createdEdges).toBe(0);
		expect(out.data.edges).toEqual([]);
	});

	it("rejects overwriting existing keys when allowOverwrite=false", () => {
		const current = { nodes: [{ id: "n1", data: { label: "A" } }], edges: [] };
		expect(() =>
			applyPublicFlowGraphPatch({
				current,
				patch: {
					patchNodeData: [{ id: "n1", data: { label: "B" } }],
				},
			}),
		).toThrow(/覆盖既有字段/i);
	});

	it("appends node arrays", () => {
		const current = { nodes: [{ id: "n1", data: { logs: ["a"] } }], edges: [] };
		const out = applyPublicFlowGraphPatch({
			current,
			patch: {
				appendNodeArrays: [{ id: "n1", key: "logs", items: ["b", "c"] }],
			},
		});
		const node = out.data.nodes[0] as { data?: { logs?: unknown[] } };
		expect(Array.isArray(node.data?.logs)).toBe(true);
		expect(node.data?.logs).toEqual(["a", "b", "c"]);
		expect(out.stats.appendedArrays).toBe(2);
	});

	it("rejects invalid guessed node types in createNodes", () => {
		const invalidPatch = {
			createNodes: [
				{
					id: "text-blank-1",
					type: "textNode",
					position: { x: 584, y: 80 },
					data: {
						kind: "text",
						label: "",
					},
				},
			],
		} as unknown as Parameters<typeof applyPublicFlowGraphPatch>[0]["patch"];
		expect(() =>
			applyPublicFlowGraphPatch({
				current: { nodes: [], edges: [] },
				patch: invalidPatch,
			}),
		).toThrow(/仅支持前端真实节点协议/i);
	});
});

it("accepts singular patch aliases after schema normalization", () => {
	const parsed = PublicFlowPatchRequestSchema.parse({
		allowOverwrite: true,
		createNode: {
			id: "n2",
			type: "taskNode",
			position: { x: 0, y: 0 },
			data: { kind: "text", label: "B" },
		},
		createEdge: { id: "e2", source: "n2", target: "n2" },
		patchNode: { id: "n2", data: { workflowStage: "storyboard" } },
		appendNodeArray: { id: "n2", key: "logs", items: ["ok"] },
	});
	const out = applyPublicFlowGraphPatch({ current: { nodes: [], edges: [] }, patch: parsed });
	const node = out.data.nodes[0] as { id: string; data?: Record<string, unknown> };
	expect(node.id).toBe("n2");
	expect(node.data?.workflowStage).toBe("storyboard");
	expect(node.data?.logs).toEqual(["ok"]);
	expect(out.data.edges.length).toBe(1);
	expect(out.stats.deletedNodes).toBe(0);
	expect(out.stats.deletedEdges).toBe(0);
});
