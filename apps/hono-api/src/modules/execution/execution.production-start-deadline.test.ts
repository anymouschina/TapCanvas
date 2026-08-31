import { describe, expect, it } from "vitest";
import {
	computeWorkflowAgentPhysicalAttemptDeadlineAt,
	materializeWorkflowExecutionControl,
	parseWorkflowExecutionControl,
	WORKFLOW_VIDEO_PROVIDER_EXECUTOR_REF,
} from "./execution.production-start-deadline";

const admission = {
	version: 2 as const,
	productionStartDeadline: {
		version: 2 as const,
		kind: "video_provider_receipt" as const,
		source: "public_chat" as const,
		publicTurnId: "turn-1",
		windowMs: 5 * 60_000,
		targetExecutorRef: WORKFLOW_VIDEO_PROVIDER_EXECUTOR_REF,
	},
};

describe("workflow production-start deadline", () => {
	it("freezes only graph ancestors of the provider receipt boundary", () => {
		const control = materializeWorkflowExecutionControl({
			nodes: [
				{ id: "trigger", data: {} },
				{ id: "beat-sheet", data: {} },
				{ id: "unrelated", data: {} },
				{
					id: "video-submit",
					data: { workflowAtomicSpec: { executorRef: WORKFLOW_VIDEO_PROVIDER_EXECUTOR_REF } },
				},
				{ id: "concat", data: {} },
			],
			edges: [
				{ source: "trigger", target: "beat-sheet" },
				{ source: "beat-sheet", target: "video-submit" },
				{ source: "video-submit", target: "concat" },
			],
		}, admission, "2026-08-29T05:00:00.000Z");

		expect(control.productionStartDeadline.controlledNodeIds).toEqual([
			"beat-sheet",
			"trigger",
		]);
		expect(control.productionStartDeadline).toMatchObject({
			version: 2,
			anchor: "workflow_execution_created",
			acceptedAt: "2026-08-29T05:00:00.000Z",
			deadlineAt: "2026-08-29T05:05:00.000Z",
		});
		expect(parseWorkflowExecutionControl(control)).toEqual(control);
	});

	it("gives every physical attempt the immutable production-start deadline", () => {
		const control = materializeWorkflowExecutionControl({
			nodes: [
				{ id: "agent", data: {} },
				{
					id: "video",
					data: { workflowAtomicSpec: { executorRef: WORKFLOW_VIDEO_PROVIDER_EXECUTOR_REF } },
				},
			],
			edges: [{ source: "agent", target: "video" }],
		}, admission, "2026-08-29T05:00:00.000Z").productionStartDeadline;
		expect(computeWorkflowAgentPhysicalAttemptDeadlineAt({
			productionStartDeadline: control,
		})).toBe("2026-08-29T05:05:00.000Z");
		expect(computeWorkflowAgentPhysicalAttemptDeadlineAt({
			productionStartDeadline: control,
		})).toBe("2026-08-29T05:05:00.000Z");
	});
});
