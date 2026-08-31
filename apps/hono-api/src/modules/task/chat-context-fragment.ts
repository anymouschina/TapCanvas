import type { StoryboardSelectionContext } from "../storyboard/storyboardSelectionProtocol";
import type { PublicChatEnabledModelCatalogSummary } from "../model-catalog/model-catalog.public-chat-summary";
import type { PublicChatPromptContext, PublicChatReferenceImageSlot } from "./chat-prompt.types";

export function buildPublicChatContextFragment(
	input: PublicChatPromptContext & {
		canvasProjectId: string | null;
		canvasFlowId: string | null;
		planOnly: boolean;
		forceAssetGeneration: boolean;
	},
): string {
	const skillLabel =
		typeof input.skill?.name === "string" && input.skill.name.trim()
			? input.skill.name.trim()
			: typeof input.skill?.key === "string" && input.skill.key.trim()
				? input.skill.key.trim()
				: "";
	const assetSummary =
		input.assetRoleSummary.length > 0 ? input.assetRoleSummary.join(", ") : "none";
	const lines = [
		"<tapcanvas_context>",
		"【当前轮已确认上下文】",
		...(input.generationProposal
			? [
					"【用户已明确点击的生成提案（结构化事实）】",
					`- proposalId: ${input.generationProposal.proposalId}`,
					`- kind: ${input.generationProposal.kind}`,
					`- title: ${input.generationProposal.title}`,
					`- prompt: ${clipBriefingText(input.generationProposal.prompt, 20_000)}`,
					`- model: ${input.generationProposal.model || "none"}`,
					`- parameters: ${input.generationProposal.parameters.map((item) => `${item.label}=${item.value}`).join(" | ") || "none"}`,
					`- action: ${input.generationProposal.action || "none"}`,
					`- nodeId: ${input.generationProposal.nodeId || "none"}`,
			  ]
			: []),
		`- chatMode: ${input.chatMode || "none"}`,
		`- creativePhase: ${input.creativePhase || "none"}`,
		`- planOnly: ${input.planOnly ? "true" : "false"}`,
		`- forceAssetGeneration: ${input.forceAssetGeneration ? "true" : "false"}`,
		`- project: ${input.currentProjectName?.trim() || "none"}`,
		`- currentBookId: ${input.currentBookId?.trim() || "none"}`,
		`- currentChapterId: ${input.currentChapterId?.trim() || "none"}`,
		`- canvasProjectId: ${input.canvasProjectId?.trim() || "none"}`,
		`- canvasFlowId: ${input.canvasFlowId?.trim() || "none"}`,
		`- selectedSkill: ${skillLabel || "none"}`,
		`- referenceImageCount: ${Math.max(0, input.referenceImageCount)}`,
		...buildReferenceImageSlotBriefingLines(input.referenceImageSlots),
		`- assetRoles: ${assetSummary}`,
		`- hasTargetImage: ${input.hasTargetImage ? "true" : "false"}`,
		`- hasSelectedNode: ${input.hasSelectedNode ? "true" : "false"}`,
		`- selectedNodeId: ${input.selectedNodeId?.trim() || "none"}`,
		`- selectedNodeLabel: ${input.selectedNodeLabel?.trim() || "none"}`,
		`- selectedNodeKind: ${input.selectedNodeKind?.trim() || "none"}`,
		`- selectedNodeTextPreview: ${formatBriefingPreview(input.selectedNodeTextPreview)}`,
		...buildEnabledModelCatalogBriefingLines(
			input.enabledModelCatalogSummary,
			input.enabledModelCatalogSummaryError,
		),
		`- selectedReference.nodeId: ${input.selectedReference?.nodeId?.trim() || "none"}`,
		`- selectedReference.label: ${input.selectedReference?.label?.trim() || "none"}`,
		`- selectedReference.kind: ${input.selectedReference?.kind?.trim() || "none"}`,
		`- selectedReference.roleName: ${input.selectedReference?.roleName?.trim() || "none"}`,
		`- selectedReference.roleCardId: ${input.selectedReference?.roleCardId?.trim() || "none"}`,
		`- selectedReference.hasImage: ${input.selectedReference?.imageUrl?.trim() ? "true" : "false"}`,
		`- selectedReference.hasSourceMedia: ${input.selectedReference?.sourceUrl?.trim() ? "true" : "false"}`,
		`- selectedReference.bookId: ${input.selectedReference?.bookId?.trim() || "none"}`,
		`- selectedReference.chapterId: ${input.selectedReference?.chapterId?.trim() || "none"}`,
		`- selectedReference.shotNo: ${typeof input.selectedReference?.shotNo === "number" ? String(input.selectedReference.shotNo) : "none"}`,
		`- selectedReference.productionLayer: ${input.selectedReference?.productionLayer?.trim() || "none"}`,
		`- selectedReference.creationStage: ${input.selectedReference?.creationStage?.trim() || "none"}`,
		`- selectedReference.approvalStatus: ${input.selectedReference?.approvalStatus?.trim() || "none"}`,
		`- selectedReference.authorityBaseFrameNodeId: ${input.selectedReference?.authorityBaseFrameNodeId?.trim() || "none"}`,
		`- selectedReference.authorityBaseFrameStatus: ${input.selectedReference?.authorityBaseFrameStatus || "none"}`,
		...buildStoryboardSelectionBriefingLines(
			input.selectedReference?.storyboardSelectionContext,
		),
		"</tapcanvas_context>",
	];
	return lines.join("\n").trim();
}

