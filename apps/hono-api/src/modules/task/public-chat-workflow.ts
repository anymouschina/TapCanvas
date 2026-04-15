export type PublicChatWorkflowContext = {
	currentProjectName?: string | null;
	workspaceAction?:
		| "chapter_script_generation"
		| "chapter_asset_generation"
		| "shot_video_generation"
		| null;
	selectedReference?: {
		bookId?: string | null;
		chapterId?: string | null;
	} | null;
	selectedNodeKind?: string | null;
} | null;

export type PublicChatWorkflowScopeInput = {
	mode?: "chat" | "auto" | null;
	canvasProjectId?: string | null;
	canvasFlowId?: string | null;
	canvasNodeId?: string | null;
	bookId?: string | null;
	chapterId?: string | null;
	chatContext?: PublicChatWorkflowContext;
};

function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function resolveEffectivePublicChatBookChapterScope(
	input: PublicChatWorkflowScopeInput,
): { bookId: string; chapterId: string } | null {
	const bookId =
		readTrimmedString(input.bookId) ||
		readTrimmedString(input.chatContext?.selectedReference?.bookId);
	const chapterId =
		readTrimmedString(input.chapterId) ||
		readTrimmedString(input.chatContext?.selectedReference?.chapterId);
	if (!bookId || !chapterId) return null;
	return { bookId, chapterId };
}
