export type ChapterStyleReferenceWriteDecision =
	| { action: "initial_set" | "idempotent" }
	| { action: "reject"; code: "chapter_style_reference_overwrite_forbidden" };

function sameOrderedUrls(current: readonly string[], requested: readonly string[]): boolean {
	return current.length === requested.length && current.every((url, index) => url === requested[index]);
}

/**
 * Chapter production may establish a project style only while the project has no style yet.
 * Once present, chapter-scoped agents can only repeat the exact same value. Replacing or
 * clearing a project-wide style belongs to the explicit project settings surface.
 */
export function decideChapterStyleReferenceWrite(input: {
	chapterId?: string | null;
	currentStyleImages: readonly string[];
	requestedStyleImages: readonly string[];
}): ChapterStyleReferenceWriteDecision {
	if (!String(input.chapterId ?? "").trim()) return { action: "initial_set" };
	if (input.currentStyleImages.length === 0) return { action: "initial_set" };
	if (sameOrderedUrls(input.currentStyleImages, input.requestedStyleImages)) {
		return { action: "idempotent" };
	}
	return { action: "reject", code: "chapter_style_reference_overwrite_forbidden" };
}
