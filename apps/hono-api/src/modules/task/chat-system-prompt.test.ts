import { describe, expect, it } from "vitest";

import {
	buildPublicChatContextFragment,
	buildPublicChatSystemPrompt,
	hasPublicChatExecutionContext,
	type PublicChatPromptContext,
} from "./chat-system-prompt";

function emptyContext(overrides: Partial<PublicChatPromptContext> = {}): PublicChatPromptContext {
	return {
		currentProjectName: null,
		chatMode: null,
		creativePhase: null,
		currentBookId: null,
		currentChapterId: null,
		skill: null,
		referenceImageCount: 0,
		referenceImageSlots: [],
		assetRoleSummary: [],
		hasTargetImage: false,
		hasSelectedNode: false,
		selectedNodeId: null,
		selectedNodeLabel: null,
		selectedNodeKind: null,
		selectedNodeTextPreview: null,
		selectedReference: null,
		...overrides,
	};
}

describe("public chat factual system context", () => {
	it("returns no system override when the request has no scoped execution facts", async () => {
		expect(hasPublicChatExecutionContext(emptyContext())).toBe(false);
		expect(await buildPublicChatSystemPrompt({
			chatContext: emptyContext(),
			canvasProjectId: null,
			canvasFlowId: null,
			planOnly: false,
			forceAssetGeneration: false,
		})).toBe("");
	});

	it("projects current project scope as facts without injecting persona or workflow methodology", async () => {
		const prompt = await buildPublicChatSystemPrompt({
			chatContext: emptyContext({
				currentProjectName: "Project Alpha",
				currentBookId: "book-1",
				currentChapterId: "chapter-2",
			}),
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			planOnly: false,
			forceAssetGeneration: true,
		});

		expect(prompt).toContain("<tapcanvas_context>");
		expect(prompt).toContain("- project: Project Alpha");
		expect(prompt).toContain("- currentBookId: book-1");
		expect(prompt).toContain("- canvasFlowId: flow-1");
		expect(prompt).toContain("- chatMode: none");
		expect(prompt).toContain("- creativePhase: none");
		expect(prompt).toContain("- forceAssetGeneration: true");
		expect(prompt).not.toContain("Persona Directives");
		expect(prompt).not.toContain("必须调用");
		expect(prompt).not.toContain("创作方法论");
	});

	it("preserves the creative phase so the harness can keep a conversation open", async () => {
		const context = {
			...emptyContext({ chatMode: "creative", creativePhase: "prep" }),
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			planOnly: false,
			forceAssetGeneration: false,
		};
		const fragment = buildPublicChatContextFragment(context);
		const prompt = await buildPublicChatSystemPrompt({
			chatContext: context,
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			planOnly: false,
			forceAssetGeneration: false,
		});

		expect(fragment).toContain("- chatMode: creative");
		expect(fragment).toContain("- creativePhase: prep");
		expect(prompt).toContain("- chatMode: creative");
		expect(prompt).toContain("- creativePhase: prep");
	});

	it("treats selected media and skill references as structural execution context", () => {
		const context = emptyContext({
			skill: {
				id: "skill-1",
				source: "system",
				key: "tapcanvas-video-workflow",
				name: "Video workflow",
			},
			referenceImageCount: 1,
			referenceImageSlots: [
				{
					slot: "reference_image_1",
					url: "https://cdn.example/reference.png",
					role: "character",
					label: "Hero",
					note: null,
				},
			],
			assetRoleSummary: ["character"],
			hasTargetImage: false,
			hasSelectedNode: true,
			selectedNodeId: "node-1",
			selectedNodeKind: "image",
		});

		expect(hasPublicChatExecutionContext(context)).toBe(true);
	});

	it("projects a clicked generation proposal as immutable factual context", async () => {
		const prompt = await buildPublicChatSystemPrompt({
			chatContext: emptyContext({
				generationProposal: {
					version: 1,
					proposalId: "data-card-1",
					kind: "video",
					title: "15秒日式战斗画面视频提示词",
					prompt: "雨夜城市遗迹中的连续动作镜头",
					model: "doubao-seedance-2.0",
					parameters: [{ label: "时长", value: "15秒" }],
					action: "生成",
					nodeId: "node-1",
				},
			}),
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			planOnly: false,
			forceAssetGeneration: false,
		});
		expect(prompt).toContain("proposalId: data-card-1");
		expect(prompt).toContain("kind: video");
		expect(prompt).toContain("prompt: 雨夜城市遗迹中的连续动作镜头");
		expect(prompt).toContain("model: doubao-seedance-2.0");
	});

	it("projects exact executable audio model facts without choosing a default", () => {
		const fragment = buildPublicChatContextFragment({
			...emptyContext({
				enabledModelCatalogSummary: {
					imageModels: [],
					videoModels: [],
					audioModels: [{
						modelKey: "doubao-speech-exact",
						label: "Doubao Speech",
						audioType: "speech",
						engine: "doubao",
						pricingCost: 8,
					}],
					videoFinishingModels: [],
				},
			}),
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			planOnly: false,
			forceAssetGeneration: false,
		});

		expect(fragment).toContain("- enabledAudioModels.count: 1");
		expect(fragment).toContain("modelKey=doubao-speech-exact");
		expect(fragment).toContain("audioType=speech");
		expect(fragment).toContain("engine=doubao");
	});

	it("does not report an unloaded model catalog as an available empty catalog", () => {
		const fragment = buildPublicChatContextFragment({
			...emptyContext(),
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			planOnly: false,
			forceAssetGeneration: false,
		});

		expect(fragment).not.toContain("enabledModelCatalogSummary.status");
		expect(fragment).not.toContain("enabledVideoModels.count: 0");
	});

	it("reports zero models only after a real catalog load returns an empty projection", () => {
		const fragment = buildPublicChatContextFragment({
			...emptyContext({
				enabledModelCatalogSummary: {
					imageModels: [],
					videoModels: [],
					audioModels: [],
					videoFinishingModels: [],
				},
			}),
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			planOnly: false,
			forceAssetGeneration: false,
		});

		expect(fragment).toContain("enabledModelCatalogSummary.status: available");
		expect(fragment).toContain("enabledVideoModels.count: 0");
	});

	it("clips free-form previews while preserving deterministic identifiers", () => {
		const fragment = buildPublicChatContextFragment({
			...emptyContext({
				selectedNodeId: "node-1",
				selectedNodeTextPreview: "x".repeat(1_000),
			}),
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			planOnly: true,
			forceAssetGeneration: false,
		});

		expect(fragment).toContain("- selectedNodeId: node-1");
		expect(fragment).toContain("- planOnly: true");
		const previewLine = fragment
			.split("\n")
			.find((line) => line.startsWith("- selectedNodeTextPreview:"));
		expect(previewLine?.length).toBeLessThan(640);
		expect(previewLine).toMatch(/…$/);
	});

	it("preserves selected-reference lifecycle facts without interpreting them", async () => {
		const prompt = await buildPublicChatSystemPrompt({
			chatContext: emptyContext({
				hasSelectedNode: true,
				selectedNodeId: "shot-7",
				selectedReference: {
					nodeId: "shot-7",
					label: "Shot 7",
					kind: "storyboard",
					imageUrl: "https://cdn.example/shot-7.png",
					sourceUrl: null,
					bookId: "book-1",
					chapterId: "chapter-2",
					shotNo: 7,
					productionLayer: "anchors",
					creationStage: "shot_anchor_lock",
					approvalStatus: "approved",
					hasUpstreamTextEvidence: true,
					hasDownstreamComposeVideo: false,
					storyboardSelectionContext: null,
				},
			}),
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			planOnly: false,
			forceAssetGeneration: false,
		});

		expect(prompt).toContain("- selectedReference.shotNo: 7");
		expect(prompt).toContain("- selectedReference.approvalStatus: approved");
	});
});