function formatBriefingPreview(value: string | null | undefined): string {
	const normalized = String(value || "").trim();
	if (!normalized) return "none";
	return clipBriefingText(normalized, 600);
}

function buildReferenceImageSlotBriefingLines(
	slots: PublicChatReferenceImageSlot[],
): string[] {
	if (!Array.isArray(slots) || slots.length === 0) {
		return ["- referenceImageSlots: none"];
	}
	const summary = clipBriefingText(
		slots
			.map((slot) => {
				const parts = [slot.slot];
				if (slot.label) parts.push(slot.label);
				if (slot.referenceId) parts.push(`referenceId=${slot.referenceId}`);
				if (slot.nodeId) parts.push(`nodeId=${slot.nodeId}`);
				if (slot.assetId) parts.push(`assetId=${slot.assetId}`);
				if (slot.assetRefId) parts.push(`assetRefId=${slot.assetRefId}`);
				if (slot.role) parts.push(`role=${slot.role}`);
				if (slot.note) parts.push(`note=${slot.note}`);
				return parts.join(" | ");
			})
			.join(" || "),
		800,
	);
	return [`- referenceImageSlots: ${summary}`];
}

function buildEnabledModelCatalogBriefingLines(
	summary: PublicChatEnabledModelCatalogSummary | null | undefined,
	error: string | null | undefined,
): string[] {
	if (error) {
		return [
			"- enabledModelCatalogSummary.status: unavailable",
			`- enabledModelCatalogSummary.error: ${clipBriefingText(error, 400)}`,
		];
	}
	if (!summary) {
		return [];
	}
	const imageModels = summary.imageModels;
	const videoModels = summary.videoModels;
	const audioModels = summary.audioModels;
	const videoFinishingModels = summary.videoFinishingModels ?? [];
	if (
		imageModels.length === 0 &&
		videoModels.length === 0 &&
		audioModels.length === 0 &&
		videoFinishingModels.length === 0
	) {
		return [
			"- enabledModelCatalogSummary.status: available",
			"- enabledImageModels.count: 0",
			"- enabledVideoModels.count: 0",
			"- enabledAudioModels.count: 0",
			"- enabledVideoFinishingModels.count: 0",
		];
	}
	return [
		"- enabledModelCatalogSummary.status: available",
		`- enabledImageModels.count: ${imageModels.length}`,
		...imageModels.map((model, index) => buildEnabledImageModelBriefingLine(index + 1, model)),
		`- enabledVideoModels.count: ${videoModels.length}`,
		...videoModels.map((model, index) => buildEnabledVideoModelBriefingLine(index + 1, model)),
		`- enabledAudioModels.count: ${audioModels.length}`,
		...audioModels.map((model, index) => buildEnabledAudioModelBriefingLine(index + 1, model)),
		`- enabledVideoFinishingModels.count: ${videoFinishingModels.length}`,
		...videoFinishingModels.map((model, index) =>
			buildEnabledVideoFinishingModelBriefingLine(index + 1, model),
		),
	];
}

