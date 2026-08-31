export type VideoConcatPolicy = {
	joinMode: "hard_cut" | "xfade";
	xfadeSeconds: number;
	colorMatch: boolean;
};

export type CompletedFilmNodeData = {
	kind: "composeVideo";
	label: string;
	status: "success";
	productionLayer: "results";
	creationStage: "result_persistence";
	approvalStatus: "needs_confirmation";
	videoUrl: string;
	clipRunId: string;
	aspectRatio?: string;
	concatPolicy?: VideoConcatPolicy;
};

/**
 * Build the canonical canvas projection for a completed film.
 *
 * The production classification is part of the delivery contract: agents use
 * `productionLayer=results` to retrieve final deliverables after a durable
 * workflow succeeds. Omitting it leaves a real film on the canvas while making
 * the same film invisible to the result-scoped read path.
 */
export function buildCompletedFilmNodeData(input: {
	videoUrl: string;
	runId: string;
	targetDurationSeconds: number;
	aspect?: string;
	concatPolicy?: VideoConcatPolicy;
}): CompletedFilmNodeData {
	return {
		kind: "composeVideo",
		label: `成片 ${input.targetDurationSeconds}s`,
		status: "success",
		productionLayer: "results",
		creationStage: "result_persistence",
		approvalStatus: "needs_confirmation",
		videoUrl: input.videoUrl,
		clipRunId: input.runId,
		...(input.aspect ? { aspectRatio: input.aspect } : {}),
		...(input.concatPolicy ? { concatPolicy: input.concatPolicy } : {}),
	};
}
