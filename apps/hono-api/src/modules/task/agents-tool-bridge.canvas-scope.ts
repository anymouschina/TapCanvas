function readTrimmedString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

export function resolveChapterCanvasId(input: {
	chapterId: unknown;
	flowScopedToolRequested: boolean;
}): string {
	const chapterId = readTrimmedString(input.chapterId);
	if (!input.flowScopedToolRequested || !chapterId) return "";

	// Numeric chapter selectors address book metadata. Non-numeric IDs address
	// the chapters row whose canvas_flow is the current tool's flow.
	return /\D/.test(chapterId) ? chapterId : "";
}