/**
 * Compact factual briefing for agents that need to select a video generation
 * contract.  This deliberately exposes only the live executable video
 * catalog; it does not choose a model or infer a workflow.
 */
export function buildEnabledVideoModelCatalogBriefing(
	summary: PublicChatEnabledModelCatalogSummary | null | undefined,
	error: string | null | undefined,
): string {
	const lines = error
		? [
				"- enabledVideoModels.status: unavailable",
				`- enabledVideoModels.error: ${clipBriefingText(error, 400)}`,
			]
		: summary
			? [
				"- enabledVideoModels.status: available",
				`- enabledVideoModels.count: ${summary.videoModels.length}`,
				...summary.videoModels.map((model, index) =>
					buildEnabledVideoModelBriefingLine(index + 1, model),
				),
				`- enabledVideoFinishingModels.count: ${summary.videoFinishingModels?.length ?? 0}`,
				...(summary.videoFinishingModels ?? []).map((model, index) =>
					buildEnabledVideoFinishingModelBriefingLine(index + 1, model),
				),
			]
			: ["- enabledVideoModels.status: not_loaded"];
	return lines.join("\n");
}

function buildEnabledImageModelBriefingLine(
	index: number,
	model: PublicChatEnabledModelCatalogSummary["imageModels"][number],
): string {
	const parts = [
		`alias=${model.modelAlias || model.modelKey}`,
		`modelKey=${model.modelKey}`,
		`vendor=${model.vendorKey}`,
		`label=${model.labelZh}`,
		`access=${model.availability}`,
		`useCases=${formatBriefingList(model.useCases)}`,
	];
	if (model.imageOptions) {
		parts.push(
			`defaultAspectRatio=${model.imageOptions.defaultAspectRatio || "undeclared"}`,
		);
		parts.push(
			`defaultImageSize=${model.imageOptions.defaultImageSize || "undeclared"}`,
		);
		parts.push(`aspectRatios=${formatBriefingList(model.imageOptions.aspectRatioOptions)}`);
		parts.push(
			`imageSizes=${formatBriefingList(
				model.imageOptions.imageSizeOptions.map((option) => option.value),
			)}`,
		);
		parts.push(`resolutions=${formatBriefingList(model.imageOptions.resolutionOptions)}`);
		parts.push(
			`supportsReferenceImages=${formatOptionalBoolean(
				model.imageOptions.supportsReferenceImages,
			)}`,
		);
		parts.push(
			`supportsTextToImage=${formatOptionalBoolean(model.imageOptions.supportsTextToImage)}`,
		);
		parts.push(
			`supportsImageToImage=${formatOptionalBoolean(model.imageOptions.supportsImageToImage)}`,
		);
	} else {
		parts.push("imageOptions=undeclared");
	}
	return `- enabledImageModel[${index}]: ${clipBriefingText(parts.join(" | "), 900)}`;
}

