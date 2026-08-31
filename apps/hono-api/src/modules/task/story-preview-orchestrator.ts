import type { DurableProgressCursorV1 } from "./durable-progress-cursor";

export const STORY_PREVIEW_ORCHESTRATOR_TOOL = "tapcanvas_story_preview_orchestrate" as const;
export const STORY_PREVIEW_MAX_BOARDS = 8;

export type StoryPreviewBoardStatus = "missing" | "running" | "success";

export type StoryPreviewReferenceOption = Readonly<{
	refId: string;
	role: string;
	entityKind: string;
	entityName: string;
}>;

export type StoryPreviewBoardSpec = Readonly<{
	boardIndex: number;
	startSeconds: number;
	endSeconds: number;
	expectedCellCount: number;
	/** Complete canonical source sections overlapping this board's time window. */
	sourceExcerpt?: string;
	/** Frozen references that the agent may bind to individual cells by exact ID. */
	referenceOptions: readonly StoryPreviewReferenceOption[];
	status: StoryPreviewBoardStatus;
	nodeId: string | null;
	taskId: string | null;
}>;

export type StoryPreviewRunSnapshot = Readonly<{
	chapterId: string;
	runId: string;
	revision: string;
	sourceChapterRevision: number;
	sourceHash: string;
	boardCount: number;
	boards: StoryPreviewBoardSpec[];
	nextBoardIndex: number | null;
}>;

export function storyPreviewPutBoardMode(boardIndex: number): string {
	return `put_board_${boardIndex}`;
}

export function readStoryPreviewPutBoardIndex(mode: unknown): number | null {
	if (typeof mode !== "string") return null;
	const match = mode.trim().match(/^put_board_(\d+)$/u);
	if (!match) return null;
	const boardIndex = Number(match[1]);
	return Number.isInteger(boardIndex) && boardIndex >= 0 && boardIndex < STORY_PREVIEW_MAX_BOARDS
		? boardIndex
		: null;
}

export function buildStoryPreviewProgressCursor(
	snapshot: StoryPreviewRunSnapshot,
): DurableProgressCursorV1 {
	const completedUnitIds = snapshot.boards
		.filter((board) => board.status === "running" || board.status === "success")
		.map((board) => `board:${board.boardIndex}`);
	const pendingUnitIds = snapshot.boards
		.filter((board) => board.status === "missing")
		.map((board) => `board:${board.boardIndex}`);
	return {
		version: 1,
		graph: "story_preview",
		phase: snapshot.nextBoardIndex === null ? "submitted" : "authoring",
		revision: snapshot.revision,
		completedUnitIds,
		pendingUnitIds,
		allowedNextActions: snapshot.nextBoardIndex === null
			? []
			: [storyPreviewPutBoardMode(snapshot.nextBoardIndex)],
		requiredReadActions: [],
	};
}

export function buildStoryPreviewRunReceipt(input: {
	snapshot: StoryPreviewRunSnapshot;
	mode: string;
	board?: StoryPreviewBoardSpec | null;
	generated?: Record<string, unknown> | null;
	status?: "ready" | "submitted" | "complete";
}): Record<string, unknown> {
	const progressCursor = buildStoryPreviewProgressCursor(input.snapshot);
	const nextBoard = input.snapshot.nextBoardIndex === null
		? null
		: input.snapshot.boards[input.snapshot.nextBoardIndex] ?? null;
	const acceptedAsync = input.generated?.status === "running";
	return {
		ok: true,
		terminal: input.snapshot.nextBoardIndex === null,
		mode: input.mode,
		runId: input.snapshot.runId,
		revision: input.snapshot.revision,
		storyPreviewStatus: input.status ?? (
			input.snapshot.nextBoardIndex === null ? "complete" : "ready"
		),
		boardCount: input.snapshot.boardCount,
		completedBoardIndexes: input.snapshot.boards
			.filter((board) => board.status !== "missing")
			.map((board) => board.boardIndex),
		pendingBoardIndexes: input.snapshot.boards
			.filter((board) => board.status === "missing")
			.map((board) => board.boardIndex),
		...(input.board ? { board: input.board } : {}),
		...(nextBoard ? {
			nextBoard: {
				boardIndex: nextBoard.boardIndex,
				mode: storyPreviewPutBoardMode(nextBoard.boardIndex),
				startSeconds: nextBoard.startSeconds,
				endSeconds: nextBoard.endSeconds,
				expectedCellCount: nextBoard.expectedCellCount,
				...(nextBoard.sourceExcerpt ? { sourceExcerpt: nextBoard.sourceExcerpt } : {}),
				referenceOptions: nextBoard.referenceOptions,
			},
		} : {}),
		...(input.generated ? { generation: input.generated } : {}),
		...(acceptedAsync ? { acceptedAsync: true } : {}),
		progressCursor,
		nextAction: progressCursor.allowedNextActions[0] ?? null,
	};
}

