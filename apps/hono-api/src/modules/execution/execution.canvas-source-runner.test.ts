import { describe, expect, it } from "vitest";
import type { WorkflowProjectContext } from "./execution.project-context";
import {
	readWorkflowCanvasGroup,
	readWorkflowCanvasGroupFromFlowData,
	readWorkflowCanvasProjectContextFromFlowData,
} from "./execution.canvas-source-runner";

function projectContext(input: Readonly<{
	selectedNodeIds?: readonly string[];
	assets?: WorkflowProjectContext["assetSnapshot"];
	canvasId?: string;
	sourceNodeId?: string | null;
}> = {}): WorkflowProjectContext {
	return {
		version: 3,
		projectId: "caller-project-1",
		canvasId: input.canvasId ?? "caller-flow-1",
		sourceNodeId: input.sourceNodeId ?? null,
		selectedAssetIds: [],
		projectAssetIds: (input.assets ?? []).map((asset) => asset.assetId),
		timeline: { clips: [] },
		selection: {
			nodeIds: input.selectedNodeIds ?? [],
			assetIds: [],
			activeNodeId: null,
			groupId: null,
		},
		permissions: {
			principalId: "owner-1",
			projectRead: true,
			canvasRead: true,
			assetRead: true,
			assetWrite: true,
		},
		assetSnapshot: input.assets ?? [],
		capturedAt: "2026-08-18T00:00:00.000Z",
	};
}

describe("immutable workflow canvas source", () => {
	it("reads the source group and children only from the frozen flow version", async () => {
		const facts = await readWorkflowCanvasGroup({
			flowId: "flow-1",
			ownerId: "owner-1",
			groupId: "source-group",
			flowVersionData: {
				nodes: [],
				workflowSourceSnapshots: {
					"source-group": {
						group: { id: "source-group", type: "groupNode", data: { label: "冻结来源" } },
						children: [{ id: "chapter", type: "taskNode", parentId: "source-group", data: { text: "冻结正文" } }],
					},
				},
			},
		});

		expect(facts).toMatchObject({
			flowId: "flow-1",
			groupId: "source-group",
			group: { data: { label: "冻结来源" } },
			children: [{ data: { text: "冻结正文" } }],
		});
	});

	it("fails when the frozen version does not contain source children", async () => {
		await expect(readWorkflowCanvasGroup({
			flowId: "flow-1",
			ownerId: "owner-1",
			groupId: "source-group",
			flowVersionData: {
				nodes: [],
				workflowSourceSnapshots: {
					"source-group": {
						group: { id: "source-group", type: "groupNode", data: {} },
						children: [],
					},
				},
			},
		})).rejects.toThrow("has no child nodes");
	});
});

describe("caller canvas workflow source (delivery flow)", () => {
	const callerRowData = JSON.stringify({
		nodes: [
			{ id: "group-1", type: "groupNode", data: { label: "调用者源组" } },
			{ id: "text-1", type: "taskNode", parentId: "group-1", data: { text: "调用者正文" } },
			{ id: "img-1", type: "taskNode", parentId: "group-1", data: { kind: "image", status: "success", imageUrl: "https://example.com/caller.png" } },
		],
	});

	it("reads the group and children from the live caller canvas flow", () => {
		const facts = readWorkflowCanvasGroupFromFlowData({
			flowId: "caller-flow-1",
			groupId: "group-1",
			rowData: callerRowData,
		});

		expect(facts).toMatchObject({
			flowId: "caller-flow-1",
			groupId: "group-1",
			group: { data: { label: "调用者源组" } },
		});
		expect(facts.children.map((child) => child.id)).toEqual(["text-1", "img-1"]);
		expect(facts.children[1]).toMatchObject({ data: { kind: "image", imageUrl: "https://example.com/caller.png" } });
	});

	it("fails when the caller group does not exist or has no children", () => {
		expect(() => readWorkflowCanvasGroupFromFlowData({
			flowId: "caller-flow-1",
			groupId: "missing-group",
			rowData: callerRowData,
		})).toThrow("does not exist in the caller canvas flow");

		expect(() => readWorkflowCanvasGroupFromFlowData({
			flowId: "caller-flow-1",
			groupId: "group-1",
			rowData: JSON.stringify({ nodes: [{ id: "group-1", type: "groupNode", data: {} }] }),
		})).toThrow("has no child nodes");
	});

	it("rejects an administrator workflow group as production source", () => {
		expect(() => readWorkflowCanvasGroupFromFlowData({
			flowId: "caller-flow-1",
			groupId: "group-1",
			rowData: JSON.stringify({
				nodes: [
					{ id: "group-1", type: "groupNode", data: { adminWorkflow: true } },
					{ id: "child-1", type: "taskNode", parentId: "group-1", data: {} },
				],
			}),
		})).toThrow("administrator workflow group");
	});
});