function buildEnabledVideoModelBriefingLine(
	index: number,
	model: PublicChatEnabledModelCatalogSummary["videoModels"][number],
): string {
	const parts = [
		`alias=${model.modelAlias || model.modelKey}`,
		`modelKey=${model.modelKey}`,
		`vendor=${model.vendorKey}`,
		`label=${model.labelZh}`,
		`access=${model.availability}`,
		`useCases=${formatBriefingList(model.useCases)}`,
	];
	if (model.videoOptions) {
		const durationValues = model.videoOptions.durationOptions.map((option) => `${option.value}s`);
		const resolutionValues = model.videoOptions.resolutionOptions.map((option) => option.value);
		const sizeValues = model.videoOptions.sizeOptions.map((option) => option.value);
		const orientationValues = model.videoOptions.orientationOptions.map((option) => option.value);
		parts.push(
			`defaultDuration=${typeof model.videoOptions.defaultDurationSeconds === "number" ? `${model.videoOptions.defaultDurationSeconds}s` : "undeclared"}`,
		);
		parts.push(
			`defaultResolution=${model.videoOptions.defaultResolution || "undeclared"}`,
		);
		parts.push(
			`maxDuration=${typeof model.videoOptions.maxDurationSeconds === "number" ? `${model.videoOptions.maxDurationSeconds}s` : "undeclared"}`,
		);
		parts.push(`durations=${formatBriefingList(durationValues)}`);
		parts.push(`resolutions=${formatBriefingList(resolutionValues)}`);
		parts.push(`sizes=${formatBriefingList(sizeValues)}`);
		parts.push(`orientations=${formatBriefingList(orientationValues)}`);
		parts.push(`supportsNativeAudio=${model.videoOptions.supportsNativeAudio ?? "undeclared"}`);
		parts.push(`supportsReferenceImages=${model.videoOptions.supportsReferenceImages ?? "undeclared"}`);
		parts.push(`maxReferenceImages=${model.videoOptions.maxReferenceImages ?? "undeclared"}`);
		parts.push(`supportsReferenceAudios=${model.videoOptions.supportsReferenceAudios ?? "undeclared"}`);
		parts.push(`maxReferenceAudios=${model.videoOptions.maxReferenceAudios ?? "undeclared"}`);
		parts.push(`maxReferenceAudioDuration=${model.videoOptions.maxReferenceAudioDurationSeconds ?? "undeclared"}`);
	} else {
		parts.push("videoOptions=undeclared");
	}
	return `- enabledVideoModel[${index}]: ${clipBriefingText(parts.join(" | "), 900)}`;
}

function buildEnabledAudioModelBriefingLine(
	index: number,
	model: PublicChatEnabledModelCatalogSummary["audioModels"][number],
): string {
	return `- enabledAudioModel[${index}]: modelKey=${model.modelKey} | label=${model.label} | audioType=${model.audioType} | engine=${model.engine || "undeclared"} | pricingCost=${model.pricingCost}`;
}

function buildEnabledVideoFinishingModelBriefingLine(
	index: number,
	model: NonNullable<PublicChatEnabledModelCatalogSummary["videoFinishingModels"]>[number],
): string {
	const parameters = model.parameters.map((parameter) => {
		const options = parameter.options.map((option) => String(option.value));
		return `${parameter.key}=${options.length > 0 ? options.join(",") : "declared"}`;
	});
	return `- enabledVideoFinishingModel[${index}]: modelKey=${model.modelKey} | label=${model.label} | parameters=${formatBriefingList(parameters)}`;
}

function buildStoryboardSelectionBriefingLines(
	context: StoryboardSelectionContext | null | undefined,
): string[] {
	if (!context) return [];
	return [
		`- storyboardSelection.taskId: ${String(context.taskId || "").trim() || "none"}`,
		`- storyboardSelection.planId: ${String(context.planId || "").trim() || "none"}`,
		`- storyboardSelection.chunkId: ${String(context.chunkId || "").trim() || "none"}`,
		`- storyboardSelection.chunkIndex: ${typeof context.chunkIndex === "number" ? String(context.chunkIndex) : "none"}`,
		`- storyboardSelection.shotNo: ${typeof context.shotNo === "number" ? String(context.shotNo) : "none"}`,
		`- storyboardSelection.frameIndex: ${typeof context.frameIndex === "number" ? String(context.frameIndex) : "none"}`,
		`- storyboardSelection.sourceBookId: ${String(context.sourceBookId || "").trim() || "none"}`,
		`- storyboardSelection.materialChapter: ${typeof context.materialChapter === "number" ? String(context.materialChapter) : "none"}`,
	];
}

function clipBriefingText(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function formatBriefingList(values: Array<string | null | undefined>): string {
	const normalized = values.map((value) => String(value || "").trim()).filter(Boolean);
	return normalized.length > 0 ? normalized.join(",") : "undeclared";
}

function formatOptionalBoolean(value: boolean | null | undefined): string {
	if (value === true) return "true";
	if (value === false) return "false";
	return "undeclared";
}
