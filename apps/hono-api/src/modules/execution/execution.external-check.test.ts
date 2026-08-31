import { describe, expect, it } from "vitest";
import {
	mergeWorkflowExternalCheckSchedules,
	parseWorkflowExternalCheckScheduleV1,
	workflowExternalCheckDelaySeconds,
	workflowExternalPollAfter,
	workflowExternalPollAt,
	workflowExternalSignalOnly,
} from "./execution.external-check";

describe("workflow external check schedule", () => {
	it("preserves an absolute not-before boundary and rounds queue delay up", () => {
		const schedule = workflowExternalPollAfter(60_001, 1_000);
		expect(schedule).toEqual({
			version: 1,
			mode: "poll",
			notBeforeAt: new Date(61_001).toISOString(),
		});
		expect(workflowExternalCheckDelaySeconds(schedule, 1_000)).toBe(61);
	});

	it("keeps signal-only waits dormant", () => {
		const schedule = workflowExternalSignalOnly();
		expect(workflowExternalCheckDelaySeconds(schedule, 1_000)).toBeNull();
		expect(parseWorkflowExternalCheckScheduleV1(schedule)).toEqual(schedule);
	});

	it("selects the earliest poll while ignoring signal-only schedules", () => {
		expect(mergeWorkflowExternalCheckSchedules([
			workflowExternalSignalOnly(),
			workflowExternalPollAt("2026-08-23T00:01:00.000Z"),
			workflowExternalPollAt("2026-08-23T00:00:05.000Z"),
		])).toEqual(workflowExternalPollAt("2026-08-23T00:00:05.000Z"));
	});

	it("rejects unversioned scheduler hints", () => {
		expect(() => parseWorkflowExternalCheckScheduleV1({ mode: "poll", notBeforeAt: "2026-08-23T00:00:00.000Z" }))
			.toThrow(/protocol version 1/u);
	});
});
