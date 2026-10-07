import { describe, expect, it } from "vitest";
import { resolveWorkflowExecutorPortArtifactContract } from "@tapcanvas/workflow-kernel-protocol";
import type { WorkflowProjectContext } from "./execution.project-context";
import {
	OPENING_FRAME_PLAN_ARTIFACT_TYPE,
	bindOpeningFramePlanAuthoringContract,
	openingFrameUrlFromImageOutput,
	projectOpeningFramePlan,
} from "./execution.opening-frame";

function projectContext(): WorkflowProjectContext {
	return {
		version: 3,
		projectId: "project-1",
		canvasId: "chapter-1",
		sourceNodeId: "source-1",
		selectedAssetIds: [],
		projectAssetIds: ["character-1", "scene-1", "draft-1"],
		timeline: { clips: [] },
		selection: { nodeIds: [], assetIds: [], activeNodeId: null, groupId: null },
		permissions: { principalId: "user-1", projectRead: true, canvasRead: true, assetRead: true, assetWrite: true },
		assetSnapshot: [
			...(["character-1", "scene-1"] as const).map((assetId) => ({
				assetId,
				assetVersion: 1,
				assetVersionId: `${assetId}:version-1`,
				contentFingerprint: `${assetId}:fingerprint`,
				projectId: "project-1",
				name: assetId,
				canonicalName: assetId,
				kind: "image",
				referenceType: assetId === "character-1" ? "character" : "scene",
				approvalStatus: null,
				origin: "material" as const,
				flowId: null,
				nodeId: null,
				mediaKind: "image" as const,
				state: "ready" as const,
				assetUsage: "production" as const,
				assetPurpose: null,
				productionEligible: true,
				productionExclusionReason: null,
				styleFingerprint: null,
				sourceFacts: {
					referenceType: assetId === "character-1" ? "character" : "scene",
					roleName: null,
					physicalIdentityKey: null,
					mediaIdentityKey: `media:${assetId}`,
					characterAssetRole: null,
					characterProfileVersion: null,
					identityAnchors: [],
					prohibitedDrift: [],
					sourceNodeId: null,
					workflowExecutionId: null,
					taskId: null,
					prompt: null,
				},
				updatedAt: "2026-09-23T00:00:00.000Z",
			})),
			{
				assetId: "draft-1",
				assetVersion: 1,
				assetVersionId: "draft-1:version-1",
				contentFingerprint: "draft-1:fingerprint",
				projectId: "project-1",
				name: "draft",
				canonicalName: "draft",
				kind: "image",
				referenceType: null,
				approvalStatus: null,
				origin: "material",
				flowId: null,
				nodeId: null,
				mediaKind: "image",
				state: "ready",
				assetUsage: "preview_only",
				assetPurpose: null,
				productionEligible: false,
				productionExclusionReason: null,
				styleFingerprint: null,
				sourceFacts: {
					referenceType: null,
					roleName: null,
					physicalIdentityKey: null,
					characterAssetRole: null,
					characterProfileVersion: null,
					identityAnchors: [],
					prohibitedDrift: [],
					sourceNodeId: null,
					workflowExecutionId: null,
					taskId: null,
					prompt: null,
				},
				updatedAt: "2026-09-23T00:00:00.000Z",
			},
		],
		capturedAt: "2026-09-23T00:00:00.000Z",
	};
}

describe("parallel opening frame plan", () => {
	it("declares typed edges from the authored frame plan through image output to opening video", () => {
		expect(resolveWorkflowExecutorPortArtifactContract("video.opening-frame.prepare/v1")).toEqual({
			inputArtifactTypes: { "frame-plan": ["tapcanvas.opening-frame-plan/v1"] },
			outputArtifactTypes: { "prompt-package": ["tapcanvas.opening-frame-prompt-package/v1"] },
		});
		expect(resolveWorkflowExecutorPortArtifactContract("tapcanvas.image.generate/v1")?.inputArtifactTypes["prompt-package"])
			.toEqual(["tapcanvas.image-prompt-package/v1", "tapcanvas.opening-frame-prompt-package/v1"]);
		expect(resolveWorkflowExecutorPortArtifactContract("tapcanvas.video.generate/v1")?.inputArtifactTypes["first-frame"])
			.toEqual(["tapcanvas.image/v1"]);
	});

	it("binds semantic reference choices to ready project-image handles", () => {
		const contract = bindOpeningFramePlanAuthoringContract({ allowedFields: [] });
		expect(contract.allowedFields).toEqual(["protocolVersion", "prompt", "negativePrompt", "referenceAssetBindings"]);
		expect(contract.jsonSchema).toMatchObject({
			required: ["protocolVersion", "prompt", "negativePrompt", "referenceAssetBindings"],
			properties: {
				referenceAssetBindings: {
					items: { properties: { assetId: { "x-referenceSource": "project_image" } } },
				},
			},
		});
	});

	it("projects exact ready character and scene handles for an image-generation prompt package", () => {
		const context = projectContext();
		const result = projectOpeningFramePlan({
			framePlan: {
				protocolVersion: OPENING_FRAME_PLAN_ARTIFACT_TYPE,
				prompt: "一帧完整开场构图：人物站在旧宅门内，场景纵深延伸到雨夜庭院。",
				negativePrompt: "不要角色卡版式，不要多格拼图。",
				referenceAssetBindings: [
					{ assetId: "character-1", role: "identity" },
					{ assetId: "scene-1", role: "content", strength: 0.7 },
				],
			},
			projectContext: context,
		});
		expect(result.referenceAssetBindings).toEqual([
			{ assetId: "character-1", role: "identity" },
			{ assetId: "scene-1", role: "content", strength: 0.7 },
		]);
	});

	it("rejects unavailable, preview-only and repeated handles without semantic heuristics", () => {
		const context = projectContext();
		const plan = (referenceAssetBindings: readonly unknown[]) => ({
			protocolVersion: OPENING_FRAME_PLAN_ARTIFACT_TYPE,
			prompt: "one real opening still",
			negativePrompt: "no contact sheet",
			referenceAssetBindings,
		});
		expect(() => projectOpeningFramePlan({ framePlan: plan([{ assetId: "unknown", role: "identity" }]), projectContext: context }))
			.toThrow("outside the frozen ready image scope");
		expect(() => projectOpeningFramePlan({ framePlan: plan([{ assetId: "draft-1", role: "identity" }]), projectContext: context }))
			.toThrow("outside the frozen ready image scope");
		expect(() => projectOpeningFramePlan({ framePlan: plan([
			{ assetId: "character-1", role: "identity" }, { assetId: "character-1", role: "content" },
		]), projectContext: context })).toThrow("is duplicated");
	});

	it("requires a materialized image output with a real HTTP(S) URL", () => {
		expect(openingFrameUrlFromImageOutput({ imageUrl: "https://assets.example/frame.png" }))
			.toBe("https://assets.example/frame.png");
		expect(() => openingFrameUrlFromImageOutput(undefined)).toThrow("materialized first-frame image output");
		expect(() => openingFrameUrlFromImageOutput({ imageUrl: "asset://frame-1" })).toThrow("absolute HTTP(S) URL");
	});
});