describe("caller project-context workflow source", () => {
	const rowData = JSON.stringify({
		nodes: [
			{ id: "text-1", type: "taskNode", data: { kind: "text", content: "四十秒打斗正文" } },
			{ id: "image-1", type: "taskNode", data: { kind: "image", imageUrl: "https://example.com/image.png" } },
		],
	});
	const textAsset: WorkflowProjectContext["assetSnapshot"][number] = {
		assetId: "project-node:caller-project-1:text-1",
		assetVersion: 8,
		assetVersionId: "text-1-v8",
		projectId: "caller-project-1",
		name: "导演剧本",
		canonicalName: "导演剧本",
		kind: "text",
		referenceType: null,
		approvalStatus: null,
		origin: "project_node",
		flowId: "caller-flow-1",
		nodeId: "text-1",
		mediaKind: "text",
		state: "ready",
		assetUsage: null,
		assetPurpose: null,
		productionEligible: true,
		updatedAt: "2026-08-18T00:00:00.000Z",
	};

	it("uses the only ready text node when no canvas node is selected", () => {
		const facts = readWorkflowCanvasProjectContextFromFlowData({
			flowId: "caller-flow-1",
			rowData,
			projectContext: projectContext({ assets: [textAsset] }),
		});

		expect(facts).toMatchObject({
			sourceMode: "project_context",
			flowId: "caller-flow-1",
			sourceNodeIds: ["text-1"],
			nodes: [{ nodeId: "text-1", kind: "text", content: "四十秒打斗正文", sourceRevision: 7 }],
		});
	});

	it("uses the frozen canonical chapter seed when derived text assets are also visible", () => {
		const derivedScript = { ...textAsset, assetId: "text-script-1", nodeId: "text-script-1" };
		const facts = readWorkflowCanvasProjectContextFromFlowData({
			flowId: "chapter-1",
			rowData: JSON.stringify({
				nodes: [
					{ id: "chapter-seed-1", type: "taskNode", data: { kind: "text", chapterText: "章节原文" } },
					{ id: "text-script-1", type: "taskNode", data: { kind: "text", content: "派生分镜脚本" } },
				],
			}),
			projectContext: projectContext({
				canvasId: "chapter:chapter-1",
				sourceNodeId: "chapter-seed-1",
				assets: [
					{ ...textAsset, assetId: "chapter-seed-asset", nodeId: "chapter-seed-1", flowId: "chapter:chapter-1" },
					{ ...derivedScript, flowId: "chapter:chapter-1" },
				],
			}),
		});

		expect(facts.sourceNodeIds).toEqual(["chapter-seed-1"]);
		expect(facts.nodes[0]).toMatchObject({ nodeId: "chapter-seed-1", content: "章节原文" });
	});

	it("projects the canonical chapterText field into the workflow content contract", () => {
		const chapterRowData = JSON.stringify({
			nodes: [{
				id: "chapter-seed-chapter-1",
				type: "taskNode",
				data: {
					kind: "text",
					chapterText: "阿乔点击方舟登录，现实机房折叠为游戏甲板。",
					label: "第一章",
					sourceChapterRevision: 74,
					sourceHash: "source-hash-74",
				},
			}],
		});
		const facts = readWorkflowCanvasProjectContextFromFlowData({
			flowId: "chapter-1",
			rowData: chapterRowData,
			projectContext: projectContext({
				canvasId: "chapter:chapter-1",
				selectedNodeIds: ["chapter-seed-chapter-1"],
				assets: [{
					...textAsset,
					assetId: "project-node:chapter:chapter-1:chapter-seed-chapter-1",
					flowId: "chapter:chapter-1",
					nodeId: "chapter-seed-chapter-1",
				}],
			}),
		});

		expect(facts.nodes).toEqual([{
			nodeId: "chapter-seed-chapter-1",
			kind: "text",
			content: "阿乔点击方舟登录，现实机房折叠为游戏甲板。",
			label: "第一章",
			sourceRevision: 74,
			sourceHash: "source-hash-74",
		}]);
	});

	it("uses exact selected nodes and rejects an ambiguous unselected text set", () => {
		const selected = readWorkflowCanvasProjectContextFromFlowData({
			flowId: "caller-flow-1",
			rowData,
			projectContext: projectContext({ selectedNodeIds: ["text-1"], assets: [textAsset] }),
		});
		expect(selected.sourceNodeIds).toEqual(["text-1"]);

		expect(() => readWorkflowCanvasProjectContextFromFlowData({
			flowId: "caller-flow-1",
			rowData,
			projectContext: projectContext({ assets: [textAsset, { ...textAsset, assetId: "text-2", nodeId: "text-2" }] }),
		})).toThrow("requires exactly one ready text node");
	});

	it("does not silently replace an explicit non-text selection with another text node", () => {
		expect(() => readWorkflowCanvasProjectContextFromFlowData({
			flowId: "caller-flow-1",
			rowData,
			projectContext: projectContext({
				selectedNodeIds: ["image-1"],
				assets: [textAsset],
			}),
		})).toThrow("selection does not include a ready text source node");
	});

	it("matches chapter text assets by the frozen canonical chapter canvas identity", () => {
		const facts = readWorkflowCanvasProjectContextFromFlowData({
			flowId: "chapter-1",
			rowData,
			projectContext: projectContext({
				canvasId: "chapter:chapter-1",
				selectedNodeIds: ["text-1"],
				assets: [{ ...textAsset, flowId: "chapter:chapter-1" }],
			}),
		});

		expect(facts).toMatchObject({
			flowId: "chapter-1",
			sourceNodeIds: ["text-1"],
		});
	});

	it("keeps the canonical chapter source when the explicit selection contains reusable visual nodes", () => {
		const facts = readWorkflowCanvasProjectContextFromFlowData({
			flowId: "chapter-1",
			rowData,
			projectContext: projectContext({
				canvasId: "chapter:chapter-1",
				sourceNodeId: "text-1",
				selectedNodeIds: ["image-1"],
				assets: [
					{ ...textAsset, flowId: "chapter:chapter-1" },
					{
						...textAsset,
						assetId: "project-node:chapter:chapter-1:image-1",
						assetVersionId: "image-1:version:1",
						contentFingerprint: "image-1",
						name: "角色参考",
						canonicalName: "角色参考",
						kind: "character",
						nodeId: "image-1",
						mediaKind: "image",
					},
				],
			}),
		});

		expect(facts.sourceNodeIds).toEqual(["text-1"]);
	});
});
