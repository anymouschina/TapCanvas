export type BookMetadataAgentExecutionMode = "team" | "single";

export function resolveBookMetadataTargetChapterNumbers(input: {
	windowChapterNumbers: number[];
	missingChapterNumbers: number[];
	safeChapter: number;
	forceRefreshChapter?: boolean;
}): number[] {
	const windowChapterSet = new Set(
		input.windowChapterNumbers
			.map((value) => Number(value))
			.filter((value) => Number.isFinite(value) && value > 0)
			.map((value) => Math.trunc(value)),
	);
	const target = new Set(
		input.missingChapterNumbers
			.map((value) => Number(value))
			.filter((value) => Number.isFinite(value) && value > 0)
			.map((value) => Math.trunc(value))
			.filter((value) => windowChapterSet.has(value)),
	);
	const safeChapter = Math.trunc(Number(input.safeChapter));
	if (input.forceRefreshChapter === true && windowChapterSet.has(safeChapter)) {
		target.add(safeChapter);
	}
	return Array.from(target).sort((left, right) => left - right);
}

export function resolveBookMetadataAgentExecutionMode(input: {
	mode: "standard" | "deep";
	chapterCount: number;
	batchCount: number;
	preferSingleTurn?: boolean;
}): BookMetadataAgentExecutionMode {
	if (input.preferSingleTurn === true) return "single";
	if (input.mode !== "standard") return "team";
	if (input.chapterCount !== 1) return "team";
	if (input.batchCount !== 1) return "team";
	return "single";
}
