import { describe, expect, it } from "vitest";

import {
	enrichRuntimeWorkflowProjectAssets,
	readWorkflowCanonicalSourceNodeId,
	styleLockFromActiveLookBible,
	styleLockFromTriggerFacts,
} from "./execution.project-context-runtime";
import { createWorkflowProjectContext, projectAssetSnapshot } from "./execution.project-context";
import type { MaterialAssetDto } from "../material/material.schemas";

function runtimeAsset(id: string): MaterialAssetDto {
	return {
		id,
		projectId: "project-1",
		teamId: null,
		folderId: null,
		scope: "project",
		kind: "text",
		name: id,
		favorite: false,
		currentVersion: 1,
		latestVersion: {
			id: `${id}:generation`,
			assetId: id,
			projectId: "project-1",
			version: 1,
			data: { type: "image", imageUrl: `https://assets.example/${id}.png` },
			note: null,
			createdAt: "2026-01-01T00:00:00.000Z",
		},
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
}

it("keeps authored scene contracts available in frozen asset detail inspection", () => {
  const asset = runtimeAsset('scene');
  const referenceContract = { displayName: '教室', assetPurpose: 'blocking_background',
    sceneProfileVersion: 'scene-card/v1', sceneOccupancy: 'none', sceneAnchors: ['东侧窗'],
    prohibitedSceneDrift: ['不得移动主入口'], sceneLightingSpec: { keyLight: '日光' }, negativePrompt: '作者负面提示' };
  if (!asset.latestVersion) throw new Error('Fixture requires a version');
  const version = { ...asset.latestVersion, data: { ...asset.latestVersion.data, ...referenceContract } };
  expect(projectAssetSnapshot({ ...asset, latestVersion: version }).sourceFacts.referenceContract).toEqual(referenceContract);
});

it("does not reintroduce a deleted resource through frozen generation-table enrichment", async () => {
	const old = runtimeAsset("old");
	const current = runtimeAsset("current");
	const url = String(old.latestVersion?.data.imageUrl);
	const result = await enrichRuntimeWorkflowProjectAssets({ visibleAssets: [current],
		frozenAssetIds: ["old", "current"],
		deprecation: { resourceUrls: new Set([url]), nodeIds: new Set<string>(), taskIds: new Set<string>() },
		loadFrozenGeneratedAsset: async () => old });
	expect(result).toEqual([current]);
});

it("does not reintroduce a deleted canvas asset through its recorded taskId when the media URL drifted", async () => {
	const old = runtimeAsset("old");
	const current = runtimeAsset("current");
	const result = await enrichRuntimeWorkflowProjectAssets({ visibleAssets: [current],
		frozenAssetIds: ["old", "current"],
		deprecation: { resourceUrls: new Set<string>(), nodeIds: new Set<string>(), taskIds: new Set(["task-old"]) },
		loadFrozenGeneratedAsset: async () => ({
			...old,
			latestVersion: { ...old.latestVersion!, data: { ...old.latestVersion!.data, taskId: "task-old", imageUrl: "https://assets.example/moved.png" } },
		}) });
	expect(result).toEqual([current]);
});

describe("workflow canonical source marker", () => {
	it("pins the marked source across later derived text nodes", () => {
		expect(readWorkflowCanonicalSourceNodeId({
			nodes: [
				{ id: "eval-input", data: { kind: "text", workflowCanonicalSource: true } },
				{ id: "derived-script", data: { kind: "text" } },
				{ id: "generated-image-output", data: { kind: "text", imageUrl: "https://example.com/image.png" } },
			],
		})).toBe("eval-input");
	});

	it("leaves ordinary canvases unpinned", () => {
		expect(readWorkflowCanonicalSourceNodeId(JSON.stringify({
			nodes: [{ id: "text-1", data: { kind: "text" } }],
		}))).toBeNull();
	});

	it("rejects ambiguous canonical source markers", () => {
		expect(() => readWorkflowCanonicalSourceNodeId({
			nodes: [
				{ id: "source-a", data: { workflowCanonicalSource: true } },
				{ id: "source-b", data: { workflowCanonicalSource: true } },
			],
		})).toThrow("multiple workflow canonical source nodes");
	});
});

describe("runtime workflow project assets", () => {
	it("reconstructs only frozen generation assets missing from the normal visible listing", async () => {
		const requested: string[] = [];
		const visible = runtimeAsset("visible");
		const selectedGeneration = runtimeAsset("selected-generation");
		const assets = await enrichRuntimeWorkflowProjectAssets({
			visibleAssets: [visible],
			frozenAssetIds: ["visible", "selected-generation"],
			loadFrozenGeneratedAsset: async (assetId) => {
				requested.push(assetId);
				return assetId === selectedGeneration.id ? selectedGeneration : null;
			},
		});

		expect(requested).toEqual(["selected-generation"]);
		expect(assets.map((asset) => asset.id)).toEqual(["visible", "selected-generation"]);
	});
});

describe("workflow project asset snapshot source facts", () => {
	it("projects a confirmed Look Bible into the frozen visual style lock", () => {
		const styleLock = styleLockFromActiveLookBible({
			assetId: "look-asset-1",
			assetName: "项目视觉圣经",
			kind: "projectLookBible",
			schemaVersion: "project-look-bible/v1",
			revision: 2,
			projectId: "project-1",
			sourceNodeId: "look-node",
			sourceFlowId: "canvas-1",
			sourceChapterId: null,
			sourceDocument: "用户明确的视觉风格说明",
			sourceDocumentHash: "doc-hash",
			lookBibleHash: "look-hash",
			lookBible: {
				schemaVersion: "project-look-bible/v1",
				name: "夜战日漫",
				summary: "高对比夜间超能力都市",
				globalCore: {
					styleName: "二维赛璐璐",
					summary: "蓝紫夜色与锐利能量边缘",
					visualDirectives: ["二维赛璐璐"],
					negativeDirectives: ["不切换写实媒介"],
					consistencyRules: ["角色服装与能力颜色固定"],
					characterPrompt: "稳定角色身份板",
					imagePrompt: "二维角色参考图",
					videoPrompt: "高速二维战斗动画",
				},
				sections: [{
					id: "impact-night",
					name: "高强度夜战",
					dimension: "motion",
					applicability: "超能力近身交锋",
					directives: ["运动残影只作为动作结果"],
					imagePrompt: "锐利边缘与蓝紫轮廓光",
					videoPrompt: "连续高速跟拍，不重置站位",
				}],
				contentExclusions: [],
			},
			activatedAt: "2026-09-03T00:00:00.000Z",
		});

		expect(styleLock).toEqual(expect.objectContaining({
			styleId: "project-look-bible:look-hash",
			styleName: "二维赛璐璐",
			category: "project-look-bible",
		}));
		expect(styleLock?.stylePrompt).toContain("视频参考：高速二维战斗动画");
		expect(styleLock?.stylePrompt).toContain("模块：高强度夜战");
		expect(styleLock?.stylePrompt).toContain("模块视频参考：连续高速跟拍，不重置站位");
	});

	it("freezes one project visual style anchor for the whole execution", () => {
		const context = createWorkflowProjectContext({
			projectId: "project-1",
			canvasId: "canvas-1",
			principalId: "user-1",
			canvasData: { nodes: [], edges: [] },
			assets: [],
			visualStyle: {
				referenceImages: ["https://assets.example/style.png"],
				styleLock: { styleId: "anime-01", styleName: "统一日漫", stylePrompt: "二维赛璐璐，高对比蓝紫色调" },
				styleFingerprint: "sha256:style-01",
			},
		});

		expect(context.visualStyle).toEqual({
			referenceImages: ["https://assets.example/style.png"],
			styleLock: { styleId: "anime-01", styleName: "统一日漫", stylePrompt: "二维赛璐璐，高对比蓝紫色调" },
			styleFingerprint: "sha256:style-01",
		});
	});

	it("projects explicit per-run style facts without inventing defaults", () => {
		const styleLock = styleLockFromTriggerFacts({
			styleName: "用户指定的赛璐璐夜战",
			visualDirectives: ["高对比蓝紫夜色", "锐利能量边缘"],
			consistencyRules: ["角色服装与能力颜色固定"],
			negativeDirectives: ["不切换写实媒介"],
		});

		expect(styleLock).toEqual(expect.objectContaining({
			styleId: "run-trigger-style-facts",
			styleName: "用户指定的赛璐璐夜战",
			category: "run-trigger-style-facts",
		}));
		expect(styleLock?.stylePrompt).toContain("高对比蓝紫夜色");
		expect(styleLock?.stylePrompt).not.toContain("#");
		expect(styleLockFromTriggerFacts({})).toBeNull();
	});

	it("preserves persisted identity metadata for selected generated assets", () => {
		const snapshot = projectAssetSnapshot({
			id: "asset-selected",
			projectId: "project-1",
			kind: "text",
			name: "legacy generated image",
			currentVersion: 1,
			latestVersion: {
				id: "asset-selected:generation",
				assetId: "asset-selected",
				projectId: "project-1",
				version: 1,
				data: {
					type: "image",
					imageUrl: "https://assets.example/selected.png",
					referenceType: "character",
					roleName: "刘秀",
					physicalIdentityKey: "body-liu-xiu",
					characterAssetRole: "identity_anchor",
					characterProfileVersion: "character-card/v3",
					identityAnchors: ["固定脸部骨相"],
					prohibitedDrift: ["换脸"],
					nodeId: "identity-node",
					workflowExecutionId: "workflow-1",
					taskId: "task-1",
					prompt: "identity board",
				},
				note: null,
				createdAt: "2026-01-01T00:00:00.000Z",
			},
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});

		expect(snapshot.sourceFacts).toEqual(expect.objectContaining({
			referenceType: "character",
			roleName: "刘秀",
			physicalIdentityKey: "body-liu-xiu",
			sourceNodeId: "identity-node",
			workflowExecutionId: "workflow-1",
			taskId: "task-1",
			prompt: "identity board",
		}));
	});

	it("retires unselected legacy workflow images while preserving an explicit selection", () => {
		const legacyAsset = (id: string) => ({
			id,
			projectId: "project-1",
			kind: "text" as const,
			name: `legacy-${id}`,
			currentVersion: 1,
			latestVersion: {
				id: `${id}:generation`,
				assetId: id,
				projectId: "project-1",
				version: 1,
				data: {
					type: "image",
					imageUrl: `https://assets.example/${id}.png`,
					workflowExecutionId: "workflow-old",
				},
				note: null,
				createdAt: "2026-01-01T00:00:00.000Z",
			},
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
		});
		const context = createWorkflowProjectContext({
			projectId: "project-1",
			canvasId: "chapter-1",
			sourceNodeId: "source-1",
			principalId: "user-1",
			canvasData: { nodes: [] },
			assets: [legacyAsset("selected"), legacyAsset("stale")],
			selectedAssetIds: ["selected"],
			now: new Date("2026-01-01T00:00:00.000Z"),
		});

		expect(context.assetSnapshot.find((asset) => asset.assetId === "selected")).toMatchObject({
			productionEligible: true,
			productionExclusionReason: null,
		});
		expect(context.assetSnapshot.find((asset) => asset.assetId === "stale")).toMatchObject({
			productionEligible: false,
			productionExclusionReason: "legacy_untyped_workflow_image",
		});
	});
});


describe("explicit canvas image selection", () => {
	it("freezes selected ready node images by stable asset ID, excluding focus and other canvases", () => {
		const asset = (id: string, flowId = "canvas-1"): MaterialAssetDto => ({
			...runtimeAsset(id),
			origin: { type: "project_node", ownerType: "project", ownerId: "project-1", flowId, nodeId: `node-${id}` },
		});
		const result = createWorkflowProjectContext({
			projectId: "project-1", canvasId: "canvas-1", principalId: "user-1", canvasData: { nodes: [] },
			assets: [asset("a"), asset("b"), asset("c"), asset("d"), asset("focused"), asset("other", "canvas-2")],
			selectedNodeIds: ["node-a", "node-b", "node-c", "node-d", "node-other"],
			selectedAssetIds: ["a"], activeNodeId: "node-focused",
		});
		expect(result.selectedAssetIds).toEqual(["a", "b", "c", "d"]);
		expect(result.selection.assetIds).toEqual(result.selectedAssetIds);
		expect(result.selection.nodeIds).not.toContain("node-focused");
	});
});
