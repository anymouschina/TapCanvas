export type PublicChatSemanticTaskSummary = {
	taskGoal: string;
	requestedOutput: string;
	taskKind: string;
	recommendedNextStage: string;
	mustStop: boolean;
	blockingGaps: string[];
	successCriteria: string[];
	deliveryContract?: PublicChatSemanticDeliveryContract | null;
};

export type PublicChatExpectedDeliveryKind =
	| "none"
	| "generic_execution"
	| "chapter_storyboard_plan_persistence"
	| "single_baseframe_preproduction"
	| "chapter_asset_preproduction"
	| "chapter_multishot_stills"
	| "video_followup";

export type PublicChatSemanticDeliveryContract = {
	kind: Exclude<PublicChatExpectedDeliveryKind, "none">;
	minStillCount?: number;
};

export type PublicChatExpectedDeliverySummary = {
	active: boolean;
	kind: PublicChatExpectedDeliveryKind;
	source:
		| "none"
		| "semantic_task_summary"
		| "workspace_action"
		| "chapter_missing_assets"
		| "chapter_grounded_scope"
		| "selected_video_context";
	reason: string;
	minStillCount: number | null;
};

export type PublicChatDeliveryEvidence = {
	assetCount: number;
	imageAssetCount: number;
	videoAssetCount: number;
	wroteCanvas: boolean;
	generatedAssets: boolean;
	imageLikeNodeCount: number;
	preproductionImageLikeNodeCount: number;
	reusablePreproductionImageLikeNodeCount: number;
	materializedStoryboardStillCount: number;
	hasVideoNodes: boolean;
	hasMaterializedVisualOutputs: boolean;
	hasPlannedAuthorityBaseFrame: boolean;
	hasConfirmedAuthorityBaseFrame: boolean;
	storyboardPlanPersistenceCount: number;
};

export type PublicChatDeliveryVerificationSummary = {
	applicable: boolean;
	status: "not_applicable" | "satisfied" | "failed";
	code: string | null;
	summary: string;
};

function normalizeText(value: string | null | undefined): string {
	return String(value || "").trim().toLowerCase();
}

function isVideoLikeKind(value: string | null | undefined): boolean {
	const normalized = normalizeText(value);
	return normalized === "video" || normalized === "composevideo";
}

function normalizePositiveStillCount(value: unknown): number | null {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric <= 0) return null;
	return Math.max(1, Math.trunc(numeric));
}

function readStructuredDeliveryContract(
	summary: PublicChatSemanticTaskSummary | null,
): PublicChatSemanticDeliveryContract | null {
	const contract = summary?.deliveryContract;
	if (!contract) return null;
	const kind = normalizeText(contract.kind);
	if (
		kind !== "generic_execution" &&
		kind !== "chapter_storyboard_plan_persistence" &&
		kind !== "single_baseframe_preproduction" &&
		kind !== "chapter_asset_preproduction" &&
		kind !== "chapter_multishot_stills" &&
		kind !== "video_followup"
	) {
		return null;
	}
	const minStillCount = normalizePositiveStillCount(contract.minStillCount);
	return {
		kind: kind as PublicChatSemanticDeliveryContract["kind"],
		...(minStillCount ? { minStillCount } : {}),
	};
}

function computeStillDeliveryUnitCount(evidence: PublicChatDeliveryEvidence): number {
	return Math.max(
		evidence.imageAssetCount,
		evidence.imageLikeNodeCount,
		evidence.materializedStoryboardStillCount,
	);
}

export function buildPublicChatExpectedDeliverySummary(input: {
	taskSummary: PublicChatSemanticTaskSummary | null;
	requiresExecutionDelivery: boolean;
	forceAssetGeneration: boolean;
	chapterGroundedPromptSpecRequired: boolean;
	chapterAssetPreproductionRequired: boolean;
	chapterAssetPreproductionCount: number | null;
	selectedNodeKind: string | null;
	selectedReferenceKind: string | null;
	workspaceAction:
		| "chapter_script_generation"
		| "chapter_asset_generation"
		| "shot_video_generation"
		| null;
}): PublicChatExpectedDeliverySummary {
	const executionRequested = input.requiresExecutionDelivery || input.forceAssetGeneration;
	if (input.workspaceAction === "chapter_script_generation") {
		return {
			active: true,
			kind: "chapter_storyboard_plan_persistence",
			source: "workspace_action",
			reason: "workspace_action_requires_chapter_storyboard_plan_persistence",
			minStillCount: null,
		};
	}
	if (!executionRequested && !input.chapterAssetPreproductionRequired) {
		return {
			active: false,
			kind: "none",
			source: "none",
			reason: "no_execution_delivery_required",
			minStillCount: null,
		};
	}
	if (input.chapterAssetPreproductionRequired) {
		return {
			active: true,
			kind: "chapter_asset_preproduction",
			source: "chapter_missing_assets",
			reason: "chapter_grounded_missing_reusable_assets_requires_preproduction_first",
			minStillCount: input.chapterAssetPreproductionCount ?? 1,
		};
	}
	const explicitDeliveryContract = readStructuredDeliveryContract(input.taskSummary);
	if (explicitDeliveryContract) {
		return {
			active: true,
			kind: explicitDeliveryContract.kind,
			source: "semantic_task_summary",
			reason: "explicit_structured_delivery_contract",
			minStillCount:
				explicitDeliveryContract.kind === "chapter_multishot_stills" ||
				explicitDeliveryContract.kind === "chapter_asset_preproduction"
					? explicitDeliveryContract.minStillCount ?? 2
					: null,
		};
	}
	if (input.chapterGroundedPromptSpecRequired) {
		if (isVideoLikeKind(input.selectedNodeKind) || isVideoLikeKind(input.selectedReferenceKind)) {
			return {
				active: true,
				kind: "video_followup",
				source: "selected_video_context",
				reason: "selected_context_is_video_like",
				minStillCount: null,
			};
		}
		return {
			active: true,
			kind: "chapter_multishot_stills",
			source: "chapter_grounded_scope",
			reason: "chapter_grounded_execution_defaults_to_multishot_still_delivery",
			minStillCount: 2,
		};
	}
	return {
		active: true,
		kind: "generic_execution",
		source: "semantic_task_summary",
		reason: "generic_execution_delivery",
		minStillCount: null,
	};
}

