import { describe, expect, it } from "vitest";

import {
	buildChatAssistantSystemPrompt,
	buildPublicChatRuntimeSkillPrompt,
	buildChatSkillSystemPrompt,
	buildPublicChatSystemPrompt,
	buildPublicChatBaseSystemPrompt,
	buildPublicChatContextFragment,
	buildPublicChatResponsePolicyPrompt,
	buildPersonaContextPrompt,
	extractPersonaIdentity,
	resolvePersonaRootCandidates,
} from "./chat-system-prompt";

describe("chat system prompt helpers", () => {
	it("builds base skill prompt without skill content", () => {
		expect(buildChatSkillSystemPrompt(null)).toContain("请始终用中文回答");
		expect(buildChatSkillSystemPrompt(null)).not.toContain("TapCanvas Workflow Orchestrator 能力");
	});

	it("keeps skill prompt minimal even when a skill is selected", () => {
		const prompt = buildChatSkillSystemPrompt({
			key: "storyboard",
			name: "Storyboard",
			content: "Do something",
		});
		expect(prompt).toContain("请始终用中文回答");
		expect(prompt).not.toContain("# Skill:");
		expect(prompt).not.toContain("Do something");
	});

	it("builds a thin base system plus a separate factual context fragment", () => {
		const basePrompt = buildPublicChatBaseSystemPrompt({
			forceAssetGeneration: true,
			personaIdentity: {
				name: "小T",
				product: "TapCanvas",
				role: "AI canvas orchestrator",
			},
		});
		const responsePolicyPrompt = buildPublicChatResponsePolicyPrompt();
		const contextPrompt = buildPublicChatContextFragment({
			skill: {
				key: "storyboard",
				name: "Storyboard",
				content: "Do something",
			},
			currentProjectName: "斗破苍穹",
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			planOnly: false,
			forceAssetGeneration: true,
			referenceImageCount: 2,
			referenceImageSlots: [
				{
					slot: "图1",
					url: "https://example.com/frame-1.png",
					role: "角色参考",
					label: "镜头 1",
					note: "主角外观锚点",
				},
				{
					slot: "图2",
					url: "https://example.com/frame-2.png",
					role: "场景参考",
					label: "山门远景",
					note: "空间与光线延续",
				},
			],
			assetRoleSummary: ["reference:2"],
			hasTargetImage: false,
			hasSelectedNode: true,
			selectedNodeId: "node-1",
			selectedNodeLabel: "镜头 1",
			selectedNodeKind: "storyboardShot",
			selectedNodeTextPreview: "韩立抬头看向远处山门，风声压过人群低语。",
			enabledModelCatalogSummary: {
				imageModels: [
					{
						vendorKey: "gemini",
						modelKey: "nano-banana-pro",
						modelAlias: "nano-banana-pro",
						labelZh: "Nano Banana Pro",
						availability: "system",
						pricingCost: 12,
						useCases: ["小说分镜关键帧", "角色一致性"],
						imageOptions: {
							defaultAspectRatio: "16:9",
							defaultImageSize: "2K",
							aspectRatioOptions: ["16:9", "9:16"],
							imageSizeOptions: [
								{ value: "2K", label: "2K", priceLabel: null },
								{ value: "4K", label: "4K", priceLabel: null },
							],
							resolutionOptions: ["1536x864"],
							supportsReferenceImages: true,
							supportsTextToImage: true,
							supportsImageToImage: true,
						},
					},
				],
				videoModels: [
					{
						vendorKey: "veo",
						modelKey: "veo3.1-fast",
						modelAlias: "veo3.1-fast",
						labelZh: "Veo 3.1 Fast",
						availability: "system+user",
						pricingCost: 20,
						useCases: ["快速预演", "情绪镜头"],
						videoOptions: {
							defaultDurationSeconds: 5,
							defaultResolution: "720p",
							maxDurationSeconds: 8,
							durationOptions: [
								{ value: 5, label: "5s", priceLabel: null },
								{ value: 8, label: "8s", priceLabel: null },
							],
							sizeOptions: [
								{
									value: "1280x720",
									label: "720p 横屏",
									orientation: "landscape",
									aspectRatio: "16:9",
									priceLabel: null,
								},
							],
							resolutionOptions: [
								{ value: "720p", label: "720p", priceLabel: null },
								{ value: "1080p", label: "1080p", priceLabel: null },
							],
							orientationOptions: [
								{
									value: "landscape",
									label: "横屏",
									size: null,
									aspectRatio: null,
								},
							],
						},
					},
				],
			},
			enabledModelCatalogSummaryError: null,
			selectedReference: {
				nodeId: "node-1",
				label: "镜头 1",
				kind: "storyboardShot",
				imageUrl: "https://example.com/frame-1.png",
				sourceUrl: "/project-data/books/book-1/chapter-2.md",
				bookId: "book-1",
				chapterId: "2",
				shotNo: 12,
				productionLayer: "anchors",
				creationStage: "shot_anchor_lock",
				approvalStatus: "approved",
				hasUpstreamTextEvidence: true,
				hasDownstreamComposeVideo: false,
				storyboardSelectionContext: null,
			},
		});
		expect(basePrompt).toContain("## Assistant Contract");
		expect(basePrompt).toContain("你是 TapCanvas 的原生 AI 搭档，小T。你的角色是 AI canvas orchestrator。");
		expect(basePrompt).toContain("当前运行在 TapCanvas agents chat 通道。");
		expect(basePrompt).toContain("具体如何规划、取证、执行与拆分由 agents-cli 自主决定。");
		expect(basePrompt).toContain("本轮请求显式要求真实资产交付。");
		expect(basePrompt).not.toContain("enabledImageModels.count");
		expect(basePrompt).not.toContain("selectedReference.nodeId");
		expect(basePrompt).not.toContain("allowOverwrite=true");
		expect(basePrompt).not.toContain("structuredPrompt");
		expect(basePrompt).not.toContain("图1 / 图2 / 图3");
		expect(responsePolicyPrompt).toBe("");
		expect(contextPrompt).toContain("<tapcanvas_context>");
		expect(contextPrompt).toContain("planOnly: false");
		expect(contextPrompt).toContain("forceAssetGeneration: true");
		expect(contextPrompt).toContain("referenceImageCount: 2");
		expect(contextPrompt).toContain("referenceImageSlots: 图1 | 镜头 1 | role=角色参考 | note=主角外观锚点");
		expect(contextPrompt).toContain("hasSelectedNode: true");
		expect(contextPrompt).toContain("selectedNodeId: node-1");
		expect(contextPrompt).toContain("selectedNodeLabel: 镜头 1");
		expect(contextPrompt).toContain("selectedNodeKind: storyboardShot");
		expect(contextPrompt).toContain("selectedNodeTextPreview: 韩立抬头看向远处山门");
		expect(contextPrompt).toContain("enabledModelCatalogSummary.status: available");
		expect(contextPrompt).toContain("enabledImageModels.count: 1");
		expect(contextPrompt).toContain("enabledImageModel[1]: alias=nano-banana-pro");
		expect(contextPrompt).toContain("defaultAspectRatio=16:9");
		expect(contextPrompt).toContain("defaultImageSize=2K");
		expect(contextPrompt).toContain("aspectRatios=16:9,9:16");
		expect(contextPrompt).toContain("imageSizes=2K,4K");
		expect(contextPrompt).toContain("supportsReferenceImages=true");
		expect(contextPrompt).toContain("enabledVideoModels.count: 1");
		expect(contextPrompt).toContain("enabledVideoModel[1]: alias=veo3.1-fast");
		expect(contextPrompt).toContain("maxDuration=8s");
		expect(contextPrompt).toContain("durations=5s,8s");
		expect(contextPrompt).toContain("defaultResolution=720p");
		expect(contextPrompt).toContain("resolutions=720p,1080p");
		expect(contextPrompt).toContain("selectedReference.nodeId: node-1");
		expect(contextPrompt).toContain("selectedReference.bookId: book-1");
		expect(contextPrompt).toContain("selectedReference.chapterId: 2");
		expect(contextPrompt).toContain("selectedReference.shotNo: 12");
		expect(contextPrompt).toContain("selectedReference.productionLayer: anchors");
		expect(contextPrompt).toContain("selectedReference.creationStage: shot_anchor_lock");
		expect(contextPrompt).toContain("selectedReference.approvalStatus: approved");
		expect(contextPrompt).toContain("</tapcanvas_context>");
	});

	it("keeps single video requests as evidence requirements instead of hard-coded sop", () => {
		const prompt = buildChatAssistantSystemPrompt({
			skill: null,
			currentProjectName: "TapCanvas Demo",
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			planOnly: false,
			forceAssetGeneration: false,
			referenceImageCount: 1,
			referenceImageSlots: [
				{
					slot: "图1",
					url: "https://example.com/keyframe.png",
					role: "参考图",
					label: "已确认关键帧",
					note: "首帧锁定",
				},
			],
			assetRoleSummary: ["reference:1"],
			hasTargetImage: false,
			hasSelectedNode: true,
			selectedNodeId: "node-2",
			selectedNodeLabel: "已确认关键帧",
			selectedNodeKind: "image",
			selectedNodeTextPreview: "少女转身回望，风吹起发梢。",
			selectedReference: {
				nodeId: "node-2",
				label: "已确认关键帧",
				kind: "image",
				imageUrl: "https://example.com/keyframe.png",
				sourceUrl: null,
				bookId: null,
				chapterId: null,
				shotNo: null,
				productionLayer: "expansion",
				creationStage: "single_variable_expansion",
				approvalStatus: "needs_confirmation",
				hasUpstreamTextEvidence: false,
				hasDownstreamComposeVideo: false,
				storyboardSelectionContext: null,
			},
			personaIdentity: null,
		});
		expect(prompt).not.toContain("【单视频快捷创作 SOP】");
	});

	it("marks enabled model summary as unavailable instead of fabricating model facts", () => {
		const prompt = buildChatAssistantSystemPrompt({
			skill: null,
			currentProjectName: "TapCanvas Demo",
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			planOnly: false,
			forceAssetGeneration: false,
			referenceImageCount: 0,
			referenceImageSlots: [],
			assetRoleSummary: [],
			hasTargetImage: false,
			hasSelectedNode: false,
			selectedNodeId: null,
			selectedNodeLabel: null,
			selectedNodeKind: null,
			selectedNodeTextPreview: null,
			enabledModelCatalogSummary: null,
			enabledModelCatalogSummaryError: "model catalog unavailable",
			selectedReference: null,
			personaIdentity: null,
		});

		expect(prompt).toContain("enabledModelCatalogSummary.status: unavailable");
		expect(prompt).toContain("enabledModelCatalogSummary.error: model catalog unavailable");
	});

	it("keeps project-scoped plain chat on the project evidence contract without runtime skills", async () => {
		const prompt = await buildPublicChatSystemPrompt({
			chatContext: {
				skill: null,
				currentProjectName: "TapCanvas Demo",
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
			},
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			planOnly: false,
			forceAssetGeneration: false,
		});
		expect(prompt).toContain("当前运行在 TapCanvas agents chat 通道。");
		expect(prompt).not.toContain("必须先调用相关 project/book/material/flow tools 取证");
		expect(prompt).not.toContain("## Runtime Skill Hints");
		expect(prompt).not.toContain("## Runtime Skill:");
		expect(prompt).toContain("## Assistant Contract");
		expect(prompt).not.toContain("## Response Policy");
		expect(prompt).toContain("<tapcanvas_context>");
	});

	it("loads runtime skill bundle for project-scoped storyboard continuity chats", async () => {
		const prompt = await buildPublicChatRuntimeSkillPrompt({
			chatContext: {
				skill: null,
				currentProjectName: "TapCanvas Demo",
				referenceImageCount: 1,
				referenceImageSlots: [
					{
						slot: "图1",
						url: "https://example.com/frame-12.png",
						role: "参考图",
						label: "镜头 12",
						note: "继续当前镜头",
					},
				],
				assetRoleSummary: ["reference:1"],
				hasTargetImage: false,
				hasSelectedNode: true,
				selectedNodeId: "node-1",
				selectedNodeLabel: "镜头 12",
				selectedNodeKind: "storyboardShot",
				selectedNodeTextPreview: "少女从巷口回头，雨水落在肩头。",
				selectedReference: {
					nodeId: "node-1",
					label: "镜头 12",
					kind: "storyboardShot",
					imageUrl: "https://example.com/frame-12.png",
					sourceUrl: null,
					bookId: "book-1",
					chapterId: "12",
					shotNo: 12,
					productionLayer: "anchors",
					creationStage: "shot_anchor_lock",
					approvalStatus: "approved",
					hasUpstreamTextEvidence: true,
					hasDownstreamComposeVideo: false,
					storyboardSelectionContext: null,
				},
			},
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
		});
		expect(prompt).toBe("");
	});

	it("keeps runtime skill bundle disabled when only project scope exists without factual execution context", async () => {
		const prompt = await buildPublicChatRuntimeSkillPrompt({
			chatContext: {
				skill: null,
				currentProjectName: "TapCanvas Demo",
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
			},
			canvasProjectId: "project-1",
			canvasFlowId: null,
		});
		expect(prompt).toBe("");
	});

	it("keeps plain project chats lightweight instead of always loading workflow skills", async () => {
		const prompt = await buildPublicChatRuntimeSkillPrompt({
			chatContext: {
				skill: null,
				currentProjectName: "TapCanvas Demo",
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
			},
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
		});
		expect(prompt).toBe("");
	});

	it("keeps agents chat system prompt thin even when execution context exists", async () => {
		const prompt = await buildPublicChatSystemPrompt({
			chatContext: {
				skill: null,
				currentProjectName: "TapCanvas Demo",
				referenceImageCount: 1,
				referenceImageSlots: [
					{
						slot: "图1",
						url: "https://example.com/frame-12.png",
						role: "参考图",
						label: "镜头 12",
						note: null,
					},
				],
				assetRoleSummary: ["reference:1"],
				hasTargetImage: false,
				hasSelectedNode: true,
				selectedNodeId: "node-1",
				selectedNodeLabel: "镜头 12",
				selectedNodeKind: "storyboardShot",
				selectedNodeTextPreview: "少女从巷口回头，雨水落在肩头。",
				selectedReference: {
					nodeId: "node-1",
					label: "镜头 12",
					kind: "storyboardShot",
					imageUrl: "https://example.com/frame-12.png",
					sourceUrl: null,
					bookId: "book-1",
					chapterId: "12",
					shotNo: 12,
					productionLayer: "anchors",
					creationStage: "shot_anchor_lock",
					approvalStatus: "approved",
					hasUpstreamTextEvidence: true,
					hasDownstreamComposeVideo: false,
					storyboardSelectionContext: null,
				},
			},
			canvasProjectId: "project-1",
			canvasFlowId: "flow-1",
			planOnly: false,
			forceAssetGeneration: false,
		});
		expect(prompt).toContain("你是 TapCanvas 的原生 AI 搭档");
		expect(prompt).not.toContain("## Runtime Skill Hints");
		expect(prompt).not.toContain("### tapcanvas-prompt-specialists");
		expect(prompt).toContain("具体如何规划、取证、执行与拆分由 agents-cli 自主决定。");
		expect(prompt).not.toContain("TodoWrite");
		expect(prompt).not.toContain("## Response Policy");
		expect(prompt).toContain("<tapcanvas_context>");
	});

	it("does not load continuity runtime skill for non-project chats", async () => {
		const prompt = await buildPublicChatRuntimeSkillPrompt({
			chatContext: {
				skill: null,
				currentProjectName: null,
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
			},
			canvasProjectId: null,
			canvasFlowId: null,
		});
		expect(prompt).toBe("");
	});

	it("includes persona context and directives when SOUL and IDENTITY are loaded", () => {
		const files = [
			{
				name: "IDENTITY.md" as const,
				path: "apps/agents-cli/IDENTITY.md",
				content: "# IDENTITY\n- Name: 小T\n- Product: TapCanvas\n- Role: AI canvas orchestrator",
			},
			{
				name: "SOUL.md" as const,
				path: "apps/agents-cli/SOUL.md",
				content: "# SOUL\n保持直接、清醒、基于事实",
			},
		];
		const prompt = buildPersonaContextPrompt({
			workspaceRoot: "/repo/apps/agents-cli",
			files,
		});
		const identity = extractPersonaIdentity(files);
		expect(prompt).toContain("## Workspace Context");
		expect(prompt).toContain("### IDENTITY.md (apps/agents-cli/IDENTITY.md)");
		expect(prompt).toContain("### SOUL.md (apps/agents-cli/SOUL.md)");
		expect(prompt).toContain("- Name: 小T");
		expect(prompt).toContain("保持直接、清醒、基于事实");
		expect(prompt).toContain("IDENTITY.md 定义你是谁；SOUL.md 定义你如何判断、如何行动。两者都应持续生效。");
		expect(identity).toEqual({
			name: "小T",
			product: "TapCanvas",
			role: "AI canvas orchestrator",
		});
	});

	it("resolves persona roots for both repo root and apps/hono-api cwd", () => {
		const repoRoots = resolvePersonaRootCandidates("/repo");
		const apiRoots = resolvePersonaRootCandidates("/repo/apps/hono-api");
		expect(repoRoots).toContain("/repo/apps/agents-cli");
		expect(apiRoots).toContain("/repo/apps/agents-cli");
		expect(apiRoots).toContain("/repo/apps/hono-api");
	});
});
