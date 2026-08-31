import { describe, expect, it } from "vitest";
import {
	PublicFlowPatchRequestSchema,
	publicFlowPatchRequestsAdminWorkflow,
} from "./flow.public.schemas";
import { applyPublicFlowGraphPatch, buildCanvasSyncPatch } from "./flow.public.service";

const validShotTable = {
	version: 1 as const,
	overview: { 总镜数: "1" },
	columns: [
		{ key: "时间段", label: "时间段", scope: "timeline" as const },
		{ key: "镜号", label: "镜号", scope: "shot" as const },
	],
	rows: [
		{
			id: "shot-1-segment-1",
			shotId: "shot-1",
			values: { 时间段: "0-2s", 镜号: "S1" },
		},
	],
};

function createSbaData(options: {
	path: string;
	depth: number;
	parentNodeId: string | null;
}): Record<string, unknown> {
	return {
		kind: "image",
		label: `分支 ${options.path}`,
		sbaContractVersion: 1,
		sbaRole: "moment-board",
		sbaPath: options.path,
		sbaDepth: options.depth,
		sbaParentNodeId: options.parentNodeId,
		sbaStatus: "active",
		sbaBasisStatus: "current",
		sbaSelectionStatus: "candidate",
		sbaStoryBasis: {
			version: 1,
			mode: "task_context",
			projectId: "project-1",
			bookId: null,
			effectiveAt: null,
			ledgerRevision: null,
			consumedFactIds: [],
			sourceRefs: [{
				kind: "user_turn",
				id: "turn-1",
				version: null,
				contentSha256: null,
				updatedAt: null,
			}],
		},
		sbaProjection: {
			version: 1,
			status: "candidate",
			decision: "进入左侧走廊",
			immediateConsequence: "门在身后关闭",
			projectedChanges: {
				characters: [{ id: "character-1", summary: "主角决定独自前行" }],
				relationships: [],
				knowledge: [],
				resources: [],
				world: [],
				hooks: [],
			},
			openQuestions: [],
			risks: [],
			uncertainties: [],
			futureBeats: [],
			productionImpact: [],
			continuityAnchors: [],
		},
	};
}

describe("PublicFlowPatchRequestSchema", () => {
	it("accepts the two explicit admin workflow task-node kinds for the separately authorized tool path", () => {
		const parsed = PublicFlowPatchRequestSchema.parse({
			createNodes: [
				{ type: "taskNode", position: { x: 0, y: 0 }, data: { kind: "workflowTrigger" } },
				{ type: "taskNode", position: { x: 320, y: 0 }, data: { kind: "workflowStage" } },
			],
		});
		expect(parsed.createNodes?.map((node) => node.data.kind)).toEqual([
			"workflowTrigger",
			"workflowStage",
		]);
	});
	it("normalizes an explicit nodeId alias for patchNodeData", () => {
		const parsed = PublicFlowPatchRequestSchema.parse({
			patchNodeData: [{ nodeId: "shot-table-1", data: { content: "updated" } }],
		});

		expect(parsed.patchNodeData).toEqual([
			{ id: "shot-table-1", data: { content: "updated" } },
		]);
	});

	it("still rejects patchNodeData entries without a structural node identifier", () => {
		const result = PublicFlowPatchRequestSchema.safeParse({
			patchNodeData: [{ data: { content: "updated" } }],
		});

		expect(result.success).toBe(false);
	});

	it("rejects the retired mosaic task-node kind", () => {
		const result = PublicFlowPatchRequestSchema.safeParse({
			createNodes: [
				{ type: "taskNode", position: { x: 0, y: 0 }, data: { kind: "mosaic" } },
			],
		});

		expect(result.success).toBe(false);
	});

	it("requires a structured shotTable object when creating a shotTable node", () => {
		const invalid = PublicFlowPatchRequestSchema.safeParse({
			createNodes: [
				{
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: { kind: "shotTable", content: "| 镜号 | 内容 |" },
				},
			],
		});
		const valid = PublicFlowPatchRequestSchema.safeParse({
			createNodes: [
				{
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: { kind: "shotTable", shotTable: validShotTable },
				},
			],
		});

		expect(invalid.success).toBe(false);
		expect(valid.success).toBe(true);
	});
});

