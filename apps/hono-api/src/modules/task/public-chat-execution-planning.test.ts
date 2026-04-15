import { describe, expect, it } from "vitest";

import { buildPublicChatExecutionPlanningDirective } from "./public-chat-execution-planning";

describe("buildPublicChatExecutionPlanningDirective", () => {
	it("marks chapter-grounded execution as checklist-first", () => {
		expect(
			buildPublicChatExecutionPlanningDirective({
				publicAgentsRequest: true,
				requestKind: "chat",
				planOnly: false,
				canvasProjectId: "project-1",
				canvasNodeId: "",
				bookId: "book-1",
				chapterId: "2",
				hasReferenceImages: false,
				hasAssetInputs: false,
				selectedReference: null,
				chapterGroundedScope: true,
			}),
		).toEqual({
			planningRequired: true,
			planningMinimumSteps: 4,
			checklistFirst: true,
			reason: "chapter_grounded_canvas_execution",
		});
	});

	it("keeps generic scoped canvas execution as non-checklist-first", () => {
		expect(
			buildPublicChatExecutionPlanningDirective({
				publicAgentsRequest: true,
				requestKind: "chat",
				planOnly: false,
				canvasProjectId: "project-1",
				canvasNodeId: "node-1",
				bookId: "",
				chapterId: "",
				hasReferenceImages: false,
				hasAssetInputs: false,
				selectedReference: null,
				chapterGroundedScope: false,
			}),
		).toEqual({
			planningRequired: true,
			planningMinimumSteps: 3,
			checklistFirst: false,
			reason: "scoped_canvas_execution",
		});
	});
});
