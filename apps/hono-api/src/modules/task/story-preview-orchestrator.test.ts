import { describe, expect, it } from "vitest";

import {
	buildStoryPreviewProgressCursor,
	buildStoryPreviewPutBoardParameters,
	buildStoryPreviewRepairFailure,
	buildStoryPreviewRunReceipt,
	readStoryPreviewPutBoardIndex,
	storyPreviewPutBoardMode,
	type StoryPreviewRunSnapshot,
} from "./story-preview-orchestrator";

function makeSnapshot(statuses: Array<"missing" | "running" | "success">): StoryPreviewRunSnapshot {
	return {
		chapterId: "chapter-1",
		runId: "story-preview:chapter-1:r7:hash:0-60",
		revision: "r7:hash",
		sourceChapterRevision: 7,
		sourceHash: "hash",
		boardCount: statuses.length,
		boards: statuses.map((status, boardIndex) => ({
			boardIndex,
			startSeconds: boardIndex * 9,
			endSeconds: Math.min(60, (boardIndex + 1) * 9),
			expectedCellCount: boardIndex === 6 ? 6 : 9,
			sourceExcerpt: `source-${boardIndex}`,
			referenceOptions: [{
				refId: "asset:hero",
				role: "protagonist",
				entityKind: "character",
				entityName: "Hero",
			}],
			status,
			nodeId: status === "missing" ? null : `node-${boardIndex}`,
			taskId: status === "missing" ? null : `task-${boardIndex}`,
		})),
		nextBoardIndex: statuses.findIndex((status) => status === "missing") < 0
			? null
			: statuses.findIndex((status) => status === "missing"),
	};
}

describe("story preview durable orchestrator", () => {
	it("exposes only the first missing board and treats accepted async boards as durable", () => {
		const snapshot = makeSnapshot(["success", "running", "missing", "missing", "missing", "missing", "missing"]);
		const cursor = buildStoryPreviewProgressCursor(snapshot);

		expect(cursor.graph).toBe("story_preview");
		expect(cursor.completedUnitIds).toEqual(["board:0", "board:1"]);
		expect(cursor.pendingUnitIds).toEqual([
			"board:2",
			"board:3",
			"board:4",
			"board:5",
			"board:6",
		]);
		expect(cursor.allowedNextActions).toEqual(["put_board_2"]);
	});

	it("projects an exact nine-cell schema and an exact six-cell tail schema", () => {
		const snapshot = makeSnapshot(["missing", "missing", "missing", "missing", "missing", "missing", "missing"]);
		const first = buildStoryPreviewPutBoardParameters({
			mode: "put_board_0",
			board: snapshot.boards[0]!,
		}) as {
			properties: {
				mode: { const: string };
				cells: {
					minItems: number;
					maxItems: number;
					items: {
						properties: { subjectRefIds: { items: { enum: string[] } } };
						required: string[];
					};
				};
			};
		};
		const tail = buildStoryPreviewPutBoardParameters({
			mode: "put_board_6",
			board: snapshot.boards[6]!,
		}) as { properties: { mode: { const: string }; cells: { minItems: number; maxItems: number } } };

		expect(first.properties.mode.const).toBe("put_board_0");
		expect(first.properties.cells).toMatchObject({ minItems: 9, maxItems: 9 });
		expect(first.properties.cells.items.required).toContain("subjectRefIds");
		expect(first.properties.cells.items.properties.subjectRefIds.items.enum).toEqual(["asset:hero"]);
		expect(tail.properties.mode.const).toBe("put_board_6");
		expect(tail.properties.cells).toMatchObject({ minItems: 6, maxItems: 6 });
	});

	it("keeps repair on the same deterministic frontier instead of replaying prior boards", () => {
		const snapshot = makeSnapshot(["success", "success", "missing", "missing"]);
		const failure = buildStoryPreviewRepairFailure({
			snapshot,
			mode: "put_board_2",
			code: "invalid_story_preview_board_cell_count",
			message: "expected 9 cells",
		});

		expect(failure).toMatchObject({
			ok: false,
			nextAction: "put_board_2",
			recovery: {
				maxAttempts: 3,
				immutableArgs: { mode: "put_board_2" },
				allowedRepairModes: ["put_board_2"],
			},
		});
	});

	it("becomes terminal only when every board has a persisted running or success checkpoint", () => {
		const snapshot = makeSnapshot(["success", "running", "success"]);
		const receipt = buildStoryPreviewRunReceipt({ snapshot, mode: "status" });

		expect(receipt).toMatchObject({
			ok: true,
			terminal: true,
			storyPreviewStatus: "complete",
			pendingBoardIndexes: [],
			nextAction: null,
		});
		expect((receipt.progressCursor as { allowedNextActions: string[] }).allowedNextActions).toEqual([]);
	});

	it("accepts only bounded exact board operation names", () => {
		expect(storyPreviewPutBoardMode(6)).toBe("put_board_6");
		expect(readStoryPreviewPutBoardIndex("put_board_6")).toBe(6);
		expect(readStoryPreviewPutBoardIndex("put_board_8")).toBeNull();
		expect(readStoryPreviewPutBoardIndex("put_board_x")).toBeNull();
	});
});