describe("applyPublicFlowGraphPatch", () => {
	it("derives one deterministic basis fingerprint for a persisted SBA candidate", () => {
		const out = applyPublicFlowGraphPatch({
			current: { nodes: [], edges: [] },
			patch: PublicFlowPatchRequestSchema.parse({
				createNodes: [{
					id: "sba-root-a",
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: createSbaData({ path: "1A", depth: 1, parentNodeId: null }),
				}],
			}),
		});

		const data = (out.data.nodes[0] as { data: Record<string, unknown> }).data;
		expect(data.basisFingerprint).toMatch(/^[a-f0-9]{64}$/);
	});

	it("accepts an SBA child only when its real parent id, depth and edge agree", () => {
		const parent = {
			id: "sba-root-a",
			type: "taskNode",
			position: { x: 0, y: 0 },
			data: createSbaData({ path: "1A", depth: 1, parentNodeId: null }),
		};
		const out = applyPublicFlowGraphPatch({
			current: { nodes: [parent], edges: [] },
			patch: PublicFlowPatchRequestSchema.parse({
				createNodes: [{
					id: "sba-child-b",
					type: "taskNode",
					position: { x: 700, y: 0 },
					data: createSbaData({ path: "1A2B", depth: 2, parentNodeId: "sba-root-a" }),
				}],
				createEdges: [{ source: "sba-root-a", target: "sba-child-b" }],
			}),
		});

		expect(out.createdNodeIds).toEqual(["sba-child-b"]);
		expect(out.data.edges).toHaveLength(1);
	});

	it("rejects an SBA child whose path claims a parent but the real graph has no parent edge", () => {
		const run = (): ReturnType<typeof applyPublicFlowGraphPatch> => applyPublicFlowGraphPatch({
			current: {
				nodes: [{
					id: "sba-root-a",
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: createSbaData({ path: "1A", depth: 1, parentNodeId: null }),
				}],
				edges: [],
			},
			patch: PublicFlowPatchRequestSchema.parse({
				createNodes: [{
					id: "sba-child-b",
					type: "taskNode",
					position: { x: 700, y: 0 },
					data: createSbaData({ path: "1A2B", depth: 2, parentNodeId: "sba-root-a" }),
				}],
			}),
		});

		expect(run).toThrowError(expect.objectContaining({
			code: "invalid_storyboard_adventure_contract",
		}));
	});

	it("rejects a caller-supplied basis fingerprint that does not match the persisted basis", () => {
		const data = createSbaData({ path: "1A", depth: 1, parentNodeId: null });
		data.basisFingerprint = "0".repeat(64);
		const run = (): ReturnType<typeof applyPublicFlowGraphPatch> => applyPublicFlowGraphPatch({
			current: { nodes: [], edges: [] },
			patch: PublicFlowPatchRequestSchema.parse({
				createNodes: [{
					id: "sba-root-a",
					type: "taskNode",
					position: { x: 0, y: 0 },
					data,
				}],
			}),
		});

		expect(run).toThrowError(expect.objectContaining({
			code: "invalid_storyboard_adventure_contract",
		}));
	});

	it("persists selection as an append-only event bound to the real branch identity", () => {
		const created = applyPublicFlowGraphPatch({
			current: { nodes: [], edges: [] },
			patch: PublicFlowPatchRequestSchema.parse({
				createNodes: [{
					id: "sba-root-a",
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: createSbaData({ path: "1A", depth: 1, parentNodeId: null }),
				}],
			}),
		});
		const createdData = (created.data.nodes[0] as { data: Record<string, unknown> }).data;
		const basisFingerprint = String(createdData.basisFingerprint);

		const selected = applyPublicFlowGraphPatch({
			current: created.data,
			patch: PublicFlowPatchRequestSchema.parse({
				patchNodeData: [{
					id: "sba-root-a",
					allowOverwrite: true,
					data: { sbaSelectionStatus: "selected" },
				}],
				appendNodeArrays: [{
					id: "sba-root-a",
					key: "sbaSelectionEvents",
					items: [{
						version: 1,
						eventId: "selection-1",
						branchNodeId: "sba-root-a",
						parentNodeId: null,
						sbaPath: "1A",
						basisFingerprint,
						selectedAt: "2026-08-20T00:00:00.000Z",
						source: "choices_card",
					}],
				}],
			}),
		});

		expect(selected.data.nodes[0]).toMatchObject({
			data: {
				sbaSelectionStatus: "selected",
				sbaSelectionEvents: [{ eventId: "selection-1", basisFingerprint }],
			},
		});

		const replayed = applyPublicFlowGraphPatch({
			current: selected.data,
			patch: PublicFlowPatchRequestSchema.parse({
				patchNodeData: [{
					id: "sba-root-a",
					allowOverwrite: true,
					data: { sbaSelectionStatus: "selected" },
				}],
				appendNodeArrays: [{
					id: "sba-root-a",
					key: "sbaSelectionEvents",
					items: [{
						version: 1,
						eventId: "selection-1",
						branchNodeId: "sba-root-a",
						parentNodeId: null,
						sbaPath: "1A",
						basisFingerprint,
						selectedAt: "2026-08-20T00:00:00.000Z",
						source: "choices_card",
					}],
				}],
			}),
		});
		const replayedData = (replayed.data.nodes[0] as { data: { sbaSelectionEvents: unknown[] } }).data;
		expect(replayedData.sbaSelectionEvents).toHaveLength(1);
		expect(replayed.stats.appendedArrays).toBe(0);
	});

	it("rejects a selection receipt when the branch still claims to be a candidate", () => {
		const created = applyPublicFlowGraphPatch({
			current: { nodes: [], edges: [] },
			patch: PublicFlowPatchRequestSchema.parse({
				createNodes: [{
					id: "sba-root-a",
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: createSbaData({ path: "1A", depth: 1, parentNodeId: null }),
				}],
			}),
		});
		const data = (created.data.nodes[0] as { data: Record<string, unknown> }).data;
		const run = (): ReturnType<typeof applyPublicFlowGraphPatch> => applyPublicFlowGraphPatch({
			current: created.data,
			patch: PublicFlowPatchRequestSchema.parse({
				appendNodeArrays: [{
					id: "sba-root-a",
					key: "sbaSelectionEvents",
					items: [{
						version: 1,
						eventId: "selection-1",
						branchNodeId: "sba-root-a",
						parentNodeId: null,
						sbaPath: "1A",
						basisFingerprint: data.basisFingerprint,
						selectedAt: "2026-08-20T00:00:00.000Z",
						source: "choices_card",
					}],
				}],
			}),
		});

		expect(run).toThrowError(expect.objectContaining({
			code: "invalid_storyboard_adventure_contract",
		}));
	});

	it("rejects one selection event id being attached to two different branches", () => {
		const created = applyPublicFlowGraphPatch({
			current: { nodes: [], edges: [] },
			patch: PublicFlowPatchRequestSchema.parse({
				createNodes: [
					{
						id: "sba-root-a",
						type: "taskNode",
						position: { x: 0, y: 0 },
						data: createSbaData({ path: "1A", depth: 1, parentNodeId: null }),
					},
					{
						id: "sba-root-b",
						type: "taskNode",
						position: { x: 0, y: 300 },
						data: createSbaData({ path: "1B", depth: 1, parentNodeId: null }),
					},
				],
			}),
		});
		const nodes = created.data.nodes as Array<{ id: string; data: Record<string, unknown> }>;
		const fingerprintByNodeId = new Map(nodes.map((node) => [node.id, String(node.data.basisFingerprint)]));
		const selectBranch = (current: typeof created.data, nodeId: string, path: string) => applyPublicFlowGraphPatch({
			current,
			patch: PublicFlowPatchRequestSchema.parse({
				patchNodeData: [{ id: nodeId, allowOverwrite: true, data: { sbaSelectionStatus: "selected" } }],
				appendNodeArrays: [{
					id: nodeId,
					key: "sbaSelectionEvents",
					items: [{
						version: 1,
						eventId: "shared-selection-id",
						branchNodeId: nodeId,
						parentNodeId: null,
						sbaPath: path,
						basisFingerprint: fingerprintByNodeId.get(nodeId),
						selectedAt: "2026-08-20T00:00:00.000Z",
						source: "choices_card",
					}],
				}],
			}),
		});
		const selectedA = selectBranch(created.data, "sba-root-a", "1A");
		const run = (): ReturnType<typeof applyPublicFlowGraphPatch> => selectBranch(selectedA.data, "sba-root-b", "1B");

		expect(run).toThrowError(expect.objectContaining({
			code: "invalid_storyboard_adventure_contract",
		}));
	});

	it("rejects a patch that leaves a touched shotTable node without structured data", () => {
		const patch = PublicFlowPatchRequestSchema.parse({
			patchNodeData: [{ id: "shot-table-1", data: { label: "仍然缺少表对象" } }],
		});
		const run = (): ReturnType<typeof applyPublicFlowGraphPatch> =>
			applyPublicFlowGraphPatch({
				current: {
					nodes: [
						{
							id: "shot-table-1",
							type: "taskNode",
							position: { x: 0, y: 0 },
							data: { kind: "shotTable", content: "Markdown 不是表对象" },
						},
					],
					edges: [],
				},
				patch,
			});

		expect(run).toThrowError(expect.objectContaining({
			code: "invalid_shot_table_node_data",
		}));
	});

	it("repairs a touched shotTable node when the patch supplies the structured object", () => {
		const out = applyPublicFlowGraphPatch({
			current: {
				nodes: [
					{
						id: "shot-table-1",
						type: "taskNode",
						position: { x: 0, y: 0 },
						data: { kind: "shotTable", content: "原始 Markdown 保留" },
					},
				],
				edges: [],
			},
			patch: PublicFlowPatchRequestSchema.parse({
				patchNodeData: [{ id: "shot-table-1", data: { shotTable: validShotTable } }],
			}),
		});

		expect(out.data.nodes[0]).toMatchObject({
			data: {
				kind: "shotTable",
				content: "原始 Markdown 保留",
				shotTable: validShotTable,
			},
		});
	});

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

	it("reuses the canonical compose node for the same video run", () => {
		const current = {
			nodes: [
				{
					id: "film-run-1",
					type: "taskNode",
					position: { x: 80, y: 40 },
					data: { kind: "composeVideo", clipRunId: "run-1", status: "clips_ready" },
				},
			],
			edges: [],
		};
		const out = applyPublicFlowGraphPatch({
			current,
			patch: PublicFlowPatchRequestSchema.parse({
				createNodes: [
					{
						id: "film-run-1",
						type: "taskNode",
						position: { x: 0, y: 0 },
						data: {
							kind: "composeVideo",
							clipRunId: "run-1",
							status: "success",
							videoUrl: "https://example.com/final.mp4",
						},
					},
				],
			}),
		});

		expect(out.data.nodes).toHaveLength(1);
		expect(out.data.nodes[0]).toMatchObject({
			id: "film-run-1",
			position: { x: 80, y: 40 },
			data: {
				kind: "composeVideo",
				clipRunId: "run-1",
				status: "success",
				videoUrl: "https://example.com/final.mp4",
			},
		});
		expect(out.stats).toMatchObject({ createdNodes: 0, patchedNodes: 1 });
		expect(out.reusedNodeIds).toEqual(["film-run-1"]);
	});

	it("reuses a compose node when the incoming canonical run id is carried in production metadata", () => {
		const out = applyPublicFlowGraphPatch({
			current: {
				nodes: [{
					id: "film-run-1",
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: { kind: "composeVideo", clipRunId: "run-1", status: "clips_ready" },
				}],
				edges: [],
			},
			patch: PublicFlowPatchRequestSchema.parse({
				createNodes: [{
					id: "film-run-1",
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: {
						kind: "composeVideo",
						status: "success",
						productionMetadata: {
							chapterGrounded: true,
							runId: "run-1",
							lockedAnchors: {
								character: [], scene: [], shot: [], continuity: [], missing: [],
							},
							authorityBaseFrame: {
								status: "planned",
								source: "test",
								reason: "test canonical run identity",
							},
						},
					},
				}],
			}),
		});
		expect(out.reusedNodeIds).toEqual(["film-run-1"]);
		expect((out.data.nodes[0] as { data: { status: string } }).data.status).toBe("success");
	});

	it("skips an exactly identical retry edge", () => {
		const edge = {
			id: "e-video-film",
			source: "video-1",
			target: "film-run-1",
			sourceHandle: "out-video",
			targetHandle: "in-any",
		};
		const out = applyPublicFlowGraphPatch({
			current: {
				nodes: [
					{ id: "video-1", type: "taskNode", position: { x: 0, y: 0 }, data: { kind: "video" } },
					{ id: "film-run-1", type: "taskNode", position: { x: 100, y: 0 }, data: { kind: "composeVideo", clipRunId: "run-1" } },
				],
				edges: [edge],
			},
			patch: PublicFlowPatchRequestSchema.parse({ createEdges: [edge] }),
		});
		expect(out.data.edges).toEqual([edge]);
		expect(out.stats.createdEdges).toBe(0);
	});

	it("does not reuse a same-id node when canonical compose identity differs", () => {
		const current = {
			nodes: [
				{
					id: "film-run-1",
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: { kind: "composeVideo", clipRunId: "another-run" },
				},
			],
			edges: [],
		};
		expect(() =>
			applyPublicFlowGraphPatch({
				current,
				patch: PublicFlowPatchRequestSchema.parse({
					createNodes: [
						{
							id: "film-run-1",
							type: "taskNode",
							position: { x: 0, y: 0 },
							data: { kind: "composeVideo", clipRunId: "run-1" },
						},
					],
				}),
			}),
		).toThrow(/createNodes 节点已存在/i);
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

	it("keeps workflow groups in one execution row and reapplies layout when the group is patched", () => {
		const current = {
			nodes: [
				{
					id: "workflow-group",
					type: "groupNode",
					position: { x: 100, y: 100 },
					style: { width: 700, height: 500 },
					data: {
						label: "workflow",
						isGroup: true,
						workflowKey: "agent-workflow/v1",
					},
				},
				...Array.from({ length: 4 }, (_, index) => ({
					id: `stage-${index + 1}`,
					type: "taskNode",
					parentId: "workflow-group",
					position: { x: (index % 2) * 312 + 8, y: Math.floor(index / 2) * 252 + 8 },
					data: {
						kind: "workflowStage",
						label: `stage ${index + 1}`,
						nodeWidth: 300,
						nodeHeight: 224,
					},
				})),
			],
			edges: [],
		};
		const patch = PublicFlowPatchRequestSchema.parse({
			patchNodeData: [{ id: "workflow-group", data: { layoutRevision: 1 } }],
		});

		const out = applyPublicFlowGraphPatch({ current, patch });
		const group = out.data.nodes.find((node) => {
			const record = node as { id?: string };
			return record.id === "workflow-group";
		}) as { style?: { width?: number; height?: number } } | undefined;
		const positions = out.data.nodes
			.filter((node) => String((node as { id?: string }).id || "").startsWith("stage-"))
			.map((node) => (node as { position?: { x?: number; y?: number } }).position);

		expect(positions).toEqual([
			{ x: 8, y: 8 },
			{ x: 320, y: 8 },
			{ x: 632, y: 8 },
			{ x: 944, y: 8 },
		]);
		expect(group?.style).toEqual({ width: 1252, height: 240 });
	});

	it("lays out a workflow group by DAG order after inserting a required downstream executor", () => {
		const groupId = "workflow-group";
		const stage = (id: string, x: number) => ({
			id,
			type: "taskNode",
			parentId: groupId,
			position: { x, y: 8 },
			data: {
				kind: id === "trigger" ? "workflowTrigger" : "workflowStage",
				label: id,
				nodeWidth: 300,
				nodeHeight: 224,
				adminWorkflow: true,
				workflowInstanceId: "workflow-1",
			},
		});
		const current = {
			nodes: [
				{
					id: groupId,
					type: "groupNode",
					position: { x: 100, y: 100 },
					style: { width: 2500, height: 240 },
					data: { label: "workflow", isGroup: true, workflowKey: "agent-workflow/v1" },
				},
				stage("trigger", 8),
				stage("document", 320),
				stage("structure", 632),
				stage("planner", 944),
				stage("clips", 1256),
				stage("prompt", 1568),
				stage("delivery", 1880),
				// This node was appended later in the persisted array, even though it is upstream.
				stage("source-chunks", 2192),
			],
			edges: [
				{ id: "e1", source: "trigger", target: "document" },
				{ id: "e2", source: "document", target: "structure" },
				{ id: "e3", source: "structure", target: "source-chunks" },
				{ id: "e4", source: "source-chunks", target: "planner" },
				{ id: "e5", source: "planner", target: "clips" },
				{ id: "e6", source: "clips", target: "prompt" },
				{ id: "old-delivery", source: "prompt", target: "delivery" },
			],
		};
		const patch = PublicFlowPatchRequestSchema.parse({
			deleteEdgeIds: ["old-delivery"],
			createNodes: [stage("video", 2504)],
			createEdges: [
				{ id: "prompt-video", source: "prompt", target: "video" },
				{ id: "video-delivery", source: "video", target: "delivery" },
			],
		});

		const out = applyPublicFlowGraphPatch({ current, patch });
		const positions = new Map(out.data.nodes.map((node) => {
			const snapshot = node as { id?: string; position?: { x?: number } };
			return [snapshot.id, snapshot.position?.x] as const;
		}));
		const orderedIds = [
			"trigger",
			"document",
			"structure",
			"source-chunks",
			"planner",
			"clips",
			"prompt",
			"video",
			"delivery",
		];

		expect(orderedIds.map((id) => positions.get(id))).toEqual(
			orderedIds.map((_, index) => 8 + index * 312),
		);
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

	it("declares an exact one-shot recovery contract for node data conflicts", () => {
		const rawPatch = {
			patchNodeData: [{ id: "status-1", data: { prompt: "new", productionState: "scheduled" } }],
			createEdges: [{ source: "source-1", target: "status-1" }],
		};
		const patch = PublicFlowPatchRequestSchema.parse(rawPatch);
		let caught: unknown;
		try {
			applyPublicFlowGraphPatch({
				current: {
					nodes: [
						{ id: "source-1", data: { kind: "text" } },
						{
							id: "status-1",
							data: { prompt: "old", productionState: "collecting" },
						},
					],
					edges: [],
				},
				patch,
			});
		} catch (error) {
			caught = error;
		}

		const failure = caught as {
			code?: unknown;
			details?: { recovery?: Record<string, unknown> };
		};
		expect(failure.code).toBe("flow_patch_conflict");
		expect(failure.details?.recovery).toEqual({
			allowed: true,
			retryKey: "tapcanvas_flow_patch:status-1:prompt,productionState",
			retryToolName: "tapcanvas_flow_patch",
			maxAttempts: 1,
			immutableArgs: rawPatch,
			exactRetryArgs: { ...rawPatch, allowOverwrite: true },
			requiredActions: [
				"使用 exactRetryArgs 中的完整参数原样重调 tapcanvas_flow_patch；不得修改、增加或删除任何其他操作。",
			],
		});
	});

	it("honors item-level allowOverwrite on a patchNodeData entry", () => {
		const current = { nodes: [{ id: "n1", data: { content: "old" } }], edges: [] };
		const parsed = PublicFlowPatchRequestSchema.parse({
			patchNodeData: [{ id: "n1", allowOverwrite: true, data: { content: "new" } }],
		});
		const out = applyPublicFlowGraphPatch({ current, patch: parsed });
		const node = out.data.nodes[0] as { data?: { content?: string } };
		expect(node.data?.content).toBe("new");
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

// 回归：video orchestrator 起跑闸按 productionLayer==="design_board" 识别分镜设计板，
// schema enum 一旦缺该值，.catch(undefined) 会把 agent 写入静默吞掉（200 成功但字段丢失），
// agent 无限重试 start 也无法自救（2026-06-12 线上实测）。
it("preserves productionLayer=design_board through createNodes (orchestrate gate contract)", () => {
	const parsed = PublicFlowPatchRequestSchema.parse({
		createNodes: [
			{
				id: "board1",
				type: "taskNode",
				position: { x: 0, y: 0 },
				data: {
					kind: "image",
					label: "分镜设计板",
					imageUrl: "https://example.com/board.png",
					productionLayer: "design_board",
					creationStage: "intent_generate_shot_design_board",
				},
			},
		],
	});
	const out = applyPublicFlowGraphPatch({ current: { nodes: [], edges: [] }, patch: parsed });
	const node = out.data.nodes[0] as { data?: Record<string, unknown> };
	expect(node.data?.productionLayer).toBe("design_board");
	expect(node.data?.creationStage).toBe("intent_generate_shot_design_board");
});

it.each([
	["blocking_diagram", "spatial_blocking"],
	["keyframe", "beat_keyframe"],
] as const)("preserves production provenance %s/%s through createNodes", (productionLayer, creationStage) => {
	const parsed = PublicFlowPatchRequestSchema.parse({
		createNodes: [
			{
				id: `${productionLayer}-node`,
				type: "taskNode",
				position: { x: 0, y: 0 },
				data: {
					kind: "image",
					imageUrl: "https://example.com/evidence.png",
					productionLayer,
					creationStage,
				},
			},
		],
	});
	const out = applyPublicFlowGraphPatch({ current: { nodes: [], edges: [] }, patch: parsed });
	const node = out.data.nodes[0] as { data?: Record<string, unknown> };
	expect(node.data?.productionLayer).toBe(productionLayer);
	expect(node.data?.creationStage).toBe(creationStage);
});

it("rejects unknown production provenance instead of silently dropping it", () => {
	expect(() =>
		PublicFlowPatchRequestSchema.parse({
			createNodes: [
				{
					id: "n9",
					type: "taskNode",
					position: { x: 0, y: 0 },
					data: { kind: "image", label: "x", productionLayer: "made_up_layer" },
				},
			],
		}),
	).toThrow();
});

describe("buildCanvasSyncPatch", () => {
	it("includes server-generated node ids when createNodes omit id (agent path)", () => {
		// 回归：agent 的 flow_patch 常不带 id，广播补丁若按请求 id 反查会恒空 → 画布不实时刷新
		const parsed = PublicFlowPatchRequestSchema.parse({
			createNodes: [
				{
					type: "taskNode",
					position: { x: 200, y: 200 },
					data: { kind: "text", label: "", content: "" },
				},
			],
		});
		const applied = applyPublicFlowGraphPatch({ current: { nodes: [], edges: [] }, patch: parsed });
		expect(applied.createdNodeIds.length).toBe(1);
		const sync = buildCanvasSyncPatch({ applied, patch: parsed });
		expect(sync).not.toBeNull();
		const upsertNodes = (sync as { upsertNodes?: Array<{ id?: unknown }> }).upsertNodes ?? [];
		expect(upsertNodes.length).toBe(1);
		expect(upsertNodes[0]?.id).toBe(applied.createdNodeIds[0]);
	});

	it("includes patched nodes, created edges and deletions", () => {
		const current = {
			nodes: [
				{ id: "n1", type: "taskNode", position: { x: 0, y: 0 }, data: { kind: "text", label: "a" } },
				{ id: "n2", type: "taskNode", position: { x: 10, y: 0 }, data: { kind: "text", label: "b" } },
				{ id: "n3", type: "taskNode", position: { x: 20, y: 0 }, data: { kind: "text", label: "c" } },
			],
			edges: [],
		};
		const parsed = PublicFlowPatchRequestSchema.parse({
			patchNodeData: [{ id: "n1", data: { label: "A2" }, allowOverwrite: true }],
			createEdges: [{ source: "n1", target: "n2" }],
			deleteNodeIds: ["n3"],
		});
		const applied = applyPublicFlowGraphPatch({ current, patch: parsed });
		const sync = buildCanvasSyncPatch({ applied, patch: parsed }) as Record<string, unknown>;
		expect(sync).not.toBeNull();
		expect((sync.upsertNodes as Array<{ id: string }>).map((n) => n.id)).toEqual(["n1"]);
		expect((sync.upsertEdges as Array<{ id: string }>).length).toBe(1);
		expect(sync.removeNodeIds).toEqual(["n3"]);
	});

	it("returns null when the patch changes nothing broadcast-worthy", () => {
		const parsed = PublicFlowPatchRequestSchema.parse({});
		const applied = applyPublicFlowGraphPatch({ current: { nodes: [], edges: [] }, patch: parsed });
		expect(buildCanvasSyncPatch({ applied, patch: parsed })).toBeNull();
	});

	it("broadcasts edges removed implicitly by node deletion", () => {
		const current = {
			nodes: [
				{ id: "source", type: "taskNode", position: { x: 0, y: 0 }, data: { kind: "text" } },
				{ id: "target", type: "taskNode", position: { x: 200, y: 0 }, data: { kind: "text" } },
			],
			edges: [{ id: "incident", source: "source", target: "target" }],
		};
		const parsed = PublicFlowPatchRequestSchema.parse({ deleteNodeIds: ["target"] });
		const applied = applyPublicFlowGraphPatch({ current, patch: parsed });
		const sync = buildCanvasSyncPatch({ applied, patch: parsed });

		expect(sync).toMatchObject({
			removeNodeIds: ["target"],
			removeEdgeIds: ["incident"],
		});
	});
});

describe("workflow execution projection node protocol", () => {
	it("accepts the exact server node shape and classifies it as admin-owned", () => {
		const patch = PublicFlowPatchRequestSchema.parse({
			createNodes: [{
				id: "workflow-execution-status",
				type: "workflowExecutionNode",
				position: { x: 0, y: 0 },
				data: {
					kind: "workflowExecution",
					managedProjection: "workflow_execution",
					workflowRuntimeReference: false,
					workflowExecutionId: "execution-1",
					workflowExecutionCreatedAt: "2026-08-23T00:00:00.000Z",
					workflowStatus: "queued",
				},
			}],
		});

		expect(publicFlowPatchRequestsAdminWorkflow(patch)).toBe(true);
		expect(applyPublicFlowGraphPatch({ current: { nodes: [], edges: [] }, patch }).data.nodes)
			.toHaveLength(1);
	});

	it("rejects runtime-only execution nodes from the durable create protocol", () => {
		expect(() => PublicFlowPatchRequestSchema.parse({
			createNodes: [{
				id: "workflow-execution-status",
				type: "workflowExecutionNode",
				position: { x: 0, y: 0 },
				data: {
					kind: "workflowExecution",
					managedProjection: "workflow_execution",
					workflowRuntimeReference: true,
					workflowExecutionId: "execution-1",
					workflowExecutionCreatedAt: "2026-08-23T00:00:00.000Z",
					workflowStatus: "queued",
				},
			}],
		})).toThrow();
	});
});
