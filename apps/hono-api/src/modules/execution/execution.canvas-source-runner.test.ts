import { describe, expect, it } from "vitest";
import type { WorkflowProjectContext } from "./execution.project-context";
import {
	readWorkflowCanvasGroup,
	readWorkflowCanvasGroupFromFlowData,
	readWorkflowCanvasProjectContextFromFlowData,
	readWorkflowCanvasProjectContextFromSnapshot,
} from "./execution.canvas-source-runner";

it("does not turn detached source groups into new production inputs", () => {
	expect(() => readWorkflowCanvasGroupFromFlowData({ flowId: "flow-1", groupId: "deleted-group",
		rowData: JSON.stringify({ nodes: [{ id: "deleted-group", type: "groupNode", canvasDetached: true, data: {} },
			{ id: "retained-child", parentId: "deleted-group", data: { text: "old source" } }], edges: [] }),
	})).toThrow("does not exist");
});

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
		contentFingerprint: "text-1-content",
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
		productionExclusionReason: null,
		styleFingerprint: null,
		sourceFacts: {
			referenceType: null, roleName: null, physicalIdentityKey: null,
			characterAssetRole: null, characterProfileVersion: null,
			identityAnchors: [], prohibitedDrift: [], sourceNodeId: "text-1",
			workflowExecutionId: null, taskId: null, prompt: null,
		},
		updatedAt: "2026-08-18T00:00:00.000Z",
	};

	it.each(["caller-flow-1", "chapter:chapter-1"])("reads frozen narrative in %s independently of unsaved or edited live canvas", (canvasId) => {
		const snapshot = { ...(JSON.parse(rowData) as { nodes: unknown[] }), edges: [] };
		const context = projectContext({ canvasId, sourceNodeId: "text-1", assets: [{ ...textAsset, flowId: canvasId }] });
		const flowVersionData = { nodes: [], edges: [], workflowCallerCanvasSnapshot: snapshot };
		const facts = readWorkflowCanvasProjectContextFromSnapshot({ flowId: canvasId, flowVersionData, projectContext: context });
		expect(facts.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ nodeId: "text-1", content: "四十秒打斗正文" })]));
		// Workflow definition/current canvas nodes are not the source snapshot.
		const edited = { ...flowVersionData, nodes: [{ id: "text-1", data: { kind: "text", content: "启动后的新正文" } }] };
		expect(readWorkflowCanvasProjectContextFromSnapshot({ flowId: canvasId, flowVersionData: edited, projectContext: context })).toEqual(facts);
	});

	it("reports missing frozen input without substituting live or definition nodes", () => {
		expect(() => readWorkflowCanvasProjectContextFromSnapshot({ flowId: "caller-flow-1",
			flowVersionData: JSON.parse(rowData) as unknown, projectContext: projectContext({ assets: [textAsset] }),
		})).toThrow("requires the frozen caller canvas snapshot");
	});

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

	it("prefers the completed text-expansion source over an older ready draft", () => {
		const expandedAsset = {
			...textAsset,
			assetId: "project-node:caller-project-1:text-expanded",
			nodeId: "text-expanded",
		};
		const facts = readWorkflowCanvasProjectContextFromFlowData({
			flowId: "caller-flow-1",
			rowData: JSON.stringify({
				nodes: [
					{ id: "text-1", type: "taskNode", data: { kind: "text", content: "旧草稿" } },
					{
						id: "text-expanded",
						type: "taskNode",
						data: {
							kind: "text",
							content: "扩写后的完整剧情",
							workflowSourceRole: "expanded_story_source",
						},
					},
				],
			}),
			projectContext: projectContext({ assets: [textAsset, expandedAsset] }),
		});

		expect(facts.sourceNodeIds).toEqual(["text-expanded"]);
		expect(facts.nodes[0]).toMatchObject({ nodeId: "text-expanded", content: "扩写后的完整剧情" });
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

		expect(facts.authoritativeSources).toEqual([expect.objectContaining({
			nodeId: "chapter-seed-chapter-1",
			sourceId: "chapter-seed-chapter-1",
			sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
			content: "阿乔点击方舟登录，现实机房折叠为游戏甲板。",
			sourceRevision: 74,
			sourceHash: "source-hash-74",
		})]);
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
		expect(selected.selectedNodeFacts?.[0]?.metadata).toEqual({ kind: "text" });

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

	it("preserves selected image descriptions without substituting unrelated narrative or exposing media URLs", () => {
		const facts = readWorkflowCanvasProjectContextFromFlowData({
			flowId: "caller-flow-1",
			rowData: JSON.stringify({ nodes: [
				{ id: "text-1", data: { kind: "text", content: "unrelated story" } },
				{ id: "image-1", data: { kind: "image", label: "用户商品", description: "红色包装", prompt: "摄影提示", imageUrl: "https://example.com/private.png" } },
			] }),
			projectContext: projectContext({ selectedNodeIds: ["image-1", "missing"], assets: [
				textAsset,
				{ ...textAsset, assetId: "image-asset", nodeId: "image-1", mediaKind: "image" },
			] }),
			allowNoTextSource: true,
		});
		expect(facts.sourceNodeIds).toEqual([]);
		expect(facts.authoritativeSources).toEqual([]);
		expect(facts.selectedNodeFacts).toEqual([{
			nodeId: "image-1",
			assetIds: ["image-asset"],
			metadata: { kind: "image", label: "用户商品", description: "红色包装", prompt: "摄影提示" },
		}]);
		expect(facts.missingSelectedNodeIds).toEqual(["missing"]);
	});

	it("keeps a selected video as reference input when standalone chat has no text source", () => {
		const facts = readWorkflowCanvasProjectContextFromFlowData({
			flowId: "caller-flow-1",
			rowData: JSON.stringify({
				nodes: [{ id: "video-1", type: "taskNode", data: { kind: "video", videoUrl: "https://example.com/reference.mp4" } }],
			}),
			projectContext: projectContext({ selectedNodeIds: ["video-1"], assets: [] }),
			allowNoTextSource: true,
		});

		expect(facts).toMatchObject({
			sourceNodeIds: [],
			referenceVideoNodeIds: ["video-1"],
			nodes: [],
		});
	});

	it("preserves a selected prompt-only video without requesting unavailable media analysis", () => {
		const facts = readWorkflowCanvasProjectContextFromFlowData({
			flowId: "caller-flow-1",
			rowData: JSON.stringify({ nodes: [{ id: "video-1", data: { kind: "video", prompt: "retained prompt", videoResults: [{}] } }] }),
			projectContext: projectContext({ selectedNodeIds: ["video-1"], assets: [] }),
			allowNoTextSource: true,
		});
		expect(facts.referenceVideoNodeIds).toBeUndefined();
		expect(facts.selectedNodeFacts?.[0]?.metadata.prompt).toBe("retained prompt");
		expect(facts.referenceVideoDiagnostics).toEqual([{ nodeId: "video-1", code: "video_media_not_materialized", analysisRequested: false }]);
	});

	it("ignores a ready text projection whose canvas node has no source facts", () => {
		const facts = readWorkflowCanvasProjectContextFromFlowData({
			flowId: "caller-flow-1",
			rowData: JSON.stringify({
				nodes: [{ id: "workflow-execution-status", type: "workflowExecutionNode", data: { kind: "workflowExecution" } }],
			}),
			projectContext: projectContext({
				assets: [{
					...textAsset,
					assetId: "project-node:workflow-execution-status",
					nodeId: "workflow-execution-status",
				}],
			}),
			allowNoTextSource: true,
		});

		expect(facts).toMatchObject({ sourceNodeIds: [], nodes: [] });
	});

	it("promotes the server-owned accepted turn to authoritative lineage when no text node exists", () => {
		const acceptedTurnSource = {
			protocolVersion: "tapcanvas.workflow-accepted-turn-source/v1" as const,
			kind: "public_chat_turn" as const,
			ownerId: "owner-1",
			sourceId: "public-turn-1",
			text: "15秒电商视频",
			fingerprint: "6c6791c32b5d6d9e9eb6a2274de056480c10600d8a06701954f356dba7bda344",
		};
		const facts = readWorkflowCanvasProjectContextFromFlowData({
			flowId: "caller-flow-1",
			rowData: JSON.stringify({
				nodes: [{ id: "workflow-execution-status", type: "workflowExecutionNode", data: { kind: "workflowExecution" } }],
			}),
			projectContext: projectContext({
				assets: [{
					...textAsset,
					assetId: "project-node:workflow-execution-status",
					nodeId: "workflow-execution-status",
				}],
			}),
			allowNoTextSource: true,
			acceptedTurnSource,
		});

		expect(facts).toMatchObject({
			sourceNodeIds: [],
			nodes: [],
			authoritativeSources: [{
				sourceId: "public-turn-1",
				content: "15秒电商视频",
				sourceFingerprint: acceptedTurnSource.fingerprint,
				kind: "public_chat_turn",
			}],
		});
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