export function buildStoryPreviewRepairFailure(input: {
	snapshot: StoryPreviewRunSnapshot;
	mode: string;
	code: string;
	message: string;
	issues?: unknown;
}): Record<string, unknown> {
	const expectedIndex = input.snapshot.nextBoardIndex;
	const retryMode = expectedIndex === null ? "status" : storyPreviewPutBoardMode(expectedIndex);
	const cursor = buildStoryPreviewProgressCursor(input.snapshot);
	return {
		ok: false,
		terminal: false,
		severity: "warning",
		code: input.code,
		message: input.message,
		runId: input.snapshot.runId,
		revision: input.snapshot.revision,
		mode: input.mode,
		...(input.issues !== undefined ? { issues: input.issues } : {}),
		progressCursor: cursor,
		nextAction: retryMode,
		recovery: {
			allowed: true,
			retryKey: ["story_preview", input.snapshot.runId, input.snapshot.revision, retryMode].join(":"),
			retryToolName: STORY_PREVIEW_ORCHESTRATOR_TOOL,
			maxAttempts: 3,
			immutableArgs: { mode: retryMode },
			retryMode,
			allowedRepairModes: [retryMode],
			requiredActions: [
				expectedIndex === null
					? "Read the terminal story-preview status; do not submit another paid board."
					: `Regenerate only board ${expectedIndex} with the exact dynamically loaded schema; do not read or replay any completed board.`,
			],
		},
	};
}

function buildCompactCellSchema(board: StoryPreviewBoardSpec): Record<string, unknown> {
	const allowedRefIds = board.referenceOptions.map((reference) => reference.refId);
	return {
		type: "object",
		additionalProperties: false,
		properties: {
			frame: {
				type: "string", minLength: 1, maxLength: 600,
				description: "Concrete visible state at this cell's exact start; never write only a timestamp or summary label.",
			},
			mid: {
				type: "string", minLength: 1, maxLength: 600,
				description: "Visible halfway transition at start+0.5 interval, causally connecting frame to end.",
			},
			end: {
				type: "string", minLength: 1, maxLength: 600,
				description: "Concrete visible end state inherited by the next cell; never write only a timestamp.",
			},
			camera: { type: "string", minLength: 1, maxLength: 400 },
			feedback: { type: "string", minLength: 1, maxLength: 400 },
			environment: { type: "string", minLength: 1, maxLength: 400 },
			subjectRefIds: {
				type: "array",
				minItems: 1,
				maxItems: Math.max(1, allowedRefIds.length),
				uniqueItems: true,
				items: { type: "string", enum: allowedRefIds },
				description:
					"Exact frozen reference IDs visibly present in this cell. Declare identity here; the server will not infer it from prose.",
			},
		},
		required: [
			"frame",
			"mid",
			"end",
			"camera",
			"feedback",
			"environment",
			"subjectRefIds",
		],
	};
}

export function buildStoryPreviewPutBoardParameters(input: {
	mode: string;
	board: StoryPreviewBoardSpec;
}): Record<string, unknown> {
	return {
		type: "object",
		additionalProperties: false,
		description:
			`Author exactly story-preview board ${input.board.boardIndex} ` +
			`(${input.board.startSeconds}-${input.board.endSeconds}s). ` +
			`The server owns the timeline, references, source revision and paid idempotency. ` +
			`Return exactly ${input.board.expectedCellCount} cells; this call cannot address another board. ` +
			`Use subjectRefIds to declare the exact frozen references visible in each cell. ` +
			`The server validates IDs and timing only; source fidelity and semantic completeness remain your same-chain authoring responsibility. ` +
			`Do not invent a replacement outcome or continue a previous scene beyond its source boundary.\n` +
			(input.board.sourceExcerpt ?? "Follow the canonical chapter narrative for this exact time window."),
		properties: {
			mode: { type: "string", const: input.mode },
			openingState: {
				type: "string",
				minLength: 1,
				maxLength: 600,
				description: "Visible starting state of the first cell; the server links it to the previous accepted board.",
			},
			cells: {
				type: "array",
				minItems: input.board.expectedCellCount,
				maxItems: input.board.expectedCellCount,
				items: buildCompactCellSchema(input.board),
			},
		},
		required: ["mode", "openingState", "cells"],
	};
}

export function buildStoryPreviewStaticOperationParameters(mode: "begin" | "status"):
	Record<string, unknown> {
	return {
		type: "object",
		additionalProperties: false,
		description: mode === "begin"
			? "Start or resume the deterministic full-story preview graph. The server returns the first missing board as the only ready frontier."
			: "Read the current deterministic story-preview graph without creating media.",
		properties: { mode: { type: "string", const: mode } },
		required: ["mode"],
	};
}
