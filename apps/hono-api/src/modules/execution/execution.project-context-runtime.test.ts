import { describe, expect, it } from "vitest";

import { enrichRuntimeWorkflowProjectAssets, readWorkflowCanonicalSourceNodeId } from "./execution.project-context-runtime";
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
