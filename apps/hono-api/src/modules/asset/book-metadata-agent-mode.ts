export type BookMetadataAgentExecutionMode = "team" | "single";

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
