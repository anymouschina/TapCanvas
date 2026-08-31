import { describe, expect, it, vi } from "vitest";
import type { MaterialAssetDto } from "../material/material.schemas";
import { createWorkflowAssetResolver, WorkflowAssetResolverError } from "./execution.asset-resolver";
import { createWorkflowProjectContext } from "./execution.project-context";

function asset(input: Readonly<{
	id: string;
	projectId: string;
	url: string;
	expiresAt?: string;
	status?: string;
	previewOnly?: boolean;
}>): MaterialAssetDto {
	return {
		id: input.id,
		projectId: input.projectId,
		teamId: null,
		folderId: null,
		scope: "project",
		kind: "character",
		name: input.id,
		favorite: false,
		currentVersion: 1,
		latestVersion: {
			id: `${input.id}:v1`,
			assetId: input.id,
			projectId: input.projectId,
			version: 1,
			data: {
				imageUrl: input.url,
				...(input.previewOnly ? {
					assetUsage: "preview_only",
					assetPurpose: "story_preview",
					productionEligible: false,
				} : {}),
				...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
				...(input.status ? { status: input.status } : {}),
			},
			note: null,
			createdAt: "2026-08-17T00:00:00.000Z",
		},
		createdAt: "2026-08-17T00:00:00.000Z",
		updatedAt: "2026-08-17T00:00:00.000Z",
		origin: { type: "project_node", ownerType: "project", ownerId: input.projectId, flowId: `flow-${input.projectId}`, nodeId: `node-${input.id}` },
	};
}

function context(projectId: string, assets: readonly MaterialAssetDto[]) {
	return createWorkflowProjectContext({
		projectId,
		canvasId: `flow-${projectId}`,
		principalId: "user-1",
		canvasData: { nodes: [], edges: [] },
		assets,
		now: new Date("2026-08-17T01:00:00.000Z"),
	});
}

