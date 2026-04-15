import type { TaskRequestDto } from "./task.schemas";

type SelectedReferenceScope = {
	nodeId?: string | null;
	imageUrl?: string | null;
	sourceUrl?: string | null;
	roleName?: string | null;
	roleCardId?: string | null;
	authorityBaseFrameNodeId?: string | null;
};

export type PublicChatExecutionPlanningDirective = {
	planningRequired: boolean;
	planningMinimumSteps: number;
	checklistFirst: boolean;
	reason: string;
};

function hasText(value: unknown): boolean {
	return typeof value === "string" && value.trim().length > 0;
}

function hasSelectedReferenceScope(value: SelectedReferenceScope | null | undefined): boolean {
	if (!value) return false;
	return (
		hasText(value.nodeId) ||
		hasText(value.imageUrl) ||
		hasText(value.sourceUrl) ||
		hasText(value.roleName) ||
		hasText(value.roleCardId) ||
		hasText(value.authorityBaseFrameNodeId)
	);
}

export function buildPublicChatExecutionPlanningDirective(input: {
	publicAgentsRequest: boolean;
	requestKind: TaskRequestDto["kind"];
	planOnly: boolean;
	canvasProjectId: string;
	canvasNodeId: string;
	bookId: string;
	chapterId: string;
	hasReferenceImages: boolean;
	hasAssetInputs: boolean;
	selectedReference: SelectedReferenceScope | null | undefined;
	chapterGroundedScope: boolean;
}): PublicChatExecutionPlanningDirective | null {
	if (!input.publicAgentsRequest) return null;
	if (input.requestKind !== "chat") return null;
	if (input.planOnly) return null;
	if (!hasText(input.canvasProjectId)) return null;

	const hasChapterScope = hasText(input.bookId) && hasText(input.chapterId);
	const hasNodeScope = hasText(input.canvasNodeId);
	const hasVisualInputs = input.hasReferenceImages || input.hasAssetInputs;
	const hasReferenceScope = hasSelectedReferenceScope(input.selectedReference);
	const planningRequired =
		hasChapterScope ||
		hasNodeScope ||
		hasVisualInputs ||
		hasReferenceScope ||
		input.chapterGroundedScope;

	if (!planningRequired) return null;

	if (input.chapterGroundedScope || hasChapterScope) {
		return {
			planningRequired: true,
			planningMinimumSteps: 4,
			checklistFirst: true,
			reason: "chapter_grounded_canvas_execution",
		};
	}

	if (hasNodeScope || hasVisualInputs || hasReferenceScope) {
		return {
			planningRequired: true,
			planningMinimumSteps: 3,
			checklistFirst: false,
			reason: "scoped_canvas_execution",
		};
	}

	return {
		planningRequired: true,
		planningMinimumSteps: 2,
		checklistFirst: false,
		reason: "project_scoped_execution",
	};
}
