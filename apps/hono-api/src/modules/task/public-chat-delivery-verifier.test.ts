import { describe, expect, it } from "vitest";

import {
	buildPublicChatExpectedDeliverySummary,
	verifyPublicChatDelivery,
} from "./public-chat-delivery-verifier";

describe("public-chat-delivery-verifier", () => {
	it("defaults chapter-grounded execution to multishot still delivery without token guessing", () => {
		const expected = buildPublicChatExpectedDeliverySummary({
			taskSummary: {
				taskGoal: "先做预生产单帧，再继续第三章定格动画。",
				requestedOutput: "第三章预生产锚点",
				taskKind: "chapter_grounded_storyboard_regeneration_with_preproduction",
				recommendedNextStage: "create_authority_baseframe_then_continue_storyboard",
				mustStop: false,
				blockingGaps: [],
				successCriteria: ["先锁定风格和角色"],
			},
			requiresExecutionDelivery: true,
			forceAssetGeneration: false,
			chapterGroundedPromptSpecRequired: true,
			chapterAssetPreproductionRequired: false,
			chapterAssetPreproductionCount: null,
			selectedNodeKind: "image",
			selectedReferenceKind: null,
			workspaceAction: null,
		});

		expect(expected).toEqual({
			active: true,
			kind: "chapter_multishot_stills",
			source: "chapter_grounded_scope",
			reason: "chapter_grounded_execution_defaults_to_multishot_still_delivery",
			minStillCount: 2,
		});
	});

	it("honors explicit structured delivery contracts from semantic task summary", () => {
		const expected = buildPublicChatExpectedDeliverySummary({
			taskSummary: {
				taskGoal: "只做一张章节 authority base frame。",
				requestedOutput: "单张预生产基底帧",
				taskKind: "chapter_grounded_preproduction",
				recommendedNextStage: "create_single_baseframe_preproduction",
				mustStop: false,
				blockingGaps: [],
				successCriteria: ["写入单张 authority base frame 节点"],
				deliveryContract: {
					kind: "single_baseframe_preproduction",
				},
			},
			requiresExecutionDelivery: true,
			forceAssetGeneration: false,
			chapterGroundedPromptSpecRequired: true,
			chapterAssetPreproductionRequired: false,
			chapterAssetPreproductionCount: null,
			selectedNodeKind: "image",
			selectedReferenceKind: null,
			workspaceAction: null,
		});

		expect(expected).toEqual({
			active: true,
			kind: "single_baseframe_preproduction",
			source: "semantic_task_summary",
			reason: "explicit_structured_delivery_contract",
			minStillCount: null,
		});
	});

	it("uses structured multishot minimums instead of local case thresholds", () => {
		const expected = buildPublicChatExpectedDeliverySummary({
			taskSummary: {
				taskGoal: "完成四镜头定格动画静帧交付。",
				requestedOutput: "四张镜头静帧",
				taskKind: "chapter_storyboard",
				recommendedNextStage: "deliver_four_still_units",
				mustStop: false,
				blockingGaps: [],
				successCriteria: ["至少四个镜头静帧"],
				deliveryContract: {
					kind: "chapter_multishot_stills",
					minStillCount: 4,
				},
			},
			requiresExecutionDelivery: true,
			forceAssetGeneration: false,
			chapterGroundedPromptSpecRequired: true,
			chapterAssetPreproductionRequired: false,
			chapterAssetPreproductionCount: null,
			selectedNodeKind: "storyboard",
			selectedReferenceKind: null,
			workspaceAction: null,
		});
		const verification = verifyPublicChatDelivery({
			expected,
			evidence: {
				assetCount: 0,
				imageAssetCount: 0,
				videoAssetCount: 0,
				wroteCanvas: true,
				generatedAssets: false,
				imageLikeNodeCount: 3,
				preproductionImageLikeNodeCount: 0,
				reusablePreproductionImageLikeNodeCount: 0,
				materializedStoryboardStillCount: 0,
				hasVideoNodes: false,
				hasMaterializedVisualOutputs: false,
				hasPlannedAuthorityBaseFrame: false,
				hasConfirmedAuthorityBaseFrame: false,
				storyboardPlanPersistenceCount: 0,
			},
		});

		expect(expected.minStillCount).toBe(4);
		expect(verification).toEqual({
			applicable: true,
			status: "failed",
			code: "chapter_grounded_multishot_delivery_missing",
			summary: "chapter_multishot_still_delivery_missing",
		});
	});

	it("counts materialized storyboard stills as generic still delivery evidence", () => {
		const verification = verifyPublicChatDelivery({
			expected: {
				active: true,
				kind: "chapter_multishot_stills",
				source: "chapter_grounded_scope",
				reason: "chapter_grounded_execution_defaults_to_multishot_still_delivery",
				minStillCount: 2,
			},
			evidence: {
				assetCount: 0,
				imageAssetCount: 0,
				videoAssetCount: 0,
				wroteCanvas: true,
				generatedAssets: false,
				imageLikeNodeCount: 0,
				preproductionImageLikeNodeCount: 0,
				reusablePreproductionImageLikeNodeCount: 0,
				materializedStoryboardStillCount: 2,
				hasVideoNodes: false,
				hasMaterializedVisualOutputs: true,
				hasPlannedAuthorityBaseFrame: false,
				hasConfirmedAuthorityBaseFrame: true,
				storyboardPlanPersistenceCount: 0,
			},
		});

		expect(verification).toEqual({
			applicable: true,
			status: "satisfied",
			code: null,
			summary: "chapter_multishot_still_delivery_verified",
		});
	});

	it("forces chapter-grounded requests with missing reusable assets into preproduction-first delivery", () => {
		const expected = buildPublicChatExpectedDeliverySummary({
			taskSummary: {
				taskGoal: "完成第二章漫剧创作。",
				requestedOutput: "第二章漫剧节点",
				taskKind: "chapter_grounded_storyboard",
				recommendedNextStage: "create_storyboard_nodes",
				mustStop: false,
				blockingGaps: [],
				successCriteria: ["完成章节分镜"],
				deliveryContract: {
					kind: "chapter_multishot_stills",
					minStillCount: 4,
				},
			},
			requiresExecutionDelivery: true,
			forceAssetGeneration: false,
			chapterGroundedPromptSpecRequired: true,
			chapterAssetPreproductionRequired: true,
			chapterAssetPreproductionCount: 3,
			selectedNodeKind: "image",
			selectedReferenceKind: null,
			workspaceAction: null,
		});
		const verification = verifyPublicChatDelivery({
			expected,
			evidence: {
				assetCount: 0,
				imageAssetCount: 0,
				videoAssetCount: 0,
				wroteCanvas: true,
				generatedAssets: false,
				imageLikeNodeCount: 4,
				preproductionImageLikeNodeCount: 1,
				reusablePreproductionImageLikeNodeCount: 1,
				materializedStoryboardStillCount: 0,
				hasVideoNodes: false,
				hasMaterializedVisualOutputs: false,
				hasPlannedAuthorityBaseFrame: true,
				hasConfirmedAuthorityBaseFrame: false,
				storyboardPlanPersistenceCount: 0,
			},
		});

		expect(expected).toEqual({
			active: true,
			kind: "chapter_asset_preproduction",
			source: "chapter_missing_assets",
			reason: "chapter_grounded_missing_reusable_assets_requires_preproduction_first",
			minStillCount: 3,
		});
		expect(verification).toEqual({
			applicable: true,
			status: "failed",
			code: "chapter_asset_preproduction_missing",
			summary: "chapter_asset_preproduction_missing",
		});
	});

	it("counts reusable anchor nodes as chapter asset preproduction delivery evidence", () => {
		const verification = verifyPublicChatDelivery({
			expected: {
				active: true,
				kind: "chapter_asset_preproduction",
				source: "chapter_missing_assets",
				reason: "chapter_grounded_missing_reusable_assets_requires_preproduction_first",
				minStillCount: 3,
			},
			evidence: {
				assetCount: 0,
				imageAssetCount: 0,
				videoAssetCount: 0,
				wroteCanvas: true,
				generatedAssets: false,
				imageLikeNodeCount: 5,
				preproductionImageLikeNodeCount: 0,
				reusablePreproductionImageLikeNodeCount: 3,
				materializedStoryboardStillCount: 0,
				hasVideoNodes: false,
				hasMaterializedVisualOutputs: false,
				hasPlannedAuthorityBaseFrame: true,
				hasConfirmedAuthorityBaseFrame: false,
				storyboardPlanPersistenceCount: 0,
			},
		});

		expect(verification).toEqual({
			applicable: true,
			status: "satisfied",
			code: null,
			summary: "chapter_asset_preproduction_verified",
		});
	});

	it("requires storyboard plan persistence for chapter script workspace actions", () => {
		const expected = buildPublicChatExpectedDeliverySummary({
			taskSummary: null,
			requiresExecutionDelivery: false,
			forceAssetGeneration: false,
			chapterGroundedPromptSpecRequired: false,
			chapterAssetPreproductionRequired: false,
			chapterAssetPreproductionCount: null,
			selectedNodeKind: null,
			selectedReferenceKind: null,
			workspaceAction: "chapter_script_generation",
		});

		expect(expected).toEqual({
			active: true,
			kind: "chapter_storyboard_plan_persistence",
			source: "workspace_action",
			reason: "workspace_action_requires_chapter_storyboard_plan_persistence",
			minStillCount: null,
		});
	});

	it("fails chapter script delivery when storyboard plan upsert evidence is missing", () => {
		const verification = verifyPublicChatDelivery({
			expected: {
				active: true,
				kind: "chapter_storyboard_plan_persistence",
				source: "workspace_action",
				reason: "workspace_action_requires_chapter_storyboard_plan_persistence",
				minStillCount: null,
			},
			evidence: {
				assetCount: 0,
				imageAssetCount: 0,
				videoAssetCount: 0,
				wroteCanvas: false,
				generatedAssets: false,
				imageLikeNodeCount: 0,
				preproductionImageLikeNodeCount: 0,
				reusablePreproductionImageLikeNodeCount: 0,
				materializedStoryboardStillCount: 0,
				hasVideoNodes: false,
				hasMaterializedVisualOutputs: false,
				hasPlannedAuthorityBaseFrame: false,
				hasConfirmedAuthorityBaseFrame: false,
				storyboardPlanPersistenceCount: 0,
			},
		});

		expect(verification).toEqual({
			applicable: true,
			status: "failed",
			code: "chapter_storyboard_plan_persistence_missing",
			summary: "chapter_storyboard_plan_persistence_missing",
		});
	});
});