export function verifyPublicChatDelivery(input: {
	expected: PublicChatExpectedDeliverySummary;
	evidence: PublicChatDeliveryEvidence;
}): PublicChatDeliveryVerificationSummary {
	if (!input.expected.active || input.expected.kind === "none") {
		return {
			applicable: false,
			status: "not_applicable",
			code: null,
			summary: "no_expected_delivery_contract",
		};
	}

	switch (input.expected.kind) {
		case "single_baseframe_preproduction": {
			const satisfied =
				input.evidence.imageAssetCount >= 1 ||
				input.evidence.imageLikeNodeCount >= 1 ||
				input.evidence.hasPlannedAuthorityBaseFrame ||
				input.evidence.hasConfirmedAuthorityBaseFrame;
			return {
				applicable: true,
				status: satisfied ? "satisfied" : "failed",
				code: satisfied ? null : "single_baseframe_preproduction_missing",
				summary: satisfied
					? "single_baseframe_preproduction_delivered"
					: "single_baseframe_preproduction_missing",
			};
		}
		case "chapter_storyboard_plan_persistence": {
			const satisfied = input.evidence.storyboardPlanPersistenceCount > 0;
			return {
				applicable: true,
				status: satisfied ? "satisfied" : "failed",
				code: satisfied ? null : "chapter_storyboard_plan_persistence_missing",
				summary: satisfied
					? "chapter_storyboard_plan_persistence_verified"
					: "chapter_storyboard_plan_persistence_missing",
			};
		}
		case "chapter_asset_preproduction": {
			const requiredPreproductionCount = input.expected.minStillCount ?? 1;
			const deliveredPreproductionCount = Math.max(
				input.evidence.imageAssetCount,
				input.evidence.reusablePreproductionImageLikeNodeCount,
			);
			const satisfied = deliveredPreproductionCount >= requiredPreproductionCount;
			return {
				applicable: true,
				status: satisfied ? "satisfied" : "failed",
				code: satisfied ? null : "chapter_asset_preproduction_missing",
				summary: satisfied
					? "chapter_asset_preproduction_verified"
					: "chapter_asset_preproduction_missing",
			};
		}
		case "chapter_multishot_stills": {
			const requiredStillCount = input.expected.minStillCount ?? 2;
			const stillUnitCount = computeStillDeliveryUnitCount(input.evidence);
			const satisfied = stillUnitCount >= requiredStillCount;
			return {
				applicable: true,
				status: satisfied ? "satisfied" : "failed",
				code: satisfied ? null : "chapter_grounded_multishot_delivery_missing",
				summary: satisfied
					? "chapter_multishot_still_delivery_verified"
					: "chapter_multishot_still_delivery_missing",
			};
		}
		case "video_followup": {
			const satisfied =
				input.evidence.videoAssetCount >= 1 ||
				input.evidence.hasVideoNodes ||
				(input.evidence.wroteCanvas && input.evidence.hasMaterializedVisualOutputs);
			return {
				applicable: true,
				status: satisfied ? "satisfied" : "failed",
				code: satisfied ? null : "video_followup_delivery_missing",
				summary: satisfied ? "video_followup_delivery_verified" : "video_followup_delivery_missing",
			};
		}
		case "generic_execution": {
			const satisfied =
				input.evidence.assetCount > 0 ||
				input.evidence.generatedAssets ||
				input.evidence.wroteCanvas;
			return {
				applicable: true,
				status: satisfied ? "satisfied" : "failed",
				code: satisfied ? null : "generic_execution_delivery_missing",
				summary: satisfied ? "generic_execution_delivery_verified" : "generic_execution_delivery_missing",
			};
		}
		default:
			return {
				applicable: false,
				status: "not_applicable",
				code: null,
				summary: "no_expected_delivery_contract",
			};
	}
}
