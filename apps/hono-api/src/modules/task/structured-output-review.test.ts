import { describe, expect, it } from "vitest";
import { projectStructuredOutputReview } from "./structured-output-review";

const validReview = {
	version: 1,
	blocking: false,
	contractHash: `sha256:${"a".repeat(64)}`,
	candidateHash: `sha256:${"b".repeat(64)}`,
	feedbackDelivered: true,
	status: "observations_remaining",
	observations: [{
		code: "model_authored_consistency",
		message: "对白窗口为 3 秒。",
		observationKey: "speech:line-1",
	}],
};

describe("structured output review projection", () => {
	it("keeps only the compact non-blocking receipt and reports malformed observation rows", () => {
		const projection = projectStructuredOutputReview({
			...validReview,
			observations: [
				...validReview.observations,
				{ code: "other", message: "unsupported diagnostic" },
				{ code: "model_authored_consistency", message: 12 },
			],
			candidate: "must not cross the bridge",
			correction: "must not cross the bridge",
			reasoning: "must not cross the bridge",
		});

		expect(projection.review).toEqual({
			version: 1,
			blocking: false,
			contractHash: validReview.contractHash,
			candidateHash: validReview.candidateHash,
			feedbackDelivered: true,
			status: "observations_remaining",
			observations: validReview.observations,
		});
		expect(projection.issue).toEqual({
			reason: "invalid_observation_rows",
			droppedObservationCount: 2,
		});
	});

	it("reports an invalid receipt header without treating it as an artifact failure", () => {
		const projection = projectStructuredOutputReview({
			...validReview,
			blocking: true,
		});

		expect(projection).toEqual({
			review: null,
			issue: { reason: "invalid_receipt", droppedObservationCount: 0 },
		});
	});

	it("keeps observations remaining when malformed rows are the only source of that status", () => {
		const projection = projectStructuredOutputReview({
			...validReview,
			status: "no_remaining_observations",
			observations: [{ code: "unsupported", message: "malformed row" }],
		});

		expect(projection.review).toMatchObject({
			status: "observations_remaining",
			observations: [],
		});
		expect(projection.issue).toEqual({
			reason: "invalid_observation_rows",
			droppedObservationCount: 1,
		});
	});

	it("reports a contradictory status while deriving it from submitted observations", () => {
		const projection = projectStructuredOutputReview({
			...validReview,
			status: "no_remaining_observations",
		});

		expect(projection.review?.status).toBe("observations_remaining");
		expect(projection.issue).toEqual({
			reason: "invalid_receipt",
			droppedObservationCount: 0,
		});
	});
});
