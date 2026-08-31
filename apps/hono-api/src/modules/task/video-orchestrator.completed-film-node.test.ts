import { describe, expect, it } from "vitest";
import { buildCompletedFilmNodeData } from "./video-orchestrator.completed-film-node";

describe("buildCompletedFilmNodeData", () => {
	it("projects a completed film into the canonical results layer", () => {
		const data = buildCompletedFilmNodeData({
			videoUrl: "https://assets.example/final.mp4",
			runId: "run-20s",
			targetDurationSeconds: 20,
			aspect: "16:9",
			concatPolicy: {
				joinMode: "hard_cut",
				xfadeSeconds: 0,
				colorMatch: false,
			},
		});

		expect(data).toEqual({
			kind: "composeVideo",
			label: "成片 20s",
			status: "success",
			productionLayer: "results",
			creationStage: "result_persistence",
			approvalStatus: "needs_confirmation",
			videoUrl: "https://assets.example/final.mp4",
			clipRunId: "run-20s",
			aspectRatio: "16:9",
			concatPolicy: {
				joinMode: "hard_cut",
				xfadeSeconds: 0,
				colorMatch: false,
			},
		});
	});

	it("does not invent optional aspect or concat facts", () => {
		const data = buildCompletedFilmNodeData({
			videoUrl: "https://assets.example/final.mp4",
			runId: "run-single",
			targetDurationSeconds: 5,
		});

		expect(data).not.toHaveProperty("aspectRatio");
		expect(data).not.toHaveProperty("concatPolicy");
	});
});
