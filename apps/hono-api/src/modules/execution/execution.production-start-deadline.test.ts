import { describe, expect, it } from "vitest";
import {
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
		acceptedAt: "2026-08-29T04:58:00.000Z",
		targetExecutorRef: WORKFLOW_VIDEO_PROVIDER_EXECUTOR_REF,
	},
} as const;

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
		}, admission);

		expect(control.productionStartDeadline.controlledNodeIds).toEqual([
			"beat-sheet",
			"trigger",
		]);
		expect(control.productionStartDeadline).toMatchObject({
			version: 2,
			anchor: "request_accepted",
			acceptedAt: "2026-08-29T04:58:00.000Z",
			deadlineAt: "2026-08-29T05:08:00.000Z",
		});
		expect(parseWorkflowExecutionControl(control)).toEqual(control);
		expect(parseWorkflowExecutionControl({ ...control, productionStartDeadline: { ...control.productionStartDeadline, deadlineAt: "2026-08-29T05:03:00.000Z" } })).toBeNull();
	});

});