describe("workflow ProjectContext and Asset Resolver", () => {
	it("marks an asset unavailable when the chapter canvas carries an explicit provider-rejected URL", () => {
		const rejected = asset({
			id: "rejected-reference",
			projectId: "project-a",
			url: "https://cdn.test/reference.png",
		});
		const projectContext = createWorkflowProjectContext({
			projectId: "project-a",
			canvasId: "chapter-flow-1",
			principalId: "user-1",
			canvasData: {
				nodes: [{
					id: "failed-video",
					data: {
						status: "failed",
						providerRejectedUrls: ["https://cdn.test/reference.png?provider-signature=one"],
					},
				}],
				edges: [],
			},
			assets: [rejected],
		});
		expect(projectContext.assetSnapshot[0]).toMatchObject({
			assetId: "rejected-reference",
			approvalStatus: "rejected",
			state: "unavailable",
			productionEligible: false,
		});
	});

	it("marks the exact provider-rejected reference unavailable even after its signed URL changes", () => {
		const rejected = asset({
			id: "rejected-reference",
			projectId: "project-a",
			url: "https://cdn.test/reference.png?signature=fresh",
		});
		const projectContext = createWorkflowProjectContext({
			projectId: "project-a",
			canvasId: "chapter-flow-1",
			principalId: "user-1",
			canvasData: {
				nodes: [{
					id: "failed-video",
					data: {
						status: "failed",
						providerRejectedReferenceIds: ["rejected-reference"],
					},
				}],
				edges: [],
			},
			assets: [rejected],
		});
		expect(projectContext.assetSnapshot[0]).toMatchObject({
			assetId: "rejected-reference",
			approvalStatus: "rejected",
			state: "unavailable",
			productionEligible: false,
		});
	});

	it("builds a fresh project-scoped asset view for each equipped workflow run", async () => {
		const assetA = asset({ id: "asset-a", projectId: "project-a", url: "https://cdn.test/a.png" });
		const assetB = asset({ id: "asset-b", projectId: "project-b", url: "https://cdn.test/b.png" });
		const contextA = context("project-a", [assetA, assetB]);
		const contextB = context("project-b", [assetA, assetB]);
		expect(contextA.projectAssetIds).toEqual(["asset-a"]);
		expect(contextB.projectAssetIds).toEqual(["asset-b"]);
		const resolverA = createWorkflowAssetResolver({ context: contextA, loadVisibleAssets: async () => [assetA, assetB] });
		const resolverB = createWorkflowAssetResolver({ context: contextB, loadVisibleAssets: async () => [assetA, assetB] });
		expect((await resolverA.listProjectAssets()).map((item) => item.assetId)).toEqual(["asset-a"]);
		expect((await resolverB.listProjectAssets()).map((item) => item.assetId)).toEqual(["asset-b"]);
	});

	it("removes text-only and draft visual nodes from the frozen selected image inputs", () => {
		const draft: MaterialAssetDto = {
			id: "draft-role-card",
			projectId: "project-a",
			teamId: null,
			folderId: null,
			scope: "project",
			kind: "character",
			name: "李长安",
			favorite: false,
			currentVersion: 1,
			latestVersion: {
				id: "draft-role-card:v1",
				assetId: "draft-role-card",
				projectId: "project-a",
				version: 1,
				data: { roleName: "李长安", productionEligible: true },
				note: null,
				createdAt: "2026-08-17T00:00:00.000Z",
			},
			createdAt: "2026-08-17T00:00:00.000Z",
			updatedAt: "2026-08-17T00:00:00.000Z",
			origin: {
				type: "project_node",
				ownerType: "project",
				ownerId: "project-a",
				flowId: "flow-project-a",
				nodeId: "draft-role-card",
			},
		};
		const ready = asset({ id: "ready-role-card", projectId: "project-a", url: "https://cdn.test/ready.png" });
		const projectContext = createWorkflowProjectContext({
			projectId: "project-a",
			canvasId: "flow-project-a",
			principalId: "user-1",
			canvasData: { nodes: [], edges: [] },
			assets: [draft, ready],
			selectedAssetIds: [draft.id, ready.id],
		});

		expect(projectContext.selectedAssetIds).toEqual([ready.id]);
		expect(projectContext.selection.assetIds).toEqual([ready.id]);
		expect(projectContext.projectAssetIds).toEqual([draft.id, ready.id]);
	});

	it("never exposes an asset missing from the frozen permission-filtered snapshot", async () => {
		const visible = asset({ id: "visible", projectId: "project-a", url: "https://cdn.test/visible.png" });
		const hidden = asset({ id: "hidden", projectId: "project-a", url: "https://cdn.test/hidden.png" });
		const resolver = createWorkflowAssetResolver({
			context: context("project-a", [visible]),
			loadVisibleAssets: async () => [visible, hidden],
		});
		await expect(resolver.getAsset("hidden")).rejects.toMatchObject({ code: "workflow_asset_forbidden" } satisfies Partial<WorkflowAssetResolverError>);
		expect((await resolver.listProjectAssets()).map((item) => item.assetId)).toEqual(["visible"]);
	});

	it("never resolves a story preview asset as a production workflow resource", async () => {
		const preview = asset({
			id: "story-preview-board-1",
			projectId: "project-a",
			url: "https://cdn.test/story-preview-board-1.png",
			previewOnly: true,
		});
		const resolver = createWorkflowAssetResolver({
			context: context("project-a", [preview]),
			loadVisibleAssets: async () => [preview],
		});

		await expect(resolver.resolveAssetResource(preview.id, "image")).rejects.toMatchObject({
			code: "workflow_asset_preview_only",
		} satisfies Partial<WorkflowAssetResolverError>);
	});

	it("fails explicitly when a character asset version changes after ProjectContext is frozen", async () => {
		const frozen = asset({ id: "hero", projectId: "project-a", url: "https://cdn.test/hero-v1.png" });
		const changed: MaterialAssetDto = {
			...frozen,
			currentVersion: 2,
			latestVersion: frozen.latestVersion ? {
				...frozen.latestVersion,
				id: "hero:v2",
				version: 3,
				data: { ...frozen.latestVersion.data, imageUrl: "https://cdn.test/hero-v2.png" },
			} : null,
		};
		const resolver = createWorkflowAssetResolver({
			context: context("project-a", [frozen]),
			loadVisibleAssets: async () => [changed],
		});
		await expect(resolver.resolveAssetResource("hero", "image")).rejects.toMatchObject({
			code: "workflow_asset_version_drift",
		} satisfies Partial<WorkflowAssetResolverError>);
	});

	it("allows an unchanged projected project-node asset after another canvas node advances the canvas revision", async () => {
		const frozen = asset({ id: "project-node:chapter:chapter-1:hero", projectId: "project-a", url: "https://cdn.test/hero.png" });
		const canvasRevisionOnly: MaterialAssetDto = {
			...frozen,
			currentVersion: 9,
			latestVersion: frozen.latestVersion ? {
				...frozen.latestVersion,
				id: `${frozen.id}:revision:8`,
				version: 9,
				data: { ...frozen.latestVersion.data, canvasRevision: 8 },
			} : null,
		};
		const resolver = createWorkflowAssetResolver({
			context: context("project-a", [frozen]),
			loadVisibleAssets: async () => [canvasRevisionOnly],
		});
		await expect(resolver.resolveAssetResource(frozen.id, "image")).resolves.toMatchObject({
			assetId: frozen.id,
			url: "https://cdn.test/hero.png",
		});
	});

	it("allows lifecycle metadata to advance when projected project-node media and identity stay unchanged", async () => {
		const frozen = asset({ id: "project-node:chapter:chapter-1:gang", projectId: "project-a", url: "https://cdn.test/gang.png" });
		const lifecycleAdvanced: MaterialAssetDto = {
			...frozen,
			currentVersion: 12,
			latestVersion: frozen.latestVersion ? {
				...frozen.latestVersion,
				id: `${frozen.id}:revision:11`,
				version: 12,
				data: {
					...frozen.latestVersion.data,
					approvalStatus: "approved",
					canvasRevision: 11,
					status: "success",
					urlExpiresAt: "2026-09-18T00:00:00.000Z",
				},
			} : null,
		};
		const resolver = createWorkflowAssetResolver({
			context: context("project-a", [frozen]),
			loadVisibleAssets: async () => [lifecycleAdvanced],
		});

		await expect(resolver.resolveAssetResource(frozen.id, "image")).resolves.toMatchObject({
			assetId: frozen.id,
			url: "https://cdn.test/gang.png",
		});
	});

	it("allows workflow production-stage metadata to compact after an image is materialized", async () => {
		const base = asset({
			id: "project-node:chapter:chapter-2:generated-scene",
			projectId: "project-a",
			url: "https://cdn.test/generated-scene.png",
		});
		const frozen: MaterialAssetDto = {
			...base,
			latestVersion: base.latestVersion ? {
				...base.latestVersion,
				data: {
					...base.latestVersion.data,
					creationStage: "single_variable_expansion",
					productionLayer: "expansion",
					referenceType: "scene",
					sceneName: "无人巷子",
					styleFingerprint: "sha256:locked-look",
				},
			} : null,
		};
		const materialized: MaterialAssetDto = {
			...base,
			currentVersion: 78,
			latestVersion: base.latestVersion ? {
				...base.latestVersion,
				id: `${base.id}:revision:77`,
				version: 78,
				data: {
					...base.latestVersion.data,
					referenceType: "scene",
					sceneName: "无人巷子",
					styleFingerprint: "sha256:locked-look",
				},
			} : null,
		};
		const resolver = createWorkflowAssetResolver({
			context: context("project-a", [frozen]),
			loadVisibleAssets: async () => [materialized],
		});

		await expect(resolver.resolveAssetResource(frozen.id, "image")).resolves.toMatchObject({
			assetId: frozen.id,
			url: "https://cdn.test/generated-scene.png",
		});
	});

	it("still rejects a lifecycle-advanced projected node when its current status is rejected", async () => {
		const frozen = asset({ id: "project-node:chapter:chapter-1:rejected", projectId: "project-a", url: "https://cdn.test/rejected.png" });
		const rejected: MaterialAssetDto = {
			...frozen,
			currentVersion: 2,
			latestVersion: frozen.latestVersion ? {
				...frozen.latestVersion,
				id: `${frozen.id}:revision:1`,
				version: 2,
				data: { ...frozen.latestVersion.data, approvalStatus: "rejected", canvasRevision: 1 },
			} : null,
		};
		const resolver = createWorkflowAssetResolver({
			context: context("project-a", [frozen]),
			loadVisibleAssets: async () => [rejected],
		});

		await expect(resolver.resolveAssetResource(frozen.id, "image")).rejects.toMatchObject({
			code: "workflow_asset_resource_unavailable",
		} satisfies Partial<WorkflowAssetResolverError>);
	});

	it("refreshes an expired URL by stable asset id at execution time", async () => {
		const expired = asset({ id: "asset-a", projectId: "project-a", url: "https://signed.test/old.png", expiresAt: "2026-08-17T00:30:00.000Z" });
		const refreshed = asset({ id: "asset-a", projectId: "project-a", url: "https://signed.test/fresh.png", expiresAt: "2026-08-17T02:00:00.000Z" });
		const refreshAsset = vi.fn(async () => refreshed);
		const resolver = createWorkflowAssetResolver({
			context: context("project-a", [expired]),
			loadVisibleAssets: async () => [expired],
			refreshAsset,
			now: () => new Date("2026-08-17T01:00:00.000Z"),
		});
		await expect(resolver.resolveAssetResource("asset-a", "image")).resolves.toMatchObject({
			assetId: "asset-a",
			url: "https://signed.test/fresh.png",
		});
		expect(refreshAsset).toHaveBeenCalledWith("asset-a");
	});
});
